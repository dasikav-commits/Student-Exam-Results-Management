import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CA_GROUP_A_TYPES,
  CA_GROUP_B_TYPES,
  blockingIssues,
  buildMarksheetCsv,
  caGroupOf,
  caTypeLabel,
  changeCaComponentType,
  componentAnsweredCount,
  componentCountedAnswers,
  componentMaxScore,
  componentQuestionMax,
  componentRequiredAnswers,
  computeComponentTotal,
  computeFinalPaperTotals,
  computeRowProgress,
  computeRowTotal,
  computeWeightedScores,
  finalSectionCountedAnswers,
  finalSectionMaxScore,
  finalSectionRequiredCount,
  getFinalSectionBlueprint,
  normaliseCaComponent,
  normaliseFinalAbsence,
  normaliseFinalBlueprint,
  resizeCaQuestions,
  selectCountedAnswers,
  setCaCommonMax,
  setCaQuestionMax,
  setCaRequiredAnswers,
  setCaWeightingMode,
  sumHighestMaxima,
  validateBlueprintInput,
  validateMarksheet,
  type MarkRowLike,
} from "../../src/lib/lecturer-marks";
import { buildCaPrintHtml } from "../../src/lib/ca-print";
import { buildMarksheetPrintHtml } from "../../src/lib/marksheet-print";
import { ComponentMarksDialog } from "../../src/components/lecturer/ComponentMarksDialog";
import { FinalSectionMarksDialog } from "../../src/components/lecturer/FinalSectionMarksDialog";
import { MarksheetSummary } from "../../src/components/lecturer/MarksheetSummary";
import type { CaComponent, StudentMarkRecord } from "../../src/types/hod";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A written (Group B) quiz: six questions of 10 marks, the highest four count. */
const quiz = (overrides: Record<string, unknown> = {}): CaComponent => normaliseCaComponent({
  id: "quiz", type: "QUIZ", name: "Quiz 1", weightage: 100, scoreMode: "SUM",
  totalQuestions: 6, questionMarks: [10, 10, 10, 10, 10, 10], questionsToAnswer: 4,
  ...overrides,
});

/** A marksheet row. CA marks may hold blanks (null, "") to exercise the entered/blank rules. */
const row = (marksByComponent: Record<string, Record<string, unknown>>, extra: Partial<MarkRowLike> = {}): MarkRowLike => ({
  studentIndex: "S001",
  caQuestionsMarks: marksByComponent as MarkRowLike["caQuestionsMarks"],
  isAbsentCa: {},
  finalExamQuestionsMarks: {},
  isAbsentTheory: false, isAbsentPractical: false, isAbsentFinal: false,
  ...extra,
});

/** Blueprint with no final paper — only CA components, weighted to 100%. */
const noFinal = (weightage = 0) => ({
  enabled: false, weightage,
  theory: { mcq: { questions: [], questionsToAnswer: 0 }, essay: { questions: [], questionsToAnswer: 0 } },
  practical: { questions: [], questionsToAnswer: 0 },
});

const ids = (answers: { id: string }[]) => answers.map(answer => answer.id);
const issuesFor = (list: ReturnType<typeof validateMarksheet>, studentIndex = "S001") =>
  list.filter(issue => issue.studentIndex === studentIndex);

// ─── MCQ type and Group A ────────────────────────────────────────────────────

test("MCQ is an explicit written (Group B) CA type beside Quiz, Assignment, Midterm and Tutorial", () => {
  assert.deepEqual([...CA_GROUP_B_TYPES], ["QUIZ", "ASSIGNMENT", "MIDTERM", "TUTORIAL", "MCQ"]);
  assert.equal(caGroupOf("MCQ"), "B");
  assert.equal(caTypeLabel("MCQ"), "MCQ");

  const mcq = normaliseCaComponent({
    id: "m", type: "MCQ", name: "MCQ test", weightage: 100, scoreMode: "SUM",
    totalQuestions: 3, questionMarks: [2, 2, 2],
  });
  assert.equal(mcq.group, "B");
  assert.equal(mcq.weightingMode, "individual");
  assert.equal(componentRequiredAnswers(mcq), 3, "older components without a required count still need every answer");
  assert.equal(validateBlueprintInput([mcq], noFinal(0)), null);
});

