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
