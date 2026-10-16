import assert from "node:assert/strict";
import { test } from "node:test";
import { GRADE_BANDS, gradeForMark, hasGradeAbsence, roundUpWhole, formatMark2dp } from "../../src/lib/grading";
import { buildMarksheetCsv, computeWeightedScores, normaliseFinalBlueprint } from "../../src/lib/lecturer-marks";
import { buildMarksheetPrintHtml } from "../../src/lib/marksheet-print";
import { hasExaminerHandover, isEditedMark, seedSecondExamMarks } from "../../src/lib/second-examiner";

const blueprint = () => normaliseFinalBlueprint({
  enabled: true, weightage: 100,
  theory: { mcq: { questions: [{ id: "Q1", maxMarks: 100 }], questionsToAnswer: 1 } },
});
const student = (mark: number) => ({
  studentIndex: "TEST001", caQuestionsMarks: {}, isAbsentCa: {},
  finalExamQuestionsMarks: { theory: { mcq: { Q1: mark }, essay: {} }, practical: {} },
  isAbsentTheory: false, isAbsentPractical: false, isAbsentFinal: false,
});

test("all inclusive grade boundaries and values just below them", () => {
  for (const [index, band] of GRADE_BANDS.entries()) {
    assert.equal(gradeForMark(band.minimum).grade, band.grade);
    assert.equal(gradeForMark(band.minimum).point, band.point);
    if (index < GRADE_BANDS.length - 1) assert.equal(gradeForMark(band.minimum - 0.01).grade, GRADE_BANDS[index + 1].grade);
  }
  assert.equal(gradeForMark(100).grade, "A+");
  assert.equal(gradeForMark(0).grade, "E");
});

test("raw grading is independent of ceiling display; absence is I, not zero", () => {
  assert.equal(roundUpWhole(69.5), 70);
  assert.equal(gradeForMark(69.5).grade, "A-");
  assert.equal(formatMark2dp(69.5), "69.50");
  for (const row of [{ isAbsentTheory: true }, { isAbsentPractical: true }, { isAbsentFinal: true }, { isAbsentCa: { quiz: true } }]) {
    assert.equal(gradeForMark(90, { incomplete: hasGradeAbsence(row) }).grade, "I");
  }
  assert.equal(hasGradeAbsence({ isAbsentCa: { quiz: false } }), false);
});

test("scoring retains precision before grade assignment", () => {
  const score = computeWeightedScores(student(69.99), [], blueprint());
  assert.equal(score.total, 69.99);
  assert.equal(gradeForMark(score.total).grade, "A-");
});

test("MCQ common mode is idempotent and preserves individual maxima across JSON reloads", () => {
  const original = normaliseFinalBlueprint({ enabled: true, weightage: 100, theory: { mcq: {
    questions: [{ id: "Q1", maxMarks: 2 }, { id: "Q2", maxMarks: 7 }], questionsToAnswer: 1,
  } } });
  assert.equal(original.theory.mcq.weightingMode, "individual");
  assert.equal(original.theory.mcq.questionsToAnswer, 2);
  const common = normaliseFinalBlueprint({ ...original, theory: { ...original.theory, mcq: { ...original.theory.mcq, weightingMode: "common", commonMaxMarks: 3 } } });
  assert.deepEqual(common.theory.mcq.questions.map(q => q.maxMarks), [3, 3]);
  assert.deepEqual(common.theory.mcq.individualMaxMarks, { Q1: 2, Q2: 7 });
  assert.deepEqual(normaliseFinalBlueprint(JSON.parse(JSON.stringify(common))), common);
  const expanded = normaliseFinalBlueprint({ ...common, theory: { ...common.theory, mcq: { ...common.theory.mcq, questions: [...common.theory.mcq.questions, { id: "Q3", maxMarks: 9 }] } } });
  assert.deepEqual(expanded.theory.mcq.questions.map(q => q.maxMarks), [3, 3, 3]);
  const mcq = expanded.theory.mcq;
  const restored = normaliseFinalBlueprint({ ...expanded, theory: { ...expanded.theory, mcq: { ...mcq, weightingMode: "individual", questions: mcq.questions.map(q => ({ ...q, maxMarks: mcq.individualMaxMarks![q.id] })) } } });
  assert.deepEqual(restored.theory.mcq.questions.map(q => q.maxMarks), [2, 7, 9]);
});

test("legacy and non-MCQ section behavior remains compatible", () => {
  const legacy = normaliseFinalBlueprint({ enabled: true, weightage: 60, totalQuestions: 2, marksPerQuestion: 10 });
  assert.equal(legacy.theory.essay.questions.length, 2);
  assert.equal(legacy.theory.mcq.questions.length, 0);
});

test("handover allowlist, seeding and edit detection preserve first marks and zero corrections", () => {
  assert.equal(hasExaminerHandover(undefined), false);
  assert.equal(hasExaminerHandover("DRAFT"), false);
  assert.equal(hasExaminerHandover("MARKING"), false);
  for (const status of ["SECOND_CHECKING", "FINALIZED", "RECONCILIATION_NEEDED", "RECONCILED"] as const) assert.equal(hasExaminerHandover(status), true);
  const first = student(50).finalExamQuestionsMarks;
  const second = seedSecondExamMarks(first, { theory: { mcq: { Q1: 0 }, essay: {} }, practical: {} });
  assert.equal(second.theory.mcq.Q1, 0);
  assert.equal(first.theory.mcq.Q1, 50);
  assert.equal(isEditedMark(50, 0), true);
  assert.equal(isEditedMark(0, 0), false);
  assert.equal(isEditedMark(50, undefined), false);
});

test("CSV and printable marksheet share raw grading and whole display rules", () => {
  const row = student(69.5);
  const csv = buildMarksheetCsv("TEST", [row], [], blueprint());
  assert.ok(csv.split("\n")[0].endsWith('"Grade"') || csv.split("\n")[0].endsWith('Grade'));
  assert.match(csv.split("\n")[1], /69\.50,70,A-$/);
  const html = buildMarksheetPrintHtml({ moduleCode: "TEST", moduleName: "Test", rows: [row], components: [], finalBlueprint: blueprint() });
  assert.match(html, /<th>Grade<\/th>/);
  assert.match(html, /class="grand total">70<\/td><td>A-<\/td>/);
  assert.match(html, /69\.50/);
  const absent = { ...row, isAbsentTheory: true };
  assert.match(buildMarksheetCsv("TEST", [absent], [], blueprint()).split("\n")[1], /,I$/);
});