test("Group A single-mark components are unchanged by the written-component controls", () => {
  assert.deepEqual([...CA_GROUP_A_TYPES], ["PROJECT", "PRESENTATION", "LAB_REPORT"]);
  const project = normaliseCaComponent({ id: "p", type: "PROJECT", name: "Project", weightage: 20, scoreMode: "SUM", totalMarks: 50 });
  assert.equal(project.group, "A");
  for (const field of ["weightingMode", "commonMaxMarks", "individualQuestionMarks"] as const) {
    assert.equal(project[field], undefined, `${field} must not leak onto a Group A component`);
  }
  assert.equal(componentRequiredAnswers(project), 1);
  assert.equal(componentMaxScore(project), 50);
  assert.equal(computeComponentTotal(project, { Q1: 37.5 }), 37.5);
  assert.equal(computeComponentTotal(project, { Q1: 80 }), 50, "an over-range mark is clamped to the component maximum");
  assert.equal(computeComponentTotal(project, {}), 0);

  // The Group B editing helpers leave a Group A component exactly as it was.
  assert.equal(setCaWeightingMode(project, "common"), project);
  assert.equal(setCaRequiredAnswers(project, 3), project);
  assert.equal(resizeCaQuestions(project, 5), project);
  assert.equal(setCaCommonMax(project, 9), project);

  // Crossing groups re-shapes it and drops whatever belongs to the other group.
  const written = changeCaComponentType(project, "MCQ");
  assert.equal(written.group, "B");
  assert.equal(written.weightingMode, "individual");
  assert.equal(componentMaxScore(written), 50);
  const practical = changeCaComponentType(written, "PROJECT");
  assert.equal(practical.group, "A");
  assert.equal(practical.weightingMode, undefined);
  assert.equal(practical.individualQuestionMarks, undefined);
  assert.equal(componentMaxScore(practical), 50);

  // Changing type inside Group B only relabels — every written setting is kept.
  const relabelled = changeCaComponentType(setCaWeightingMode(quiz(), "common"), "MIDTERM");
  assert.equal(relabelled.type, "MIDTERM");
  assert.equal(relabelled.weightingMode, "common");
  assert.equal(componentRequiredAnswers(relabelled), 4);
});

// ─── Weighting toggle ────────────────────────────────────────────────────────

test("every Group B component has a weighting toggle that round-trips hidden individual maxima through save and reload", () => {
  const individual = quiz({ questionMarks: [5, 8, 10, 2, 6, 9] });
  assert.deepEqual(individual.individualQuestionMarks, [5, 8, 10, 2, 6, 9]);

  const common = setCaCommonMax(setCaWeightingMode(individual, "common"), 7);
  assert.equal(common.weightingMode, "common");
  assert.deepEqual(common.questionMarks, [7, 7, 7, 7, 7, 7], "common mode: one maximum for every question");
  assert.deepEqual(common.individualQuestionMarks, [5, 8, 10, 2, 6, 9], "the individual maxima stay hidden, not discarded");
  assert.equal(componentQuestionMax(common, "Q3"), 7);
  assert.equal(componentMaxScore(common), 28, "4 required × 7");

  // Save → reload goes through JSON and the server-side normaliser: both are idempotent.
  const reloaded = normaliseCaComponent(JSON.parse(JSON.stringify(common)));
  assert.deepEqual(reloaded, common);
  assert.deepEqual(normaliseCaComponent(reloaded), reloaded);
  assert.equal(validateBlueprintInput([reloaded], noFinal(0)), null);

  // Switching back restores every individual maximum exactly.
  const restored = setCaWeightingMode(reloaded, "individual");
  assert.equal(restored.weightingMode, "individual");
  assert.deepEqual(restored.questionMarks, [5, 8, 10, 2, 6, 9]);
  assert.deepEqual(restored.individualQuestionMarks, [5, 8, 10, 2, 6, 9]);
  assert.equal(componentQuestionMax(restored, "Q2"), 8);

  // An untouched toggle round trip is not a spurious "unsaved change" (the page compares JSON).
  assert.equal(
    JSON.stringify(setCaWeightingMode(setCaWeightingMode(individual, "common"), "individual")),
    JSON.stringify(individual)
  );

  // Editing a question maximum is individual-mode only and is remembered for later.
  const edited = setCaQuestionMax(individual, 1, 4);
  assert.deepEqual(edited.questionMarks, [5, 4, 10, 2, 6, 9]);
  assert.equal(setCaQuestionMax(common, 1, 4), common, "common mode has no per-question maxima to edit");
  assert.deepEqual(setCaWeightingMode(setCaWeightingMode(edited, "common"), "individual").questionMarks, [5, 4, 10, 2, 6, 9]);
});

test("common weight applies to questions added later; hidden individual maxima survive resizing", () => {
  const individual = quiz({ questionMarks: [5, 8, 10, 2, 6, 9] });
  const common = setCaCommonMax(setCaWeightingMode(individual, "common"), 7);

  const grown = resizeCaQuestions(common, 8);
  assert.deepEqual(grown.questionMarks, [7, 7, 7, 7, 7, 7, 7, 7]);
  assert.equal(componentQuestionMax(grown, "Q8"), 7);
  assert.deepEqual(grown.individualQuestionMarks, [5, 8, 10, 2, 6, 9, 7, 7], "new questions start at the common weight if individual mode returns");
  assert.deepEqual(setCaWeightingMode(grown, "individual").questionMarks, [5, 8, 10, 2, 6, 9, 7, 7]);

  // The common weight is authoritative on its own: even a component whose stored per-question
  // list and legacy per-question value are stale (or have not grown to the new question count)
  // answers with the common maximum.
  assert.equal(componentQuestionMax({ ...common, questionMarks: [], marksPerQuestion: 1 }, "Q3"), 7);
  assert.equal(componentQuestionMax({ ...common, totalQuestions: 9, marksPerQuestion: 1 }, "Q9"), 7);
  assert.equal(componentQuestionMax({ ...individual, totalQuestions: 9 }, "Q2"), 8, "individual mode still reads its own list");

  // Changing the common weight reaches every question, including the added ones.
  assert.deepEqual(setCaCommonMax(grown, 3).questionMarks, [3, 3, 3, 3, 3, 3, 3, 3]);

  // Shrinking drops only the tail.
  assert.deepEqual(setCaWeightingMode(resizeCaQuestions(common, 3), "individual").questionMarks, [5, 8, 10]);

  // Individual mode: new questions copy the last value, as before.
  assert.deepEqual(resizeCaQuestions(individual, 8).questionMarks, [5, 8, 10, 2, 6, 9, 9, 9]);

  // Question count is bounded.
  assert.equal(resizeCaQuestions(individual, 500).totalQuestions, 50);
  assert.equal(resizeCaQuestions(individual, 0).totalQuestions, 1);
});

