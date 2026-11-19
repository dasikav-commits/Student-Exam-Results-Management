import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PDF } from "@libpdf/core";
import JSZip from "jszip";
import officeCrypto from "officecrypto-tool";
import sharp from "sharp";
import { criteria, fileSlots } from "../../src/lib/moderation-criteria";
import { boundedRequest, ModerationInputError, readBundle } from "../../src/lib/moderation-documents";
import { passwordSchema, reviewSchema } from "../../src/lib/paper-moderation";

const base = "https://results.example.test";

test("moderation upload rejects missing files, invalid formats, and oversized streams", async () => {
  const form = new FormData();
  await assert.rejects(readBundle(form, true), /Upload all four files/);
  for (const [slot, , extension] of fileSlots) form.set(slot, new Blob(["not a document"]), `${slot}${extension}`);
  await assert.rejects(readBundle(form, true, "not-a-real-password"), /unreadable/);
  await assert.rejects(boundedRequest(new Request(base, { method: "POST", body: "a".repeat(20) }), 19), (e: unknown) => e instanceof ModerationInputError && e.status === 413);
  assert.equal(reviewSchema.safeParse({}).success, false);
  assert.equal(passwordSchema.safeParse("too-short").success, false);
});

const dbUrl = process.env.MODERATION_TEST_DATABASE_URL;

