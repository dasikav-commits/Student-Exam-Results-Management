import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { issueSession, readSessionId, SESSION_SECONDS, verifySession } from "../../src/lib/moderation-session-token";
import { moderationCommand, moderationRoles, moderationTransition } from "../../src/lib/paper-moderation";

const secret = "test-only-secret-not-for-deployment";

test("signed sessions expire and are bound to the user and current password", () => {
  const now = 1_800_000_000_000;
  const token = issueSession(123, "password-hash", secret, now);
  assert.equal(readSessionId(token, now), 123);
  assert.equal(verifySession(token, "password-hash", secret, now), true);
  assert.equal(verifySession(token.replace(/^123/, "124"), "password-hash", secret, now), false);
  assert.equal(verifySession(token, "changed", secret, now), false);
  assert.equal(verifySession(token, "password-hash", `${secret}rotated`, now), false);
  assert.equal(readSessionId(token, now + SESSION_SECONDS * 1000), null);
  assert.equal(verifySession("123.fake", "password-hash", secret, now), false);
});

test("capabilities are module-specific and dual-capability users cannot self-review", () => {
  const actor = { id: 1, role: "LECTURER", isActiveLec: true, isExamLec: true };
  assert.deepEqual(moderationRoles(actor, { activeLecturerId: 1, examLecturerId: 2 }), { setter: true, moderator: false });
  assert.deepEqual(moderationRoles(actor, { activeLecturerId: 2, examLecturerId: 1 }), { setter: false, moderator: true });
  assert.deepEqual(moderationRoles(actor, { activeLecturerId: 1, examLecturerId: 1 }), { setter: true, moderator: false });
  assert.deepEqual(moderationRoles({ ...actor, isExamLec: false }, { activeLecturerId: 2, examLecturerId: 1 }), { setter: false, moderator: false });
  assert.deepEqual(moderationRoles({ ...actor, role: "ADMIN" }, { activeLecturerId: 1, examLecturerId: 2 }), { setter: false, moderator: false });
});

test("validates academic year, prevents identity spoofing, and requires revision notes", () => {
  const submission = { action: "SUBMIT", moduleId: 1, academicYear: "2026/2027", semester: 1, reference: " v1 " };
  assert.deepEqual(moderationCommand.parse(submission), { ...submission, reference: "v1" });
  for (const invalid of [{ academicYear: "2026/2028" }, { semester: 0 }, { actorId: 2 }, { reference: "   " }]) {
    assert.equal(moderationCommand.safeParse({ ...submission, ...invalid }).success, false);
  }
  assert.equal(moderationCommand.safeParse({ action: "REQUEST_REVISION", paperId: 1, version: 1, note: " " }).success, false);
  assert.equal(moderationCommand.safeParse({ action: "APPROVE", paperId: 1, version: 0, note: "" }).success, false);
});

test("only submitted papers can be reviewed and only returned papers can be resubmitted", () => {
  assert.equal(moderationTransition("REQUEST_REVISION", "UNDER_MODERATION"), "REVISION_REQUIRED");
  assert.equal(moderationTransition("RESUBMIT", "REVISION_REQUIRED"), "UNDER_MODERATION");
  assert.equal(moderationTransition("APPROVE", "UNDER_MODERATION"), "APPROVED");
  assert.equal(moderationTransition("APPROVE", "REVISION_REQUIRED"), null);
  assert.equal(moderationTransition("RESUBMIT", "UNDER_MODERATION"), null);
  assert.equal(moderationTransition("REQUEST_REVISION", "APPROVED"), null);
});

const dbUrl = process.env.MODERATION_TEST_DATABASE_URL;

