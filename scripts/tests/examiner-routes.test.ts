import assert from "node:assert/strict";
import { before, afterEach, mock, test } from "node:test";
// Install a fail-closed in-memory Prisma double before loading route modules.
// This exercises Request/Response handlers without connecting to a database.
const unexpected = () => { throw new Error("Unexpected database call"); };
const prisma = {
  module: { findUnique: unexpected, findMany: unexpected, update: unexpected },
  systemUser: { findFirst: unexpected },
  studentMark: { findMany: unexpected, updateMany: unexpected },
  $transaction: unexpected,
};
let GET: (request: Request) => Promise<Response>;
let PATCH: (request: Request) => Promise<Response>;
let lecturerModulePatch: (request: Request) => Promise<Response>;
let approveMarks: (request: Request) => Promise<Response>;
let finaliseReconciled: (request: Request) => Promise<Response>;
let adminModulePatch: (request: Request) => Promise<Response>;
let lecturerMarksPost: (request: Request) => Promise<Response>;
before(async () => {
  Object.assign(globalThis, { prisma });
  ({ GET, PATCH } = await import("../../src/app/api/examiner/marks/route"));
  ({ PATCH: lecturerModulePatch } = await import("../../src/app/api/lecturer/modules/route"));
  ({ POST: approveMarks } = await import("../../src/app/api/lecturer/marks/approve/route"));
  ({ POST: finaliseReconciled } = await import("../../src/app/api/examiner/marks/finalise-reconciled/route"));
  ({ PATCH: adminModulePatch } = await import("../../src/app/api/admin/modules/route"));
  ({ POST: lecturerMarksPost } = await import("../../src/app/api/lecturer/marks/route"));
});
import { normaliseFinalBlueprint } from "../../src/lib/lecturer-marks";

const bp = normaliseFinalBlueprint({ enabled: true, weightage: 100, theory: { mcq: { questions: [{ id: "Q1", maxMarks: 100 }], questionsToAnswer: 1 } } });
const marks = (Q1: number) => ({ theory: { mcq: { Q1 }, essay: {} }, practical: {} });
const row = { id: 1, moduleCode: "TEST", studentIndex: "TEST001", caQuestionsMarks: { secret: { Q1: 99 } }, isAbsentCa: { secret: true }, finalExamQuestionsMarks: marks(69.5), secondExamMarks: {}, isAbsentTheory: false, isAbsentPractical: false, isAbsentFinal: false, isEligible: true };
const moduleRecord = (status: string, examiner: number | null = 2) => ({ id: 1, code: "TEST", isFrozen: false, examLecturerId: examiner, stats: { finalBlueprint: bp, marksheetStatus: status } });
const request = (body: unknown, method = "PATCH") => new Request("http://test/api/marks", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const body = { moduleCode: "TEST", students: [{ studentIndex: row.studentIndex, secondExamMarks: marks(70), isAbsentTheory: false, isAbsentPractical: false }] };
afterEach(() => mock.restoreAll());

test("examiner GET selects no CA fields and seeds corrections from first marks", async () => {
  mock.method(prisma.module, "findUnique", async () => moduleRecord("SECOND_CHECKING"));
  let select: Record<string, boolean> = {};
  mock.method(prisma.studentMark, "findMany", async (args: { select: Record<string, boolean> }) => {
    select = args.select;
    return [Object.fromEntries(Object.entries(row).filter(([key]) => select[key]))];
  });
  const res = await GET(new Request("http://test/api/examiner/marks?moduleCode=TEST"));
  assert.equal(res.status, 200);
  const [result] = await res.json();
  assert.equal(select.caQuestionsMarks, undefined);
  assert.equal(select.isAbsentCa, undefined);
  assert.equal("caQuestionsMarks" in result, false);
  assert.equal("isAbsentCa" in result, false);
  assert.equal(result.secondExamMarks.theory.mcq.Q1, 69.5);
  assert.equal(result.finalExamQuestionsMarks.theory.mcq.Q1, 69.5);
});

for (const status of ["DRAFT", "MARKING"]) {
  test(`examiner save before handover (${status}) returns 409 without writes`, async () => {
    mock.method(prisma.module, "findUnique", async () => moduleRecord(status));
    const write = mock.method(prisma.studentMark, "updateMany", () => { throw new Error("must not write"); });
    const res = await PATCH(request(body));
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /hand over/);
    assert.equal(write.mock.callCount(), 0);
  });
}