test("required answers survive weighting, save and question-count edits, capped at the configured count", () => {
  const three = setCaRequiredAnswers(quiz(), 3);
  assert.equal(componentRequiredAnswers(three), 3);
  assert.equal(componentRequiredAnswers(setCaWeightingMode(setCaWeightingMode(three, "common"), "individual")), 3, "weighting toggles");
  assert.equal(componentRequiredAnswers(normaliseCaComponent(JSON.parse(JSON.stringify(three)))), 3, "save and reload");
  assert.equal(componentRequiredAnswers(resizeCaQuestions(three, 9)), 3, "adding questions no longer resets it to the count");
  assert.equal(componentRequiredAnswers(resizeCaQuestions(three, 2)), 2, "removing questions caps it at the new count");
  assert.equal(componentRequiredAnswers(setCaRequiredAnswers(three, 99)), 6, "capped at the configured count");
  assert.equal(componentRequiredAnswers(setCaRequiredAnswers(three, 0)), 1, "at least one answer is required");
  assert.equal(componentRequiredAnswers(normaliseCaComponent({ ...three, questionsToAnswer: 99 })), 6);

  const legacy = normaliseCaComponent({
    id: "old", type: "QUIZ", name: "Old", weightage: 10, scoreMode: "SUM",
    totalQuestions: 4, questionMarks: [5, 5, 5, 5],
  });
  assert.equal(componentRequiredAnswers(legacy), 4, "a component saved before this field existed requires every answer");
});

test("blueprint validation covers the weighting mode, the common weight and the required-answer count", () => {
  const valid = quiz();
  assert.equal(validateBlueprintInput([valid], noFinal(0)), null);

  for (const bad of [0, -1, 2.5, "x", 7]) {
    assert.match(
      validateBlueprintInput([{ ...valid, questionsToAnswer: bad }], noFinal(0)) ?? "",
      /required answers must be a whole number between 1 and 6/,
      `questionsToAnswer ${JSON.stringify(bad)}`
    );
  }
  assert.equal(validateBlueprintInput([{ ...valid, questionsToAnswer: undefined }], noFinal(0)), null, "absent means every answer (older clients)");
  assert.equal(validateBlueprintInput([{ ...valid, questionsToAnswer: null }], noFinal(0)), null);

  assert.match(validateBlueprintInput([{ ...valid, weightingMode: "mixed" }], noFinal(0)) ?? "", /weighting mode must be individual or common/);

  const common = setCaCommonMax(setCaWeightingMode(valid, "common"), 5);
  assert.equal(validateBlueprintInput([common], noFinal(0)), null);
  assert.match(validateBlueprintInput([{ ...common, commonMaxMarks: 0 }], noFinal(0)) ?? "", /common weight must be greater than 0/);
  assert.match(validateBlueprintInput([{ ...common, commonMaxMarks: -3 }], noFinal(0)) ?? "", /common weight must be greater than 0/);
  assert.match(validateBlueprintInput([{ ...common, commonMaxMarks: 1001 }], noFinal(0)) ?? "", /too large/);
  assert.match(validateBlueprintInput([{ ...common, commonMaxMarks: undefined }], noFinal(0)) ?? "", /common weight must be greater than 0/);

  // Common mode derives the per-question maxima, so a stale list is harmless there …
  const stale = { ...common, questionMarks: [] };
  assert.equal(validateBlueprintInput([stale], noFinal(0)), null);
  assert.deepEqual(normaliseCaComponent(stale).questionMarks, [5, 5, 5, 5, 5, 5]);
  // … but individual mode still demands a positive weight for every question.
  assert.match(validateBlueprintInput([{ ...valid, questionMarks: [10, 10, 0, 10, 10, 10] }], noFinal(0)) ?? "", /weightage for Q3 must be greater than 0/);
  assert.match(validateBlueprintInput([{ ...valid, questionMarks: [10, 10] }], noFinal(0)) ?? "", /expected 6 question weightage/);
});

// ─── Highest-N scoring ───────────────────────────────────────────────────────

