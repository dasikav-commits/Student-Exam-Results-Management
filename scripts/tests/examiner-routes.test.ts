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
import { normaliseCaComponent, normaliseFinalBlueprint } from "../../src/lib/lecturer-marks";

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

// ─── Highest-scoring required answers: any N complete a section, the highest N count ───

const bestNBlueprint = normaliseFinalBlueprint({
  enabled: true, weightage: 60,
  theory: {
    mcq: { questions: [{ id: "Q1", maxMarks: 10 }], questionsToAnswer: 1 },
    essay: { questions: ["Q1", "Q2", "Q3"].map(id => ({ id, maxMarks: 20 })), questionsToAnswer: 2 },
  },
  practical: { questions: ["Q1", "Q2", "Q3"].map(id => ({ id, maxMarks: 25 })), questionsToAnswer: 2 },
});
const bestNQuiz = normaliseCaComponent({
  id: "quiz", type: "QUIZ", name: "Quiz 1", weightage: 40, scoreMode: "SUM",
  totalQuestions: 6, questionMarks: [10, 10, 10, 10, 10, 10], questionsToAnswer: 4,
});
const bestNModule = (status: string, caComponents: unknown[] = [bestNQuiz]) => ({
  id: 1, code: "TEST", isFrozen: false, examLecturerId: 2,
  stats: { caComponents, finalBlueprint: bestNBlueprint, marksheetStatus: status },
});
const sectionMarks = (essay: Record<string, number>, practical: Record<string, number>) =>
  ({ theory: { mcq: { Q1: 8 }, essay }, practical });
const bestNRow = (first: unknown, second: unknown, quiz: Record<string, number> = { Q3: 1, Q4: 2, Q5: 3, Q6: 4 }) => ({
  id: 1, moduleCode: "TEST", studentIndex: "S001",
  caQuestionsMarks: { quiz }, isAbsentCa: {}, finalExamQuestionsMarks: first, secondExamMarks: second,
  isAbsentTheory: false, isAbsentPractical: false, isAbsentFinal: false, isEligible: true,
});
const secondBody = (second: unknown) => ({
  moduleCode: "TEST", finalize: true,
  students: [{ studentIndex: "S001", secondExamMarks: second, isAbsentTheory: false, isAbsentPractical: false }],
});

test("Second Examiner finalisation accepts any N answers per section; each examiner's highest N count", async () => {
  // The first examiner's best two Essay answers are Q1 + Q3; the second examiner never marked Q1 at all.
  const first = sectionMarks({ Q1: 20, Q2: 5, Q3: 10 }, { Q1: 25, Q2: 20 });
  const second = sectionMarks({ Q2: 15, Q3: 15 }, { Q2: 25, Q3: 20 });
  mock.method(prisma.module, "findUnique", async () => bestNModule("SECOND_CHECKING"));
  mock.method(prisma.studentMark, "updateMany", () => Promise.resolve({ count: 1 }));
  mock.method(prisma, "$transaction", async (ops: Promise<unknown>[]) => Promise.all(ops));
  mock.method(prisma.studentMark, "findMany", async () => [bestNRow(first, second)]);
  let nextStatus;
  mock.method(prisma.module, "update", async (args: { data: { stats: { marksheetStatus: string } } }) => { nextStatus = args.data.stats.marksheetStatus; return {}; });

  const res = await PATCH(request(secondBody(second)));
  assert.equal(res.status, 200, "Q2 + Q3 are two answers, so the Essay is complete");
  // Both examiners total 30 + 45 + 8 on their own highest answers, so there is no variance. First-N
  // logic would have compared 25 against 15 and sent this sheet to reconciliation.
  assert.equal(nextStatus, "FINALIZED");
});

test("Second Examiner finalisation refuses fewer than N answers and says how many are recorded", async () => {
  const first = sectionMarks({ Q1: 20, Q2: 5, Q3: 10 }, { Q1: 25, Q2: 20 });
  const second = sectionMarks({ Q3: 15 }, { Q2: 25, Q3: 20 }); // the Essay needs two answers
  mock.method(prisma.module, "findUnique", async () => bestNModule("SECOND_CHECKING"));
  mock.method(prisma.studentMark, "updateMany", () => Promise.resolve({ count: 1 }));
  mock.method(prisma, "$transaction", async (ops: Promise<unknown>[]) => Promise.all(ops));
  mock.method(prisma.studentMark, "findMany", async () => [bestNRow(first, second)]);
  const closeModule = mock.method(prisma.module, "update", () => { throw new Error("must not change status"); });

  const res = await PATCH(request(secondBody(second)));
  assert.equal(res.status, 400);
  const result = await res.json();
  assert.match(result.error, /Second marking is incomplete/);
  assert.deepEqual(result.issues, ["S001 · Theory · Essay: 1 of 2 required answers recorded"]);
  assert.equal(closeModule.mock.callCount(), 0);

  // Unknown question IDs are ignored, so they cannot make up the missing answer.
  const stray = sectionMarks({ Q3: 15, Q9: 20 }, { Q2: 25, Q3: 20 });
  mock.method(prisma.studentMark, "findMany", async () => [bestNRow(first, stray)]);
  const strayRes = await PATCH(request(secondBody(stray)));
  assert.equal(strayRes.status, 400);
  assert.deepEqual((await strayRes.json()).issues, ["S001 · Theory · Essay: 1 of 2 required answers recorded"]);
});