test("handed-over progress saves only the correction ledger, not original or CA marks", async () => {
  mock.method(prisma.module, "findUnique", async () => moduleRecord("SECOND_CHECKING"));
  let update: Record<string, unknown> = {};
  mock.method(prisma.studentMark, "updateMany", (args: { data: Record<string, unknown> }) => { update = args.data; return Promise.resolve({ count: 1 }); });
  mock.method(prisma, "$transaction", async (ops: Promise<unknown>[]) => Promise.all(ops));
  const res = await PATCH(request(body));
  assert.equal(res.status, 200);
  assert.deepEqual(update.secondExamMarks, marks(70));
  assert.equal("finalExamQuestionsMarks" in update, false);
  assert.equal("caQuestionsMarks" in update, false);
});

for (const [secondMark, expected] of [[70, "FINALIZED"], [75, "RECONCILIATION_NEEDED"]] as const) {
  test(`finalisation uses variance threshold: ${secondMark} → ${expected}`, async () => {
    mock.method(prisma.module, "findUnique", async () => moduleRecord("SECOND_CHECKING"));
    mock.method(prisma.studentMark, "updateMany", () => Promise.resolve({ count: 1 }));
    mock.method(prisma, "$transaction", async (ops: Promise<unknown>[]) => Promise.all(ops));
    mock.method(prisma.studentMark, "findMany", async () => [{ ...row, secondExamMarks: marks(secondMark) }]);
    let nextStatus;
    mock.method(prisma.module, "update", async (args: { data: { stats: { marksheetStatus: string } } }) => { nextStatus = args.data.stats.marksheetStatus; return {}; });
    const res = await PATCH(request({ ...body, finalize: true }));
    assert.equal(res.status, 200);
    assert.equal(nextStatus, expected);
  });
}