test("only the highest N marks earned count: 1, 2, 3, 4, 9, 10 with four required scores 26 / 40", () => {
  const component = quiz();
  const marks = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 9, Q6: 10 };

  assert.equal(componentMaxScore(component), 40);
  assert.equal(computeComponentTotal(component, marks), 26, "10 + 9 + 4 + 3, not Q1…Q4 = 10");
  assert.deepEqual(ids(componentCountedAnswers(component, marks)), ["Q6", "Q5", "Q4", "Q3"]);
  assert.equal(computeWeightedScores(row({ quiz: marks }), [component], null).ca, 65);

  // Every entered mark stays stored; selection never edits the source.
  assert.deepEqual(marks, { Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 9, Q6: 10 });

  // Fewer entered answers than required: everything entered counts.
  assert.equal(computeComponentTotal(component, { Q5: 9, Q6: 10 }), 19);
  // Exactly N answers behave as before.
  assert.equal(computeComponentTotal(component, { Q1: 1, Q2: 2, Q3: 3, Q4: 4 }), 10);
});

test("unequal maxima: rank by marks earned, clamp each mark to its own maximum first, keep a fixed denominator", () => {
  const mixed = quiz({ totalQuestions: 4, questionMarks: [20, 10, 10, 5], questionsToAnswer: 2 });
  assert.equal(componentMaxScore(mixed), 30, "the two highest maxima (20 + 10), whoever answers what");
  assert.equal(sumHighestMaxima([20, 10, 10, 5], 2), 30);

  const marks = { Q1: 15, Q2: 10, Q3: 12, Q4: 99 }; // Q3 clamps to 10 (ties Q2), Q4 clamps to 5
  assert.deepEqual(
    componentCountedAnswers(mixed, marks).map(answer => [answer.id, answer.value]),
    [["Q1", 15], ["Q2", 10]],
    "an over-range mark can never outrank a legitimate answer, and the tie goes to natural order"
  );
  assert.equal(computeComponentTotal(mixed, marks), 25);
  assert.equal(computeWeightedScores(row({ quiz: marks }), [mixed], null).ca, (25 / 30) * 100);

  // The denominator is the highest maxima wherever they sit — not simply Q1 + … + QN.
  const scattered = quiz({ totalQuestions: 4, questionMarks: [5, 10, 20, 10], questionsToAnswer: 2 });
  assert.equal(componentMaxScore(scattered), 30, "20 + 10, not Q1 + Q2 = 15");
  assert.equal(computeComponentTotal(scattered, { Q3: 20, Q4: 10 }), 30);
  assert.equal(computeWeightedScores(row({ quiz: { Q3: 20, Q4: 10 } }), [scattered], null).ca, 100, "full marks on the two biggest questions is a full component");
  assert.equal(computeWeightedScores(row({ quiz: { Q1: 5, Q2: 10 } }), [scattered], null).ca, 50);

  // Selection is by raw marks earned, not by percentage of each question's maximum:
  // Q4's 5/5 (100%) and Q2's 6/10 (60%) both outrank Q1's 8/20 (40%) by percentage,
  // but by marks earned the two highest are Q1 (8) and Q2 (6).
  assert.deepEqual(ids(componentCountedAnswers(mixed, { Q1: 8, Q2: 6, Q4: 5 })), ["Q1", "Q2"]);
  assert.deepEqual(ids(componentCountedAnswers(quiz({ questionMarks: [20, 10, 10, 5, 5, 5], questionsToAnswer: 1 }), { Q1: 8, Q4: 5 })), ["Q1"]);
});

test("SUM adds the counted answers; AVG takes their mean over the same fixed denominator", () => {
  const average = quiz({ scoreMode: "AVG", totalQuestions: 4, questionMarks: [10, 10, 10, 10], questionsToAnswer: 3 });
  const marks = { Q1: 10, Q2: 8, Q3: 6, Q4: 2 };
  assert.equal(computeComponentTotal(average, marks), 8, "(10 + 8 + 6) / 3");
  assert.equal(componentMaxScore(average), 10, "the mean of the three highest maxima, not their sum");
  assert.equal(computeWeightedScores(row({ quiz: marks }), [average], null).ca, 80);
  assert.equal(computeComponentTotal(average, { Q1: 9, Q2: 6 }), 5, "a missing answer counts as zero rather than inflating the mean");

  const sum = quiz({ scoreMode: "SUM", totalQuestions: 4, questionMarks: [10, 10, 10, 10], questionsToAnswer: 3 });
  assert.equal(computeComponentTotal(sum, marks), 24);
  assert.equal(componentMaxScore(sum), 30);
  assert.equal(computeWeightedScores(row({ quiz: marks }), [sum], null).ca, 80);
});

