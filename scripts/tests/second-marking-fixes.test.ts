import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeFinalPaperTotals,
  exceedsVarianceThreshold,
  finalPaperVariance,
  hasAnyMark,
  normaliseFinalAbsence,
  normaliseFinalBlueprint,
  VARIANCE_THRESHOLD,
} from "../../src/lib/lecturer-marks";
import { mirrorFirstMarkChanges, seedSecondExamMarks } from "../../src/lib/second-examiner";
import type { FinalPaperMarks } from "../../src/types/hod";

// ─── Keeping a saved Second Examiner ledger in step with a First Examiner edit ───

const marks = (essay: Record<string, number>, practical: Record<string, number> = {}, mcq: Record<string, number> = {}): FinalPaperMarks =>
  ({ theory: { mcq, essay }, practical });
const empty = marks({});

test("mirrorFirstMarkChanges: nothing stored means nothing to change (the ledger seeds itself)", () => {
  assert.equal(mirrorFirstMarkChanges(marks({ Q1: 15 }), marks({ Q1: 14 }), empty), null);
});

test("mirrorFirstMarkChanges: unchanged First Examiner marks leave the ledger alone", () => {
  const first = marks({ Q1: 15, Q2: 12 }, { Q1: 24 });
  assert.equal(mirrorFirstMarkChanges(first, marks({ Q1: 15, Q2: 12 }, { Q1: 24 }), marks({ Q1: 15, Q2: 12 }, { Q1: 24 })), null);
});

test("a stale copy saved before a recall is replaced by the corrected First Examiner mark", () => {
  const oldFirst = marks({ Q1: 15, Q2: 12 }, { Q1: 24 });
  const staleCopy = marks({ Q1: 15, Q2: 12 }, { Q1: 24 });      // what "Save Progress" stored
  const newFirst = marks({ Q1: 14, Q2: 12 }, { Q1: 24 });       // First Examiner corrects essay Q1 15 -> 14
  const mirrored = mirrorFirstMarkChanges(oldFirst, newFirst, staleCopy);
  assert.deepEqual(mirrored, marks({ Q1: 14, Q2: 12 }, { Q1: 24 }));
  // ...so the Second Examiner's ledger now starts from the corrected mark, not the stale one
  assert.equal(seedSecondExamMarks(newFirst, mirrored!).theory.essay.Q1, 14);
  // and, without the fix, the stale copy would have shadowed it:
  assert.equal(seedSecondExamMarks(newFirst, staleCopy).theory.essay.Q1, 15);
});

test("corrections on untouched questions survive; a correction on a changed question is reset", () => {
  const oldFirst = marks({ Q1: 20, Q2: 5 }, { Q1: 25, Q2: 20 });
  const second = marks({ Q1: 20, Q2: 9 }, { Q1: 24, Q2: 20 });   // Q2 essay corrected 5 -> 9; practical Q1 corrected 25 -> 24
  const newFirst = marks({ Q1: 12, Q2: 5 }, { Q1: 22, Q2: 20 }); // First Examiner changes essay Q1 and practical Q1
  assert.deepEqual(
    mirrorFirstMarkChanges(oldFirst, newFirst, second),
    marks({ Q1: 12, Q2: 9 }, { Q1: 22, Q2: 20 }),
    "essay Q2 correction kept; essay Q1 and practical Q1 reset to the new First Examiner marks"
  );
});

test("clearing a First Examiner mark removes the stored second mark; a newly answered question is mirrored", () => {
  const second = marks({ Q1: 15, Q2: 12 }, { Q1: 24 });
  assert.deepEqual(
    mirrorFirstMarkChanges(marks({ Q1: 15, Q2: 12 }, { Q1: 24 }), marks({ Q2: 12 }, { Q1: 24 }), second),
    marks({ Q2: 12 }, { Q1: 24 })
  );
  assert.deepEqual(
    mirrorFirstMarkChanges(marks({ Q1: 15 }), marks({ Q1: 15, Q3: 8 }), marks({ Q1: 15 })),
    marks({ Q1: 15, Q3: 8 })
  );
});

test("mirrorFirstMarkChanges does not mutate its inputs", () => {
  const oldFirst = marks({ Q1: 15 }), newFirst = marks({ Q1: 14 }), second = marks({ Q1: 15 });
  const snapshot = JSON.stringify([oldFirst, newFirst, second]);
  mirrorFirstMarkChanges(oldFirst, newFirst, second);
  assert.equal(JSON.stringify([oldFirst, newFirst, second]), snapshot);
});

// ─── One definition of "this student's variance counts" ───