test("PostgreSQL: existing login, assignment boundaries, submit-review-revise-approve, and untouched marks", { skip: !dbUrl }, async () => {
  process.env.DATABASE_URL = dbUrl;
  process.env.NEXT_PUBLIC_PAPER_MODERATION_ENABLED = "true";
  process.env.PAPER_MODERATION_SESSION_SECRET = secret;
  const { prisma } = await import("../../src/lib/prisma");
  const { POST: login } = await import("../../src/app/api/auth/login/route");
  const { POST: logout } = await import("../../src/app/api/auth/logout/route");
  const { GET, POST } = await import("../../src/app/api/paper-moderation/route");
  const { PATCH: changeCapability } = await import("../../src/app/api/admin/users/route");
  const { PATCH: reassign } = await import("../../src/app/api/hod/lecturers/route");
  const { PATCH: changeRecovery } = await import("../../src/app/api/auth/profile/route");
  const { DELETE: deleteModule } = await import("../../src/app/api/hod/modules/route");
  const { hashPassword } = await import("../../src/lib/password");
  const url = "https://results.example.test";
  const req = (path: string, method: string, cookie = "", body?: unknown, extraHeaders?: Record<string, string>) =>
    new Request(`${url}${path}`, { method, headers: { cookie, "content-type": "application/json", ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
  const path = "/api/paper-moderation";
  const tag = randomUUID();
  const accounts: number[] = [];
  const modules: number[] = [];
  const password = "fixture-password";
  const passwordHash = await hashPassword(password);

  async function account(name: string, flags: { role?: string; isHod?: boolean; isActiveLec?: boolean; isExamLec?: boolean }) {
    const email = `${name}-${tag}@example.test`;
    const user = await prisma.systemUser.create({ data: { email, passwordHash, ...flags } });
    accounts.push(user.id);
    const response = await login(req("/api/auth/login", "POST", "", { email, password }));
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    return { id: user.id, email, cookie: cookie.split(";")[0] };
  }

  try {
    const setter = await account("setter", { isActiveLec: true, isExamLec: true });
    const moderator = await account("moderator", { isExamLec: true });
    const outsider = await account("outsider", { isExamLec: true });
    const administrator = await account("admin", { role: "ADMIN" });
    const hod = await account("hod", { isHod: true });
    const assigned = await prisma.module.create({ data: { code: `MOD-${tag}`.toUpperCase(), name: "Fixture Module", activeLecturerId: setter.id, examLecturerId: moderator.id } });
    modules.push(assigned.id);
    const unassigned = await prisma.module.create({ data: { code: `NO-MOD-${tag}`.toUpperCase(), name: "Unassigned Fixture", activeLecturerId: setter.id } });
    modules.push(unassigned.id);
    const mark = await prisma.studentMark.create({ data: { moduleCode: assigned.code, studentIndex: "fixture-only" } });
    const submit = (cookie: string, body: unknown) => POST(req(path, "POST", cookie, body));
    const list = (cookie: string) => GET(req(path, "GET", cookie));
    const draft = { action: "SUBMIT", moduleId: assigned.id, reference: "Paper v1", academicYear: "2026/2027", semester: 1 };

    assert.equal((await list("")).status, 401);
    assert.equal((await list(administrator.cookie)).status, 403);
    assert.deepEqual(await (await list(outsider.cookie)).json(), []);
    assert.equal((await changeCapability(req("/api/admin/users", "PATCH", setter.cookie, { id: setter.id, flag: "isHod", value: true }))).status, 403);
    assert.equal((await reassign(req("/api/hod/lecturers", "PATCH", outsider.cookie, { lecturerId: outsider.id, examModuleCodes: [assigned.code] }))).status, 403);
    assert.equal((await changeRecovery(req("/api/auth/profile", "PATCH", outsider.cookie, { email: setter.email, recoveryEmail: outsider.email }))).status, 403);
    assert.equal((await POST(req(path, "POST", setter.cookie, draft, { "sec-fetch-site": "same-site" }))).status, 403);
    assert.equal((await submit(moderator.cookie, draft)).status, 404);
    assert.equal((await submit(setter.cookie, { ...draft, moduleId: unassigned.id })).status, 409);
    assert.equal((await submit(setter.cookie, draft)).status, 201);
    assert.equal((await submit(setter.cookie, draft)).status, 409);

    const moderated = await (await list(moderator.cookie)).json();
    assert.equal(moderated.length, 1);
    assert.equal(moderated[0].moderator, true);
    assert.equal(moderated[0].setter, false);
    assert.equal(moderated[0].papers[0].status, "UNDER_MODERATION");
    const paperId = moderated[0].papers[0].id;
    const revision = { action: "REQUEST_REVISION", paperId, version: 1, note: "Check question numbering" };
    assert.equal((await submit(outsider.cookie, revision)).status, 404);
    assert.equal((await submit(setter.cookie, revision)).status, 403);
    await prisma.module.update({ where: { id: assigned.id }, data: { activeLecturerId: null, examLecturerId: setter.id } });
    assert.equal((await submit(setter.cookie, revision)).status, 403, "author cannot review even after reassignment");
    await prisma.module.update({ where: { id: assigned.id }, data: { activeLecturerId: setter.id, examLecturerId: moderator.id } });
    assert.equal((await submit(moderator.cookie, revision)).status, 200);
    assert.equal((await submit(moderator.cookie, { action: "APPROVE", paperId, version: 2, note: "" })).status, 409);
    assert.equal((await submit(setter.cookie, { action: "RESUBMIT", paperId, version: 2, reference: "Paper v2" })).status, 200);
    assert.equal((await submit(moderator.cookie, { action: "APPROVE", paperId, version: 1, note: "" })).status, 409);
    const approval = { action: "APPROVE", paperId, version: 3, note: "Confirmed" };
    const simultaneous = await Promise.all([submit(moderator.cookie, approval), submit(moderator.cookie, approval)]);
    assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);

    const final = await prisma.moderationPaper.findUniqueOrThrow({ where: { id: paperId }, include: { events: { orderBy: { version: "asc" } } } });
    assert.equal(final.reference, "Paper v2");
    assert.equal(final.status, "APPROVED");
    assert.deepEqual(final.events.map(event => [event.action, event.actorId]), [
      ["SUBMIT", setter.id], ["REQUEST_REVISION", moderator.id], ["RESUBMIT", setter.id], ["APPROVE", moderator.id],
    ]);
    assert.deepEqual(await prisma.studentMark.findUnique({ where: { id: mark.id } }), mark);
    assert.deepEqual((await prisma.module.findUniqueOrThrow({ where: { id: assigned.id } })).stats, assigned.stats);
    assert.equal((await deleteModule(req(`/api/hod/modules?code=${assigned.code}`, "DELETE", hod.cookie))).status, 409);

    assert.equal((await changeCapability(req("/api/admin/users", "PATCH", administrator.cookie, { id: moderator.id, flag: "isExamLec", value: false }))).status, 200);
    assert.equal((await list(moderator.cookie)).status, 403);
    await prisma.systemUser.update({ where: { id: setter.id }, data: { passwordHash: await hashPassword("changed-password") } });
    assert.equal((await list(setter.cookie)).status, 401);
    assert.match(logout(req("/api/auth/logout", "POST", setter.cookie)).headers.get("set-cookie") ?? "", /Max-Age=0/i);
    process.env.NEXT_PUBLIC_PAPER_MODERATION_ENABLED = "false";
    assert.equal((await list(setter.cookie)).status, 404);
  } finally {
    await prisma.moderationEvent.deleteMany({ where: { paper: { moduleId: { in: modules } } } });
    await prisma.moderationPaper.deleteMany({ where: { moduleId: { in: modules } } });
    await prisma.module.deleteMany({ where: { id: { in: modules } } });
    await prisma.systemUser.deleteMany({ where: { id: { in: accounts } } });
    await prisma.$disconnect();
  }
});