test("ties go to natural question order, never alphabetical", () => {
  const ten = quiz({ totalQuestions: 10, questionMarks: Array(10).fill(10), questionsToAnswer: 2 });
  // Alphabetically Q10 < Q2 < Q9; naturally Q2 < Q9 < Q10.
  assert.deepEqual(ids(componentCountedAnswers(ten, { Q10: 7, Q2: 7, Q9: 7 })), ["Q2", "Q9"]);
  assert.deepEqual(ids(componentCountedAnswers(quiz({ totalQuestions: 10, questionMarks: Array(10).fill(10), questionsToAnswer: 1 }), { Q10: 7, Q2: 7 })), ["Q2"]);

  // The shared selector keeps configured order too, and ignores duplicated configuration.
  assert.deepEqual(
    ids(selectCountedAnswers({ A: 5, B: 5, C: 5 }, [{ id: "C", max: 10 }, { id: "A", max: 10 }, { id: "B", max: 10 }, { id: "A", max: 10 }], 2)),
    ["C", "A"]
  );
  // The blueprint-less helper keeps natural order for ties as well.
  assert.equal(computeRowTotal({ Q10: 5, Q2: 5, Q9: 1 }, 2, "SUM"), 10);
  assert.equal(computeRowTotal({ Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 9, Q6: 10 }, 4, "SUM"), 26);
  assert.equal(computeRowTotal({ Q1: 10, Q2: 8, Q3: 6, Q4: 2 }, 3, "AVG"), 8);
});

test("zero counts as an entered answer, blank does not, unknown question IDs never count", () => {
  const component = quiz();
  const withZero = { Q1: 0, Q2: null, Q3: "", Q4: 5, Q5: 5, Q6: 5 };
  assert.equal(componentAnsweredCount(component, withZero), 4, "Q1 = 0 is an answer; null and blank are not");
  assert.equal(computeComponentTotal(component, withZero), 15);
  assert.deepEqual(issuesFor(validateMarksheet([row({ quiz: withZero })], [component], noFinal(0))), []);

  const withBlanks = { Q1: null, Q2: "", Q4: 5, Q5: 5, Q6: 5 };
  assert.equal(componentAnsweredCount(component, withBlanks), 3);
  const short = issuesFor(validateMarksheet([row({ quiz: withBlanks })], [component], noFinal(0)));
  assert.equal(short.length, 1);
  assert.equal(short[0].level, "error");
  assert.match(short[0].message, /Quiz 1 — 3 of 4 required answers recorded/);

  // Marks that belong to no configured question cannot complete a component or add to a total.
  const unknown = { Q99: 10, Q7: 10, Q1: 1, Q2: 2, Q3: 3 };
  assert.equal(componentAnsweredCount(component, unknown), 3);
  assert.equal(computeComponentTotal(component, unknown), 6);
  assert.deepEqual(ids(componentCountedAnswers(component, unknown)), ["Q3", "Q2", "Q1"]);
  const stray = issuesFor(validateMarksheet([row({ quiz: unknown })], [component], noFinal(0)));
  assert.ok(stray.some(issue => issue.level === "error" && /3 of 4 required answers recorded/.test(issue.message)));
  assert.ok(stray.some(issue => issue.level === "warning" && /not configured/.test(issue.message)), "ignored marks are reported");
  assert.ok(computeRowProgress(row({ quiz: unknown }), [component], null).percent < 100);

  // Only unknown IDs → nothing answered at all.
  assert.equal(componentAnsweredCount(component, { Q99: 10 }), 0);
  assert.equal(computeComponentTotal(component, { Q99: 10 }), 0);
});

// ─── Completion accepts any N ────────────────────────────────────────────────

test("completion accepts any N configured CA answers in progress and validation; extra answers only warn", () => {
  const component = quiz();
  const laterQuestions = { Q3: 1, Q4: 2, Q5: 3, Q6: 4 }; // Q1 and Q2 never answered
  assert.equal(computeRowProgress(row({ quiz: laterQuestions }), [component], null).percent, 100);
  assert.deepEqual(issuesFor(validateMarksheet([row({ quiz: laterQuestions })], [component], noFinal(0))), []);

  const three = { Q1: 1, Q2: 2, Q6: 4 };
  assert.equal(computeRowProgress(row({ quiz: three }), [component], null).percent, 75);
  assert.equal(blockingIssues(validateMarksheet([row({ quiz: three })], [component], noFinal(0))).length, 1);

  const extra = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 9, Q6: 10 };
  assert.equal(computeRowProgress(row({ quiz: extra }), [component], null).percent, 100);
  const issues = validateMarksheet([row({ quiz: extra })], [component], noFinal(0));
  assert.deepEqual(blockingIssues(issues), [], "extra answers must never block submission");
  const warning = issuesFor(issues).find(issue => issue.level === "warning");
  assert.ok(warning, "a CA warning is raised for extra answers");
  assert.match(warning!.message, /6 answers recorded; only the highest 4 count toward the total/);

  // Marks outside a question's own range are still errors, and are checked per configured question.
  const outOfRange = { Q1: 11, Q2: 1, Q3: 1, Q4: 1 };
  assert.ok(blockingIssues(validateMarksheet([row({ quiz: outOfRange })], [component], noFinal(0))).some(issue => /Q1/.test(issue.message)));

  // A component marked absent is exempt, as before.
  assert.deepEqual(issuesFor(validateMarksheet([row({ quiz: {} }, { isAbsentCa: { quiz: true } })], [component], noFinal(0))), []);
});

// ─── Final paper: Essay and Practical ────────────────────────────────────────