const bp = normaliseFinalBlueprint({
  enabled: true, weightage: 60,
  theory: {
    mcq: { questions: [1, 2, 3].map(i => ({ id: `Q${i}`, maxMarks: 2 })), questionsToAnswer: 3 },
    essay: { questions: [1, 2, 3].map(i => ({ id: `Q${i}`, maxMarks: 20 })), questionsToAnswer: 2 },
  },
  practical: { questions: [{ id: "Q1", maxMarks: 30 }], questionsToAnswer: 1 },
});
// required max = 6 + 2x20 + 30 = 76, so one raw mark is 60/76 of a weighted mark
const student = (first: FinalPaperMarks, second: FinalPaperMarks | undefined, extra: Record<string, unknown> = {}) => ({
  studentIndex: "S001", finalExamQuestionsMarks: first, secondExamMarks: second ?? empty,
  isAbsentTheory: false, isAbsentPractical: false, isAbsentFinal: false, isEligible: true, ...extra,
});
const base = marks({ Q1: 15, Q2: 12 }, { Q1: 24 }, { Q1: 2, Q2: 2, Q3: 1 });
const higher = (n: number) => marks({ Q1: 15, Q2: 12 }, { Q1: 24 + n }, { Q1: 2, Q2: 2, Q3: 1 });

test("finalPaperVariance skips ineligible, wholly absent and unmarked students", () => {
  const far = marks({ Q1: 0, Q2: 0 }, { Q1: 0 }, { Q1: 0, Q2: 0, Q3: 0 });
  assert.equal(finalPaperVariance(student(base, far, { isEligible: false }), bp), null, "ineligible: outside the cohort");
  assert.equal(finalPaperVariance(student(base, far, { isAbsentTheory: true, isAbsentPractical: true, isAbsentFinal: true }), bp), null);
  assert.equal(finalPaperVariance(student(base, undefined), bp), null, "no Second Examiner marks stored");
  assert.ok((finalPaperVariance(student(base, far), bp) ?? 0) > VARIANCE_THRESHOLD, "the same marks ARE compared for an eligible student");
});

test("finalPaperVariance is a weighted difference and the threshold is strictly greater than 1", () => {
  assert.equal(finalPaperVariance(student(base, higher(0)), bp), 0);
  const oneRaw = finalPaperVariance(student(base, higher(1)), bp)!;
  assert.ok(Math.abs(oneRaw - 60 / 76) < 1e-9, `1 raw mark = ${60 / 76} weighted, got ${oneRaw}`);
  assert.equal(exceedsVarianceThreshold(oneRaw), false);
  assert.equal(exceedsVarianceThreshold(1), false, "exactly 1 does not need reconciliation");
  assert.equal(exceedsVarianceThreshold(1.0000001), true);
  assert.equal(exceedsVarianceThreshold(null), false);
  assert.equal(exceedsVarianceThreshold(finalPaperVariance(student(base, higher(2)), bp)), true, "2 raw marks = 1.58 weighted");
});

test("finalPaperVariance matches the console's previous formula for every eligible student", () => {
  // The console used to compute this itself and forgot about eligibility. Replay its old formula
  // over many deterministic pseudo-random students: the shared helper must agree wherever the old
  // formula applied, and return null for the ineligible students the old formula wrongly counted.
  let seed = 12345;
  const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
  const pick = (max: number, p = 80) => (rnd(100) < p ? rnd(max + 1) : undefined);
  const section = (n: number, max: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`Q${i + 1}`, pick(max)]).filter(([, v]) => v !== undefined)) as Record<string, number>;
  const randomMarks = (): FinalPaperMarks => marks(section(3, 20), { ...section(1, 30) }, section(3, 2));
  const oldConsoleVariance = (s: ReturnType<typeof student>) => {
    if (normaliseFinalAbsence(s).isAbsentFinal || !hasAnyMark(s.secondExamMarks)) return null;
    return Math.abs(computeFinalPaperTotals(s, bp, s.finalExamQuestionsMarks).weighted - computeFinalPaperTotals(s, bp, s.secondExamMarks).weighted);
  };
  let compared = 0, skippedIneligible = 0;
  for (let i = 0; i < 400; i++) {
    const absentT = rnd(5) === 0, absentP = rnd(5) === 0;
    const s = student(randomMarks(), rnd(4) === 0 ? undefined : randomMarks(), {
      isAbsentTheory: absentT, isAbsentPractical: absentP, isAbsentFinal: absentT && absentP, isEligible: rnd(5) !== 0,
    });
    const next = finalPaperVariance(s, bp);
    if (!s.isEligible) { assert.equal(next, null); skippedIneligible++; continue; }
    const old = oldConsoleVariance(s);
    if (old === null) assert.equal(next, null); else { assert.ok(next !== null && Math.abs(next - old) < 1e-9, `row ${i}: ${next} vs ${old}`); compared++; }
  }
  assert.ok(compared > 100 && skippedIneligible > 20, `exercised ${compared} comparisons and ${skippedIneligible} ineligible rows`);
});
