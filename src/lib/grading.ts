/** Grades use the unrounded module mark. Display rounding must not change a grade. */
export interface GradeResult {
  grade: string;
  point: number;
  description: string;
}

export const GRADE_BANDS = [
  { minimum: 85, grade: "A+", point: 4.0, description: "Superior Performance" },
  { minimum: 70, grade: "A", point: 4.0, description: "Excellent" },
  { minimum: 65, grade: "A-", point: 3.7, description: "Very Good" },
  { minimum: 60, grade: "B+", point: 3.3, description: "Good, clearly above average" },
  { minimum: 55, grade: "B", point: 3.0, description: "Above average" },
  { minimum: 50, grade: "B-", point: 2.7, description: "Average performance" },
  { minimum: 45, grade: "C+", point: 2.3, description: "Quite Satisfactory" },
  { minimum: 40, grade: "C", point: 2.0, description: "Pass and possesses basic understanding of the subject matter" },
  { minimum: 35, grade: "C-", point: 1.7, description: "Satisfactory" },
  { minimum: 30, grade: "D+", point: 1.3, description: "Weak" },
  { minimum: 25, grade: "D", point: 1.0, description: "Quite Weak" },
  { minimum: 0, grade: "E", point: 0.0, description: "Very weak" },
] as const;

export function gradeForMark(mark: number, { incomplete = false }: { incomplete?: boolean } = {}): GradeResult {
  if (incomplete || !Number.isFinite(mark)) return { grade: "I", point: 0, description: "Incomplete" };
  const bounded = Math.min(100, Math.max(0, mark));
  return GRADE_BANDS.find(band => bounded >= band.minimum)!;
}

/** Any recorded absence gives I; an explicitly entered zero is E, not I. */
export function hasGradeAbsence(row: {
  isAbsentCa?: Record<string, boolean> | unknown;
  isAbsentTheory?: boolean | null;
  isAbsentPractical?: boolean | null;
  isAbsentFinal?: boolean | null;
}): boolean {
  return row.isAbsentTheory === true || row.isAbsentPractical === true || row.isAbsentFinal === true
    || Object.values(row.isAbsentCa ?? {}).some(value => value === true);
}

export const formatMark2dp = (mark: number): string => mark.toFixed(2);
export const roundUpWhole = (mark: number): number => Math.ceil(mark);