test("PostgreSQL: private drafts, review checklist, both signed report formats and protected HOD handoff", { skip: !dbUrl }, async () => {
  process.env.DATABASE_URL = dbUrl;
  process.env.NEXT_PUBLIC_PAPER_MODERATION_ENABLED = "true";
  process.env.PAPER_MODERATION_SESSION_SECRET = "fixture-session-key-not-for-real-use";
  const { prisma } = await import("../../src/lib/prisma");
  const { POST: signIn } = await import("../../src/app/api/auth/login/route");
  const { POST, GET } = await import("../../src/app/api/paper-moderation/route");
  const { POST: getProtected, GET: getPlain } = await import("../../src/app/api/paper-moderation/files/route");
  const { GET: report } = await import("../../src/app/api/paper-moderation/report/route");
  const { GET: sample } = await import("../../src/app/api/paper-moderation/samples/route");
  const { GET: getSettings, POST: postSettings } = await import("../../src/app/api/paper-moderation/settings/route");
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("fixture-account-password");
  const packagePassword = "fixture-package-password-12";
  const tag = randomUUID();
  const path = "/api/paper-moderation";
  const periodBefore = await prisma.moderationSettings.findUnique({ where: { department: "CIS" } });
  let moduleId: number | undefined;
  const users: number[] = [];

  function request(endpoint = "", cookie = "", body?: unknown) {
    const isForm = body instanceof FormData;
    return new Request(`${base}${path}${endpoint}`, { method: body === undefined ? "GET" : "POST",
      headers: { cookie, ...(isForm ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  }
  async function account(label: string, flags: { isHod?: boolean; isActiveLec?: boolean; isExamLec?: boolean; moderationDepartment?: string }) {
    const email = `${label}-${tag}@wyb.ac.lk`;
    const user = await prisma.systemUser.create({ data: { email, passwordHash, ...flags } });
    users.push(user.id);
    const response = await signIn(new Request(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "fixture-account-password" }),
    }));
    assert.equal(response.status, 200);
    return { id: user.id, cookie: response.headers.get("set-cookie")!.split(";")[0] };
  }
  async function assertResponse(response: Response, expected: number) {
    assert.equal(response.status, expected, response.ok ? undefined : await response.clone().text());
    return response;
  }

  try {
    const setter = await account("setter", { isActiveLec: true });
    const moderator = await account("moderator", { isExamLec: true });
    const hod = await account("hod", { isHod: true });
    const otherHod = await account("other-hod", { isHod: true, moderationDepartment: "ELECTRONICS" });
    const lecturer = await account("course-lecturer", {});
    const outsider = await account("outsider", { isActiveLec: true });
    const mod = await prisma.module.create({ data: { code: `FILES-${tag}`, name: "Document fixtures", activeLecturerId: setter.id, examLecturerId: moderator.id } });
    moduleId = mod.id;
    const period = { action: "PERIOD", academicYear: "2026/2027", semester: 2 };
    await assertResponse(await postSettings(request("/settings", outsider.cookie, period)), 403);
    await assertResponse(await postSettings(request("/settings", hod.cookie, period)), 200);
    assert.equal((await (await getSettings(request("/settings", otherHod.cookie))).json()).period, null);
    assert.deepEqual((await (await getSettings(request("/settings", setter.cookie))).json()).period, { academicYear: "2026/2027", semester: 2 });
    const assign = { action: "COURSE_LECTURER", userId: lecturer.id, moduleId, assigned: true };
    await assertResponse(await postSettings(request("/settings", hod.cookie, assign)), 409);
    await assertResponse(await postSettings(request("/settings", otherHod.cookie, { action: "PANEL", userId: lecturer.id, approved: true })), 404);
    await assertResponse(await postSettings(request("/settings", hod.cookie, { action: "PANEL", userId: lecturer.id, approved: true })), 200);
    await assertResponse(await postSettings(request("/settings", hod.cookie, assign)), 200);

    const signatures = new Blob([new Uint8Array(await sharp({ create: { width: 30, height: 10, channels: 3, background: "#17385d" } }).png().toBuffer())], { type: "image/png" });
    const fixtureDocs = await Promise.all(fileSlots.map(async ([slot, , ext]) => {
      const response = await assertResponse(await sample(request(`/samples?slot=${slot}`, setter.cookie)), 200);
      return [slot, await response.blob(), `${slot}${ext}`] as const;
    }));
    function packet(cmd: object, withBundle = false, signature?: string) {
      const body = new FormData(); body.set("command", JSON.stringify(cmd));
      if (withBundle) for (const [slot, blob, name] of fixtureDocs) body.set(slot, blob, name);
      if (signature) body.set(signature, signatures, "signature.png");
      return body;
    }
    const post = (cookie: string, body: unknown) => POST(request("", cookie, body));
    const read = (cookie: string, id: number) => getPlain(request(`/files?id=${id}`, cookie));
    const draft = { action: "CREATE_DRAFT", moduleId, reference: "Private early draft", academicYear: "2026/2027", semester: 2 };
    await assertResponse(await post(setter.cookie, packet(draft, true)), 201);
    const early = await prisma.moderationPaper.findFirstOrThrow({ where: { moduleId }, include: { files: true } });
    const paperId = early.id;
    const earlyFile = early.files.find(file => file.slot === "paperPdf")!;
    assert.equal(early.status, "DRAFT");
    await assertResponse(await read(setter.cookie, earlyFile.id), 200);
    await assertResponse(await read(moderator.cookie, earlyFile.id), 404);
    const modView = await (await GET(request("", moderator.cookie))).json();
    assert.deepEqual(modView.find((row: { id: number }) => row.id === moduleId).papers, []);

    await assertResponse(await post(setter.cookie, packet({ action: "SAVE_DRAFT", paperId, version: 1, reference: "Reviewed draft" }, true)), 200);
    await assertResponse(await post(setter.cookie, packet({ action: "SUBMIT_DRAFT", paperId, version: 2 })), 200);
    const sharedFile = await prisma.moderationFile.findUniqueOrThrow({ where: { paperId_version_slot: { paperId, version: 2, slot: "paperPdf" } } });
    await assertResponse(await read(moderator.cookie, sharedFile.id), 200);
    await assertResponse(await read(lecturer.cookie, sharedFile.id), 200);
    await assertResponse(await read(moderator.cookie, earlyFile.id), 404);
    await assertResponse(await read(hod.cookie, sharedFile.id), 404);
    await assertResponse(await read(outsider.cookie, sharedFile.id), 404);
    assert.equal((await (await GET(request("?scope=hod", hod.cookie))).json()).some((row: { id: number }) => row.id === moduleId), false);

    const review = { action: "REQUEST_REVISION", paperId, version: 3, remarks: Object.fromEntries(criteria.map(([key]) => [key, true])), note: "Check numbering." };
    await assertResponse(await post(moderator.cookie, { action: "APPROVE", paperId, version: 3, note: "" }), 400);
    await assertResponse(await post(moderator.cookie, packet(review, false, "moderatorSignature")), 200);
    await assertResponse(await report(request(`/report?paperId=${paperId}&version=4&format=pdf`, hod.cookie)), 404);
    await assertResponse(await report(request(`/report?paperId=${paperId}&version=4&format=pdf`, setter.cookie)), 200);

    const finish = { action: "FINALIZE", paperId, version: 4, reference: "Final set", followUp: ["Fixed numbering."], password: packagePassword };
    await assertResponse(await post(setter.cookie, packet(finish, false, "lecturerSignature")), 400);
    await assertResponse(await post(setter.cookie, packet(finish, true, "lecturerSignature")), 200);
    const finalized = await prisma.moderationPaper.findUniqueOrThrow({ where: { id: paperId }, include: { files: true } });
    assert.equal(finalized.status, "FINALIZED");
    assert.notEqual(finalized.filePasswordHash, packagePassword);
    assert.ok(finalized.handoffAt);
    const file = finalized.files.find(file => file.slot === "paperPdf" && file.protected)!;
    const word = finalized.files.find(file => file.slot === "paperWord" && file.protected)!;
    const pdfWithPassword = await PDF.load(file.content, { credentials: packagePassword });
    assert.equal(pdfWithPassword.getSecurity().algorithm, "AES-256");
    assert.ok(officeCrypto.isEncrypted(Buffer.from(word.content)));
    const finalReq = (cookie: string, id: number, password: string, mode = "protected") => getProtected(request("/files", cookie, { id, password, mode }));
    await assertResponse(await read(hod.cookie, file.id), 403);
    await assertResponse(await finalReq(hod.cookie, file.id, "wrong-password-bad"), 403);
    await assertResponse(await finalReq(lecturer.cookie, file.id, packagePassword), 404);
    await assertResponse(await finalReq(outsider.cookie, file.id, packagePassword), 404);
    await assertResponse(await finalReq(otherHod.cookie, file.id, packagePassword), 404);
    assert.deepEqual(await (await GET(request("?scope=hod", otherHod.cookie))).json(), []);
    await assertResponse(await report(request(`/report?paperId=${paperId}&version=4&format=pdf`, otherHod.cookie)), 404);
    await assertResponse(await finalReq(moderator.cookie, file.id, packagePassword), 200);
    const unlocked = await assertResponse(await finalReq(hod.cookie, file.id, packagePassword, "unlocked"), 200);
    assert.equal((await PDF.load(new Uint8Array(await unlocked.arrayBuffer()))).isEncrypted, false);
    const decrypted = await assertResponse(await finalReq(hod.cookie, word.id, packagePassword, "unlocked"), 200);
    assert.ok((await JSZip.loadAsync(await decrypted.arrayBuffer())).file("word/document.xml"));
    const inbox = await (await GET(request("?scope=hod", hod.cookie))).json();
    const handoff = inbox.find((row: { id: number }) => row.id === moduleId).papers[0];
    assert.equal(handoff.files.length, 4);
    assert.equal(handoff.events.some((event: { action: string }) => event.action === "SAVE_DRAFT"), false);
    assert.equal("filePasswordHash" in handoff, false);
    const pdf = await assertResponse(await report(request(`/report?paperId=${paperId}&version=4&format=pdf`, hod.cookie)), 200);
    assert.ok((await PDF.load(new Uint8Array(await pdf.arrayBuffer()))).getPageCount() >= 1);
    const docx = await assertResponse(await report(request(`/report?paperId=${paperId}&version=4&format=docx`, hod.cookie)), 200);
    const reportZip = await JSZip.loadAsync(await docx.arrayBuffer());
    assert.match(await reportZip.file("word/document.xml")!.async("text"), /Fixed numbering/);
    assert.ok(Object.keys(reportZip.files).some(name => /^word\/media\/.+\.png$/.test(name)));
    await assertResponse(await postSettings(request("/settings", hod.cookie, { action: "PANEL", userId: moderator.id, approved: false })), 200);
    await assertResponse(await finalReq(moderator.cookie, file.id, packagePassword), 403);
    assert.deepEqual((await prisma.module.findUniqueOrThrow({ where: { id: moduleId } })).stats, mod.stats);
    assert.equal(await prisma.studentMark.count({ where: { moduleCode: mod.code } }), 0);
  } finally {
    if (moduleId) {
      await prisma.moderationFile.deleteMany({ where: { paper: { moduleId } } });
      await prisma.moderationEvent.deleteMany({ where: { paper: { moduleId } } });
      await prisma.moderationPaper.deleteMany({ where: { moduleId } });
      await prisma.module.delete({ where: { id: moduleId } });
    }
    await prisma.systemUser.deleteMany({ where: { id: { in: users } } });
    if (periodBefore) await prisma.moderationSettings.upsert({ where: { department: "CIS" }, create: periodBefore, update: periodBefore });
    else await prisma.moderationSettings.deleteMany({ where: { department: "CIS" } });
    await prisma.$disconnect();
  }
});