test("First Examiner handover accepts any N CA and Final answers; extra answers do not block", async () => {
  const complete = sectionMarks({ Q1: 20, Q3: 10 }, { Q2: 25, Q3: 20 }); // Practical Q1 is blank — any two will do
  const rows = [bestNRow(complete, {})]; // the quiz has only Q3–Q6 answered
  mock.method(prisma.module, "findUnique", async () => bestNModule("MARKING"));
  mock.method(prisma.studentMark, "findMany", async () => rows);
  mock.method(prisma.module, "update", async (args: { data: { stats: unknown } }) => ({ stats: args.data.stats }));
  const submit = () => lecturerModulePatch(request({ moduleCode: "TEST", marksheetStatus: "SECOND_CHECKING", submittedTo: "SECOND_EXAMINER" }));

  assert.equal((await submit()).status, 200, "Q3–Q6 of the quiz are four answers");

  rows[0] = bestNRow(complete, {}, { Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 9, Q6: 10 });
  assert.equal((await submit()).status, 200, "six answers where four are required is only a warning");

  rows[0] = bestNRow(complete, {}, { Q1: 1, Q2: 2, Q6: 4 });
  const shortQuiz = await submit();
  assert.equal(shortQuiz.status, 400);
  assert.match((await shortQuiz.json()).error, /Quiz 1 — 3 of 4 required answers recorded/);

  // Marks for questions that do not exist cannot stand in for a missing answer.
  rows[0] = bestNRow(complete, {}, { Q1: 1, Q2: 2, Q3: 3, Q99: 4 });
  const strayQuiz = await submit();
  assert.equal(strayQuiz.status, 400);
  assert.match((await strayQuiz.json()).error, /Quiz 1 — 3 of 4 required answers recorded/);

  rows[0] = bestNRow(sectionMarks({ Q1: 20 }, { Q2: 25, Q3: 20 }), {});
  const shortEssay = await submit();
  assert.equal(shortEssay.status, 400);
  assert.match((await shortEssay.json()).error, /Theory · Essay — 1 of 2 required marks recorded/);
});

test("blueprint save persists CA common weighting, hidden individual maxima and required answers, and rejects invalid values", async () => {
  mock.method(prisma.module, "findUnique", async () => bestNModule("MARKING"));
  mock.method(prisma.module, "update", async (args: { data: { stats: unknown } }) => ({ stats: args.data.stats }));
  mock.method(prisma.studentMark, "findMany", async () => []);
  const commonQuiz = {
    id: "quiz", type: "MCQ", name: "MCQ test", weightage: 40, scoreMode: "SUM", totalQuestions: 6,
    weightingMode: "common", commonMaxMarks: 7, questionMarks: [7, 7, 7, 7, 7, 7],
    individualQuestionMarks: [5, 8, 10, 2, 6, 9], questionsToAnswer: 4,
  };
  const save = (component: unknown) => lecturerModulePatch(request({ moduleCode: "TEST", caComponents: [component], finalBlueprint: bestNBlueprint }));

  const res = await save(commonQuiz);
  assert.equal(res.status, 200);
  const [saved] = (await res.json()).stats.caComponents;
  assert.equal(saved.type, "MCQ");
  assert.equal(saved.weightingMode, "common");
  assert.equal(saved.commonMaxMarks, 7);
  assert.deepEqual(saved.questionMarks, [7, 7, 7, 7, 7, 7]);
  assert.deepEqual(saved.individualQuestionMarks, [5, 8, 10, 2, 6, 9], "the hidden individual maxima survive the save");
  assert.equal(saved.questionsToAnswer, 4);

  // Reloading the saved shape and saving again changes nothing.
  const again = await save(saved);
  assert.equal(again.status, 200);
  assert.deepEqual((await again.json()).stats.caComponents[0], saved);

  for (const [override, message] of [
    [{ commonMaxMarks: 0 }, /common weight must be greater than 0/],
    [{ questionsToAnswer: 7 }, /required answers must be a whole number between 1 and 6/],
    [{ questionsToAnswer: 0 }, /required answers must be a whole number between 1 and 6/],
    [{ weightingMode: "mixed" }, /weighting mode must be individual or common/],
  ] as const) {
    const rejected = await save({ ...commonQuiz, ...override });
    assert.equal(rejected.status, 400, JSON.stringify(override));
    assert.match((await rejected.json()).error, message);
  }
});

test("saving marks stores every entered answer, clamps to each question's maximum and drops unknown IDs", async () => {
  const commonQuiz = normaliseCaComponent({
    id: "quiz", type: "QUIZ", name: "Quiz 1", weightage: 40, scoreMode: "SUM", totalQuestions: 6,
    weightingMode: "common", commonMaxMarks: 5, questionMarks: [5, 5, 5, 5, 5, 5], questionsToAnswer: 4,
  });
  mock.method(prisma.module, "findUnique", async () => bestNModule("MARKING", [commonQuiz]));
  mock.method(prisma.studentMark, "findMany", async () => [{ studentIndex: "S001", secondExamMarks: {} }]);
  let saved: { caQuestionsMarks: Record<string, Record<string, number>> } | undefined;
  mock.method(prisma.studentMark, "updateMany", (args: { data: typeof saved }) => { saved = args.data; return Promise.resolve({ count: 1 }); });
  mock.method(prisma, "$transaction", async (ops: Promise<unknown>[]) => Promise.all(ops));

  const res = await lecturerMarksPost(request({
    moduleCode: "TEST",
    students: [{ studentIndex: "S001", caQuestionsMarks: { quiz: { Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 9, Q6: 4.5, Q99: 4 } }, finalExamQuestionsMarks: {} }],
  }, "POST"));
  assert.equal(res.status, 200);
  assert.deepEqual(
    saved?.caQuestionsMarks.quiz,
    { Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 5, Q6: 4.5 },
    "all six answers are stored (only four will count); Q5 is clamped to the common maximum; Q99 is not a question"
  );
});