const finalBlueprint = () => normaliseFinalBlueprint({
  enabled: true, weightage: 100,
  theory: {
    mcq: { questions: [{ id: "Q1", maxMarks: 10 }, { id: "Q2", maxMarks: 10 }], questionsToAnswer: 1 },
    essay: { questions: ["Q1", "Q2", "Q3", "Q4", "Q5"].map(id => ({ id, maxMarks: 20 })), questionsToAnswer: 3 },
  },
  practical: { questions: ["Q1", "Q2", "Q3", "Q4"].map(id => ({ id, maxMarks: 25 })), questionsToAnswer: 2 },
});
const finalRow = (marks: unknown, extra: Partial<MarkRowLike> = {}): MarkRowLike => ({
  ...row({}), finalExamQuestionsMarks: marks, ...extra,
});
const firstExaminer = {
  theory: { mcq: { Q1: 7, Q2: 8 }, essay: { Q1: 5, Q2: 18, Q3: 20, Q4: 7, Q5: 19 } },
  practical: { Q1: 5, Q2: 24, Q4: 25 }, // Q3 never answered — any two will do
};
const secondExaminer = {
  theory: { mcq: { Q1: 7, Q2: 8 }, essay: { Q1: 20, Q2: 3, Q3: 4, Q4: 16, Q5: 17 } },
  practical: { Q1: 25, Q2: 1 },
};

test("Final Essay and Practical count the highest N answers; each examiner is ranked independently", () => {
  const blueprint = finalBlueprint();
  const essay = getFinalSectionBlueprint(blueprint, "essay");
  const practical = getFinalSectionBlueprint(blueprint, "practical");
  const mcq = getFinalSectionBlueprint(blueprint, "mcq");

  assert.equal(finalSectionMaxScore(essay), 60);
  assert.equal(finalSectionMaxScore(practical), 50);
  assert.equal(finalSectionRequiredCount(mcq), 2, "Final MCQ stays all-compulsory whatever count is supplied");
  assert.equal(finalSectionMaxScore(mcq), 20);

  const first = computeFinalPaperTotals(finalRow(firstExaminer), blueprint);
  assert.equal(first.sectionRaw.essay, 57, "20 + 19 + 18");
  assert.equal(first.sectionRaw.practical, 49, "25 + 24");
  assert.equal(first.sectionRaw.mcq, 15);
  assert.equal(first.rawTotal, 121);
  assert.equal(first.maxTotal, 130);

  const second = computeFinalPaperTotals(finalRow(firstExaminer), blueprint, secondExaminer);
  assert.equal(second.sectionRaw.essay, 53, "20 + 17 + 16");
  assert.equal(second.sectionRaw.practical, 26, "25 + 1");

  assert.deepEqual(ids(finalSectionCountedAnswers(firstExaminer.theory.essay, essay)), ["Q3", "Q5", "Q2"]);
  assert.deepEqual(ids(finalSectionCountedAnswers(secondExaminer.theory.essay, essay)), ["Q1", "Q5", "Q4"], "the second examiner's own highest three");
  assert.deepEqual(ids(finalSectionCountedAnswers(firstExaminer.practical, practical)), ["Q4", "Q2"]);

  // Section maxima are the N highest question maxima wherever they sit, not the first N.
  const scattered = getFinalSectionBlueprint(normaliseFinalBlueprint({
    enabled: true, weightage: 100,
    theory: { mcq: { questions: [{ id: "Q1", maxMarks: 1 }], questionsToAnswer: 1 }, essay: {
      questions: [10, 20, 30, 20, 10].map((maxMarks, index) => ({ id: `Q${index + 1}`, maxMarks })), questionsToAnswer: 2,
    } },
  }), "essay");
  assert.equal(finalSectionMaxScore(scattered), 50, "30 + 20, not 10 + 20");
  assert.equal(finalSectionCountedAnswers({ Q1: 10, Q2: 5, Q3: 30, Q4: 20 }, scattered).reduce((sum, answer) => sum + answer.value, 0), 50);

  // A mark above its question's maximum is clamped before ranking.
  assert.deepEqual(
    finalSectionCountedAnswers({ Q1: 99, Q2: 19 }, practical).map(answer => [answer.id, answer.value]),
    [["Q1", 25], ["Q2", 19]]
  );
});

test("Final sections complete with any N configured answers for both examiners; zero is an answer; unknown IDs are ignored", () => {
  const blueprint = finalBlueprint();
  const complete = finalRow(firstExaminer);
  assert.equal(computeRowProgress(complete, [], blueprint).percent, 100, "Q2/Q4 of the Practical and Q2/Q3/Q5 of the Essay are enough");
  assert.deepEqual(issuesFor(validateMarksheet([complete], [], blueprint)), []);

  const tooFew = finalRow({ ...firstExaminer, theory: { ...firstExaminer.theory, essay: { Q3: 20, Q5: 19 } } });
  const errors = blockingIssues(validateMarksheet([tooFew], [], blueprint));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Theory · Essay — 2 of 3 required marks recorded/);
  assert.ok(computeRowProgress(tooFew, [], blueprint).percent < 100);

  const withZero = finalRow({ ...firstExaminer, practical: { Q1: 0, Q3: 0 } });
  assert.deepEqual(issuesFor(validateMarksheet([withZero], [], blueprint)), [], "two zero marks are two answers");
  assert.equal(computeFinalPaperTotals(withZero, blueprint).sectionRaw.practical, 0);

  const withUnknown = finalRow({ ...firstExaminer, practical: { Q9: 25, Q1: 5 } });
  assert.equal(blockingIssues(validateMarksheet([withUnknown], [], blueprint)).length, 1, "Q9 does not exist, so only one real answer is recorded");
  assert.equal(computeFinalPaperTotals(withUnknown, blueprint).sectionRaw.practical, 5);

  // Extra Final answers never block and do not raise a warning (the CA warning is CA-specific).
  const extra = finalRow({ ...firstExaminer, theory: { ...firstExaminer.theory, essay: { Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 5 } } });
  assert.deepEqual(issuesFor(validateMarksheet([extra], [], blueprint)), []);

  // The Second Examiner's own marks complete a section on their own too.
  const secondProgress = computeRowProgress(finalRow(secondExaminer), [], blueprint);
  assert.equal(secondProgress.percent, 100);
});

