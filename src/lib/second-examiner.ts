import type { FinalPaperMarks, MarksheetStatus } from "@/types/hod";

/** Explicit status allowlist: DRAFT/MARKING never count as a handover. */
export function hasExaminerHandover(status?: MarksheetStatus): boolean {
  return status !== undefined && ["SECOND_CHECKING", "FINALIZED", "RECONCILIATION_NEEDED", "RECONCILED"].includes(status);
}

/** Seed the correction ledger without mutating the First Examiner's original. */
export function seedSecondExamMarks(first: FinalPaperMarks, second: FinalPaperMarks): FinalPaperMarks {
  return {
    theory: { mcq: { ...first.theory.mcq, ...second.theory.mcq }, essay: { ...first.theory.essay, ...second.theory.essay } },
    practical: { ...first.practical, ...second.practical },
  };
}

export function isEditedMark(first: unknown, second: unknown): boolean {
  return typeof second === "number" && Number.isFinite(second) && second !== first;
}

type SectionPath = readonly ["theory", "mcq"] | readonly ["theory", "essay"] | readonly ["practical"];
const SECTION_PATHS: readonly SectionPath[] = [["theory", "mcq"], ["theory", "essay"], ["practical"]];

function sectionOf(marks: FinalPaperMarks, path: SectionPath): Record<string, number> {
  return path.length === 2 ? marks.theory[path[1]] : marks.practical;
}

/**
 * Keep a stored Second Examiner ledger in step with a First Examiner edit.
 *
 * "Save Progress" stores the whole correction ledger, including unchanged
 * copies of the First Examiner's marks. If the First Examiner then recalls the
 * marksheet and changes a mark, the stored copy would silently shadow the new
 * value: the ledger would keep showing the old mark and the HOD result sheet
 * (which gives the Second Examiner's marks precedence) would use it too.
 *
 * So whenever the First Examiner's mark for a question changes, the stored
 * second mark for that question is reset to the new First Examiner value, or
 * removed when the First Examiner cleared it. A genuine correction on a question
 * the First Examiner did not touch is kept. A correction on a question the
 * First Examiner did change is reset on purpose: its baseline moved, so the
 * Second Examiner needs to look at it again.
 *
 * Returns the updated ledger, or null when nothing needs to change, including
 * when no second marks are stored at all (the ledger then seeds itself from the
 * First Examiner's marks on every load).
 */
export function mirrorFirstMarkChanges(
  oldFirst: FinalPaperMarks,
  newFirst: FinalPaperMarks,
  second: FinalPaperMarks
): FinalPaperMarks | null {
  const hasStoredMarks = SECTION_PATHS.some(path =>
    Object.values(sectionOf(second, path)).some(value => typeof value === "number" && Number.isFinite(value))
  );
  if (!hasStoredMarks) return null;

  const next: FinalPaperMarks = {
    theory: { mcq: { ...second.theory.mcq }, essay: { ...second.theory.essay } },
    practical: { ...second.practical },
  };
  let changed = false;

  for (const path of SECTION_PATHS) {
    const before = sectionOf(oldFirst, path);
    const after = sectionOf(newFirst, path);
    const target = sectionOf(next, path);
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[id] === after[id]) continue; // the First Examiner did not touch this question
      if (after[id] === undefined) {
        if (id in target) { delete target[id]; changed = true; }
      } else if (target[id] !== after[id]) {
        target[id] = after[id];
        changed = true;
      }
    }
  }
  return changed ? next : null;
}