test("explicit Second Examiner submission requires an assigned examiner", async () => {
  mock.method(prisma.module, "findUnique", async () => moduleRecord("MARKING", null));
  const res = await lecturerModulePatch(request({ moduleCode: "TEST", marksheetStatus: "SECOND_CHECKING", submittedTo: "SECOND_EXAMINER" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Assign a Second Examiner/);
});

test("Second Examiner handover records recipient/time; recall remains possible", async () => {
  let mod = moduleRecord("MARKING");
  mock.method(prisma.module, "findUnique", async () => mod);
  mock.method(prisma.studentMark, "findMany", async () => [{ ...row, isAbsentCa: {} }]);
  mock.method(prisma.module, "update", async (args: { data: { stats: typeof mod.stats } }) => { mod = { ...mod, stats: args.data.stats }; return mod; });
  const res = await lecturerModulePatch(request({ moduleCode: "TEST", marksheetStatus: "SECOND_CHECKING", submittedTo: "SECOND_EXAMINER" }));
  assert.equal(res.status, 200);
  const submitted = await res.json();
  assert.equal(submitted.stats.submittedTo, "SECOND_EXAMINER");
  assert.ok(submitted.stats.submittedAt);
  const recalled = await lecturerModulePatch(request({ moduleCode: "TEST", marksheetStatus: "MARKING" }));
  assert.equal(recalled.status, 200);
  const result = await recalled.json();
  assert.equal(result.stats.marksheetStatus, "MARKING");
  assert.ok(result.stats.recalledAt);
});

test("First Examiner cannot edit marks during second checking", async () => {
  mock.method(prisma.module, "findUnique", async () => moduleRecord("SECOND_CHECKING"));
  const res = await lecturerMarksPost(request({ moduleCode: "TEST", students: [row] }, "POST"));
  assert.equal(res.status, 409);
});

for (const status of ["FINALIZED", "RECONCILIATION_NEEDED", "RECONCILED"]) {
  test(`second-marking edits are locked in ${status}`, async () => {
    mock.method(prisma.module, "findUnique", async () => moduleRecord(status));
    assert.equal((await PATCH(request(body))).status, 409);
  });
}


test("Admin can assign a capable, distinct Second Examiner", async () => {
  mock.method(prisma.module, "findUnique", async () => ({ ...moduleRecord("MARKING"), activeLecturerId: 1 }));
  mock.method(prisma.systemUser, "findFirst", async (args: { where: { isExamLec: boolean } }) => {
    assert.equal(args.where.isExamLec, true);
    return { id: 2 };
  });
  let assigned;
  mock.method(prisma.module, "update", async (args: { data: { examLecturerId: number } }) => { assigned = args.data.examLecturerId; return {}; });
  const res = await adminModulePatch(request({ moduleCode: "TEST", examLecturerId: 2 }));
  assert.equal(res.status, 200);
  assert.equal(assigned, 2);
});

test("Admin assignment rejects self-assignment, incapable examiners and submitted modules", async () => {
  let mod = { ...moduleRecord("MARKING"), activeLecturerId: 1 };
  mock.method(prisma.module, "findUnique", async () => mod);
  mock.method(prisma.systemUser, "findFirst", async () => null);
  assert.equal((await adminModulePatch(request({ moduleCode: "TEST", examLecturerId: 1 }))).status, 400);
  assert.equal((await adminModulePatch(request({ moduleCode: "TEST", examLecturerId: 3 }))).status, 400);
  mod = { ...mod, stats: { ...mod.stats, marksheetStatus: "SECOND_CHECKING" } };
  assert.equal((await adminModulePatch(request({ moduleCode: "TEST", examLecturerId: null }))).status, 409);
});

test("blueprint save persists optional checking statement and common MCQ effective maxima", async () => {
  mock.method(prisma.module, "findUnique", async () => moduleRecord("MARKING"));
  mock.method(prisma.module, "update", async (args: { data: { stats: unknown } }) => ({ stats: args.data.stats }));
  mock.method(prisma.studentMark, "findMany", async () => []);
  const mcq = { ...bp.theory.mcq, weightingMode: "common", commonMaxMarks: 3 };
  const res = await lecturerModulePatch(request({ moduleCode: "TEST", caComponents: [], finalBlueprint: { ...bp, theory: { ...bp.theory, mcq } }, secondChecking: "optional" }));
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.stats.secondChecking, "optional");
  assert.equal(result.stats.finalBlueprint.theory.mcq.questions[0].maxMarks, 3);
  assert.equal(result.stats.finalBlueprint.theory.mcq.individualMaxMarks.Q1, 100);
});

for (const recipient of ["FACULTY", "HOD"]) {
  test(`existing submission recipient ${recipient} is retained`, async () => {
    mock.method(prisma.module, "findUnique", async () => moduleRecord("MARKING"));
    mock.method(prisma.studentMark, "findMany", async () => [{ ...row, isAbsentCa: {} }]);
    mock.method(prisma.module, "update", async (args: { data: { stats: unknown } }) => ({ stats: args.data.stats }));
    const res = await lecturerModulePatch(request({ moduleCode: "TEST", marksheetStatus: "SECOND_CHECKING", submittedTo: recipient }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stats.submittedTo, recipient);
  });
}


test("variance reconciliation still requires First Examiner approval before closing", async () => {
  let mod = moduleRecord("RECONCILIATION_NEEDED");
  mock.method(prisma.module, "findUnique", async () => mod);
  mock.method(prisma.module, "update", async (args: { data: { stats: typeof mod.stats } }) => { mod = { ...mod, stats: args.data.stats }; return mod; });
  assert.equal((await finaliseReconciled(request({ moduleCode: "TEST" }, "POST"))).status, 403);
  assert.equal((await approveMarks(request({ moduleCode: "TEST" }, "POST"))).status, 200);
  const result = await finaliseReconciled(request({ moduleCode: "TEST" }, "POST"));
  assert.equal(result.status, 200);
  assert.equal(mod.stats.marksheetStatus, "RECONCILED");
});