// ─── CSV, print and the rendered Summary agree ───────────────────────────────

const csvCells = (csv: string) => {
  const [header, ...lines] = csv.split("\n");
  const columns = header.split(",").map(cell => cell.replace(/^"|"$/g, ""));
  return lines.map(line => {
    const cells = line.split(",").map(cell => cell.replace(/^"|"$/g, ""));
    return Object.fromEntries(columns.map((column, index) => [column, cells[index]]));
  });
};

test("CSV, the CA register print and the full marksheet print use the same best-N total", () => {
  const component = quiz({ weightage: 40 });
  const blueprint = normaliseFinalBlueprint({
    enabled: true, weightage: 60,
    theory: { mcq: { questions: [{ id: "Q1", maxMarks: 100 }], questionsToAnswer: 1 } },
  });
  const student = row(
    { quiz: { Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 9, Q6: 10 } },
    { finalExamQuestionsMarks: { theory: { mcq: { Q1: 60 }, essay: {} }, practical: {} } }
  );

  const csv = csvCells(buildMarksheetCsv("TEST", [student], [component], blueprint));
  assert.equal(csv.length, 1);
  assert.equal(csv[0]["Quiz 1 Total"], "26.00");
  assert.equal(csv[0]["Quiz 1 Max"], "40.00");
  assert.equal(csv[0]["Quiz 1 Q1"], "1.00", "every entered mark is still exported, counted or not");
  assert.equal(csv[0]["Quiz 1 Q6"], "10.00");
  assert.equal(csv[0]["CA Weighted"], "26.00", "(26 / 40) × 40");

  const caPrint = buildCaPrintHtml({ moduleCode: "TEST", moduleName: "Test", components: [component], rows: [student] });
  assert.match(caPrint, /<td class="score">26\.0<span class="out-of"> \/ 40\.0<\/span><\/td>/);
  assert.match(caPrint, /<td class="grand">26\.0<\/td>/);
  assert.match(caPrint, /only the highest-scoring required answers count/);

  const fullPrint = buildMarksheetPrintHtml({ moduleCode: "TEST", moduleName: "Test", components: [component], finalBlueprint: blueprint, rows: [student] });
  assert.match(fullPrint, /<td>26\.00<span class="out"> \/ 40\.00<\/span><\/td>/);
  assert.match(fullPrint, /<td class="grand">26\.00<\/td>/);

  // Marks only for unknown questions print as blank, not as a zero score.
  const strays = row({ quiz: { Q99: 7 } });
  assert.match(buildCaPrintHtml({ moduleCode: "T", moduleName: "T", components: [component], rows: [strays] }), /<td class="score blank">—<\/td>/);
  assert.match(buildMarksheetPrintHtml({ moduleCode: "T", moduleName: "T", components: [component], finalBlueprint: blueprint, rows: [strays] }), /<td class="blank">—<\/td>/);
});

test("the Grade column is present and consistent in the rendered Summary, CSV and full print", () => {
  const blueprint = normaliseFinalBlueprint({
    enabled: true, weightage: 100,
    theory: { mcq: { questions: [{ id: "Q1", maxMarks: 100 }], questionsToAnswer: 1 } },
  });
  const student = (studentIndex: string, mark: number | null, extra: Partial<MarkRowLike> = {}): MarkRowLike => ({
    ...row({}),
    studentIndex,
    finalExamQuestionsMarks: { theory: { mcq: mark === null ? {} : { Q1: mark }, essay: {} }, practical: {} },
    ...extra,
  });
  const students = [
    student("S069", 69.5),
    student("S000", 0),
    student("SABS", 90, { isAbsentTheory: true, isAbsentFinal: true }),
  ];

  // Rows are mapped the way the Lecturer Desk maps them into the Summary component.
  const summaryRows = students.map(entry => {
    const weighted = computeWeightedScores(entry, [], blueprint);
    const absence = normaliseFinalAbsence(entry);
    return {
      studentIndex: entry.studentIndex, ca: weighted.ca, final: weighted.final, total: weighted.total,
      caMax: weighted.caMax, finalMax: weighted.finalMax, progress: computeRowProgress(entry, [], blueprint).percent,
      isAbsentTheory: absence.isAbsentTheory, isAbsentPractical: absence.isAbsentPractical, isAbsentFinal: absence.isAbsentFinal,
      issueCount: 0,
    };
  });
  const html = renderToStaticMarkup(React.createElement(MarksheetSummary, { rows: summaryRows, moduleName: "Test", showComparison: false }));

  assert.match(html, /<th[^>]*>Module Mark<\/th><th[^>]*>Grade<\/th>/, "the Grade header sits right after Module Mark");
  const cells = [...html.matchAll(/<tr[^>]*><td[^>]*>\d+<\/td><td[^>]*>\s*([A-Z0-9]+)[\s\S]*?<span[^>]*>(\d+)<\/span><\/td><td[^>]*title="Grade uses the raw mark, before display rounding"[^>]*>([^<]+)<\/td>/g)]
    .map(match => ({ student: match[1], shown: match[2], grade: match[3] }));
  assert.deepEqual(cells, [
    { student: "S069", shown: "70", grade: "A-" },
    { student: "S000", shown: "0", grade: "E" },
    { student: "SABS", shown: "0", grade: "I" },
  ]);

  const csv = csvCells(buildMarksheetCsv("TEST", students, [], blueprint));
  assert.deepEqual(csv.map(entry => [entry["Student Index"], entry["Module Mark (100)"], entry.Grade]), [
    ["S069", "70", "A-"], ["S000", "0", "E"], ["SABS", "0", "I"],
  ]);

  const print = buildMarksheetPrintHtml({ moduleCode: "TEST", moduleName: "Test", components: [], finalBlueprint: blueprint, rows: students });
  assert.match(print, /<th>Grade<\/th>/);
  assert.match(print, /<td class="grand total">70<\/td><td>A-<\/td>/);
  assert.match(print, /<td class="grand total">0<\/td><td>E<\/td>/);
  assert.match(print, /<td class="grand total">0<\/td><td>I<\/td>/);
});

// ─── Dialogs label what is counted ───────────────────────────────────────────

/** The `data-counted` flag (or the examiner flag) rendered for one question card. */
const flagFor = (html: string, key: string, attribute = "data-counted") => {
  const start = html.indexOf(`>${key}</span>`);
  assert.ok(start >= 0, `${key} card not rendered`);
  return html.slice(start).match(new RegExp(`${attribute}="(true|false)"`))?.[1];
};

test("the CA dialog labels each score 'Counted in total' or 'Outside highest scores' from the same selection as the total", () => {
  const component = quiz();
  const student = row({ quiz: { Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 9, Q6: 10 } }) as unknown as StudentMarkRecord;
  const html = renderToStaticMarkup(React.createElement(ComponentMarksDialog, {
    comp: component, row: student, isReadOnly: true, onSave: () => undefined, onClose: () => undefined,
  }));

  assert.equal((html.match(/Counted in total/g) ?? []).length, 4);
  assert.equal((html.match(/Outside highest scores/g) ?? []).length, 2);
  assert.deepEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"].map(key => flagFor(html, key)), ["false", "false", "true", "true", "true", "true"]);
  assert.match(html, /Answer any 4 of 6 questions — only the highest 4 marks count/);
  assert.match(html, /4\/4 counted/);

  // Blank questions carry no label, and a zero is labelled like any other answer.
  const sparse = row({ quiz: { Q1: 0, Q2: 7 } }) as unknown as StudentMarkRecord;
  const sparseHtml = renderToStaticMarkup(React.createElement(ComponentMarksDialog, {
    comp: component, row: sparse, isReadOnly: true, onSave: () => undefined, onClose: () => undefined,
  }));
  assert.equal((sparseHtml.match(/Counted in total/g) ?? []).length, 2);
  assert.equal((sparseHtml.match(/Outside highest scores/g) ?? []).length, 0);
  assert.equal(flagFor(sparseHtml, "Q1"), "true");
  assert.equal(flagFor(sparseHtml, "Q3"), undefined, "an unanswered question is not labelled");
});

test("the Final dialog labels counted scores for the First and Second Examiner independently", () => {
  const blueprint = finalBlueprint();
  const student = finalRow(firstExaminer) as unknown as StudentMarkRecord;
  const html = renderToStaticMarkup(React.createElement(FinalSectionMarksDialog, {
    sectionKey: "essay", blueprint, row: student, isAbsent: false, isReadOnly: true,
    secondMarks: secondExaminer as never, showExaminerMarks: true,
    onSave: () => undefined, onClose: () => undefined,
  }));

  // First Examiner essay: Q3, Q5, Q2 count.  Second Examiner essay: Q1, Q5, Q4 count.
  assert.deepEqual(["Q1", "Q2", "Q3", "Q4", "Q5"].map(key => flagFor(html, key)), ["false", "true", "true", "false", "true"]);
  assert.deepEqual(
    ["Q1", "Q2", "Q3", "Q4", "Q5"].map(key => flagFor(html, key, "data-examiner-counted")),
    ["true", "false", "false", "true", "true"]
  );
  assert.match(html, /answer any 3 — the highest 3 marks count/);
  assert.match(html, /3\/3 counted/);
  assert.match(html, /Section total 57\.0 \/ 60/);
});
