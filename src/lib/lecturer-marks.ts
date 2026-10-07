// ─────────────────────────────────────────────────────────────────────────────
// Lecturer Desk — shared marksheet engine
//
// Pure, dependency-free helpers used by BOTH the Lecturer Desk UI
// (src/app/dashboard/lecturer/page.tsx), the HOD Console preview and the
// lecturer API routes. Keeping the maths in one place means the blueprint
// builder, the entry grids, the summary panel, the CSV export and the
// server-side gate can never drift apart.
//
// ── CA component groups ──────────────────────────────────────────────────────
//   Group A (practical / performance work)
//     PROJECT · PRESENTATION · LAB_REPORT
//     → Type, Name, Weightage, Total Marks, Score Mode.
//     → One mark per student for the whole component.
//
//   Group B (discrete written assessments)
//     QUIZ · ASSIGNMENT · MIDTERM · TUTORIAL
//     → Type, Name, Weightage, Total Questions + a per-question weightage
//       (marks) row for every question, Score Mode.
//     → One mark per question, each with its own maximum.
//
// Scoring semantics stay identical to the Second Examiner desk so variance
// comparisons remain meaningful:
//   • Only the first `questionsToAnswer` answered questions count, ordered
//     naturally (Q1, Q2, … Q10 — never Q1, Q10, Q2). JSONB does not preserve
//     key order, so relying on it made totals unstable across reloads.
//   • SUM  → sum of those answers.
//   • AVG  → that sum divided by `questionsToAnswer`.
// ─────────────────────────────────────────────────────────────────────────────

import type { CaComponent, CaGroup, FinalBlueprint, ModuleStats } from "@/types/hod";

// ─── Small utilities ─────────────────────────────────────────────────────────

/**
 * `Module.stats` is a free-form JSON column. Narrow it to the shape the desks
 * actually read/write instead of casting at every call site.
 */
export function asModuleStats(value: unknown): ModuleStats {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ModuleStats)
    : {};
}

/** Human-readable message for an unknown `catch` binding. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ─── CA component types & groups ─────────────────────────────────────────────

/** Practical / performance components — one overall mark. */
export const CA_GROUP_A_TYPES = ["PROJECT", "PRESENTATION", "LAB_REPORT"] as const;

/** Discrete written assessments — one mark per question. */
export const CA_GROUP_B_TYPES = ["QUIZ", "ASSIGNMENT", "MIDTERM", "TUTORIAL"] as const;

export const CA_TYPES_BY_GROUP: Record<CaGroup, readonly string[]> = {
  A: CA_GROUP_A_TYPES,
  B: CA_GROUP_B_TYPES,
};

export const CA_GROUP_META: Record<CaGroup, { label: string; short: string; blurb: string; badge: string }> = {
  A: {
    label: "Group A · Practical & performance",
    short: "Practical & performance",
    blurb: "One overall mark per student (project, presentation, lab report).",
    badge: "bg-violet-100 text-violet-700 border-violet-200",
  },
  B: {
    label: "Group B · Written assessments",
    short: "Written assessments",
    blurb: "Marks per question, each with its own weightage.",
    badge: "bg-sky-100 text-sky-700 border-sky-200",
  },
};

const CA_TYPE_GROUP: Record<string, CaGroup> = {
  PROJECT: "A",
  PRESENTATION: "A",
  LAB_REPORT: "A",
  QUIZ: "B",
  ASSIGNMENT: "B",
  MIDTERM: "B",
  TUTORIAL: "B",
};

export const CA_TYPE_LABELS: Record<string, string> = {
  QUIZ: "Quiz",
  ASSIGNMENT: "Assignment",
  MIDTERM: "Midterm",
  TUTORIAL: "Tutorial",
  PROJECT: "Project",
  PRESENTATION: "Presentation",
  LAB_REPORT: "Lab report",
};

export function caTypeLabel(type: unknown): string {
  const key = String(type ?? "").trim().toUpperCase();
  return CA_TYPE_LABELS[key] ?? (key ? key.replace(/_/g, " ") : "Component");
}

/** Which scoring shape does this component type use? Unknown types default to B. */
export function caGroupOf(type: unknown): CaGroup {
  const key = String(type ?? "").trim().toUpperCase();
  return CA_TYPE_GROUP[key] ?? "B";
}

function componentGroup(comp: Pick<CaComponent, "group" | "type">): CaGroup {
  return comp.group === "A" || comp.group === "B" ? comp.group : caGroupOf(comp.type);
}

// ─── Component normalisation (blueprint → canonical shape) ───────────────────

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  return floored > 0 ? floored : null;
}

function buildQuestionMarks(raw: unknown, totalQuestions: number, fallbackPer: number): number[] {
  const source = Array.isArray(raw) ? raw : [];
  const fallback = fallbackPer > 0 ? fallbackPer : 10;
  return Array.from({ length: totalQuestions }, (_, i) => {
    const value = Number(source[i]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  });
}

/**
 * Coerce stored/legacy blueprint data into the canonical component shape.
 * Blueprints saved before the Group A / Group B split are upgraded here:
 * a uniform `marksPerQuestion` becomes a per-question weightage list, and
 * `totalQuestions × marksPerQuestion` becomes `totalMarks` for Group A.
 */
export function normaliseCaComponent(raw: unknown): CaComponent {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const type = String(source.type ?? "ASSIGNMENT").trim().toUpperCase() || "ASSIGNMENT";
  const group = caGroupOf(type);
  const id = typeof source.id === "string" && source.id.trim()
    ? source.id
    : `ca_${Math.random().toString(36).slice(2, 10)}`;
  const name = typeof source.name === "string" ? source.name : "";
  const weightage = Number(source.weightage) || 0;
  const scoreMode: "SUM" | "AVG" = source.scoreMode === "AVG" ? "AVG" : "SUM";

  const legacyPer = Number(source.marksPerQuestion) || 0;
  const legacyCount = positiveInt(source.totalQuestions) ?? (Array.isArray(source.questionMarks) ? source.questionMarks.length : 0);

  if (group === "A") {
    const legacyMax = (legacyCount ?? 0) * legacyPer;
    const stored = Number(source.totalMarks);
    const totalMarks = Number.isFinite(stored) && stored > 0 ? stored : (legacyMax > 0 ? legacyMax : 100);
    return {
      id, type, name, weightage, scoreMode, group,
      totalMarks,
      totalQuestions: 1,
      questionMarks: [totalMarks],
      questionsToAnswer: 1,
      marksPerQuestion: totalMarks,
    };
  }

  const totalQuestions = Math.max(1, legacyCount || 3);
  const questionMarks = buildQuestionMarks(source.questionMarks, totalQuestions, legacyPer);
  const storedAnswer = positiveInt(source.questionsToAnswer);
  const questionsToAnswer = storedAnswer ? Math.min(totalQuestions, storedAnswer) : totalQuestions;

  return {
    id, type, name, weightage, scoreMode, group,
    totalQuestions,
    questionMarks,
    questionsToAnswer,
    marksPerQuestion: Math.max(...questionMarks),
  };
}

export function normaliseCaComponents(list: unknown): CaComponent[] {
  return Array.isArray(list) ? list.map(normaliseCaComponent) : [];
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const MARKSHEET_STATUSES = [
  "DRAFT",
  "MARKING",
  "SECOND_CHECKING",
  "FINALIZED",
  "RECONCILIATION_NEEDED",
  "RECONCILED",
] as const;

export type MarksheetStatusValue = (typeof MARKSHEET_STATUSES)[number];

/** Variance above which a marksheet is flagged for joint reconciliation. */
export const VARIANCE_THRESHOLD = 1;

/**
 * Statuses in which the Active Lecturer's part of the marksheet is closed.
 * Once the Examiner has finalised (or reconciliation has begun) the lecturer's
 * ledger must be immutable — otherwise a late edit would silently invalidate a
 * marksheet the Examiner has already signed off on.
 */
export const LECTURER_EDIT_LOCKED: MarksheetStatusValue[] = [
  "FINALIZED",
  "RECONCILIATION_NEEDED",
  "RECONCILED",
];

export const STATUS_META: Record<MarksheetStatusValue, { label: string; badge: string }> = {
  DRAFT: { label: "Draft", badge: "bg-neutral-100 text-neutral-500" },
  MARKING: { label: "Marking", badge: "bg-amber-100 text-amber-700" },
  SECOND_CHECKING: { label: "2nd Check", badge: "bg-indigo-100 text-indigo-700" },
  FINALIZED: { label: "Finalized", badge: "bg-emerald-100 text-emerald-700" },
  RECONCILIATION_NEEDED: { label: "Reconciliation Needed", badge: "bg-orange-100 text-orange-700 animate-pulse" },
  RECONCILED: { label: "Reconciled", badge: "bg-teal-100 text-teal-700" },
};

export function isMarksheetStatus(value: unknown): value is MarksheetStatusValue {
  return typeof value === "string" && (MARKSHEET_STATUSES as readonly string[]).includes(value);
}

export function statusLabel(status?: string | null): string {
  return isMarksheetStatus(status) ? STATUS_META[status].label : "Draft";
}

export function statusBadgeClass(status?: string | null): string {
  return isMarksheetStatus(status) ? STATUS_META[status].badge : STATUS_META.DRAFT.badge;
}

export function isLecturerLocked(status?: string | null): boolean {
  return isMarksheetStatus(status) && LECTURER_EDIT_LOCKED.includes(status);
}

// ─── Row shape (structural — works for Prisma rows and client records) ───────

export interface MarkRowLike {
  studentIndex: string;
  caQuestionsMarks?: Record<string, Record<string, number>> | null;
  finalExamQuestionsMarks?: Record<string, number> | null;
  secondExamMarks?: Record<string, number> | null;
  isAbsentCa?: Record<string, boolean> | null;
  isAbsentFinal?: boolean | null;
}

// ─── Question helpers ────────────────────────────────────────────────────────

/** ["Q1", "Q2", … "Qn"] */
export function questionKeys(count: number): string[] {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return Array.from({ length: n }, (_, i) => `Q${i + 1}`);
}

/** Natural question ordering: Q1, Q2 … Q10 (a plain sort would give Q1, Q10, Q2). */
export function sortQuestionKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const na = parseInt(String(a).replace(/\D/g, ""), 10);
    const nb = parseInt(String(b).replace(/\D/g, ""), 10);
    const aNumeric = Number.isFinite(na);
    const bNumeric = Number.isFinite(nb);
    if (aNumeric && bNumeric && na !== nb) return na - nb;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return String(a).localeCompare(String(b));
  });
}

function questionNumber(key: string): number {
  const n = parseInt(String(key).replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A blank cell is anything that is null/undefined/""/not a finite number. */
function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Marks that have actually been entered, in natural question order. */
export function enteredMarks(marks?: Record<string, unknown> | null): { key: string; value: number }[] {
  if (!marks || typeof marks !== "object") return [];
  const out: { key: string; value: number }[] = [];
  for (const key of sortQuestionKeys(Object.keys(marks))) {
    const value = toFiniteNumber((marks as Record<string, unknown>)[key]);
    if (value !== null) out.push({ key, value });
  }
  return out;
}

export function answeredCount(marks?: Record<string, unknown> | null): number {
  return enteredMarks(marks).length;
}

export function hasAnyMark(marks?: Record<string, unknown> | null): boolean {
  return answeredCount(marks) > 0;
}

// ─── Component geometry (works on normalised OR legacy components) ───────────

/** How many input cells does this component have per student? (Group A → 1) */
export function componentQuestionCount(comp: CaComponent): number {
  if (componentGroup(comp) === "A") return 1;
  const listLength = Array.isArray(comp.questionMarks) ? comp.questionMarks.length : 0;
  return Math.max(1, positiveInt(comp.totalQuestions) ?? (listLength || 1));
}

/** The maximum a single cell of this component can hold. */
export function componentQuestionMax(comp: CaComponent, questionKey: string): number {
  if (componentGroup(comp) === "A") {
    const explicit = Number(comp.totalMarks);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const legacy = (positiveInt(comp.totalQuestions) ?? 0) * (Number(comp.marksPerQuestion) || 0);
    return legacy > 0 ? legacy : (Number(comp.marksPerQuestion) || 0);
  }
  const index = Math.max(0, questionNumber(questionKey) - 1);
  const per = Array.isArray(comp.questionMarks) ? Number(comp.questionMarks[index]) : NaN;
  if (Number.isFinite(per) && per > 0) return per;
  return Number(comp.marksPerQuestion) || 0;
}

/** Cell keys for this component's grid row: Group A → ["Q1"] (rendered as "Mark"). */
export function componentQuestionKeys(comp: CaComponent): string[] {
  return questionKeys(componentQuestionCount(comp));
}

/** How many answers the student must provide (Group A → 1). */
export function componentRequiredAnswers(comp: CaComponent): number {
  const count = componentQuestionCount(comp);
  const stored = positiveInt(comp.questionsToAnswer);
  return stored ? Math.min(count, stored) : count;
}

/** Raw score obtainable = sum of the maxima of the questions that must be answered. */
export function componentMaxScore(comp: CaComponent): number {
  const required = componentRequiredAnswers(comp);
  return componentQuestionKeys(comp)
    .slice(0, required)
    .reduce((sum, key) => sum + componentQuestionMax(comp, key), 0);
}

/** The component's own "worth" before weighting (Group A → totalMarks). */
export function componentRawTotal(comp: CaComponent): number {
  if (componentGroup(comp) === "A") return componentQuestionMax(comp, "Q1");
  const marks = Array.isArray(comp.questionMarks) ? comp.questionMarks : [];
  if (marks.length === 0) return componentMaxScore(comp);
  return marks.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function finalMaxScore(bp?: Pick<FinalBlueprint, "questionsToAnswer" | "marksPerQuestion"> | null): number {
  if (!bp) return 0;
  return (Math.max(0, Number(bp.questionsToAnswer) || 0)) * (Math.max(0, Number(bp.marksPerQuestion) || 0));
}

// ─── Core scoring ────────────────────────────────────────────────────────────

/**
 * Raw (un-weighted) total for one grid row — CA component or final paper.
 * Mirrors the Second Examiner desk exactly, minus the ordering instability.
 */
export function computeRowTotal(
  marks: Record<string, unknown> | null | undefined,
  questionsToAnswer: number,
  scoreMode: "SUM" | "AVG" | string | undefined
): number {
  const required = Math.max(0, Math.floor(Number(questionsToAnswer) || 0));
  const counted = enteredMarks(marks).slice(0, required > 0 ? required : undefined);
  const sum = counted.reduce((acc, m) => acc + m.value, 0);
  if (scoreMode === "AVG") return required > 0 ? sum / required : 0;
  return sum;
}

export interface WeightedBreakdown {
  /** Weighted CA contribution (e.g. 27.5 out of a 40% CA block). */
  ca: number;
  /** Weighted final-exam contribution. */
  final: number;
  /** Final module mark out of 100 when the weights total 100%. */
  total: number;
  caMax: number;
  finalMax: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Weighted module mark derived from the module's own blueprint.
 * Absent students contribute 0 for that block (AB = no marks awarded).
 */
export function computeWeightedScores(
  row: MarkRowLike,
  caComponents: CaComponent[],
  finalBlueprint?: FinalBlueprint | null
): WeightedBreakdown {
  let ca = 0;
  let caMax = 0;

  for (const comp of caComponents ?? []) {
    const weight = Number(comp.weightage) || 0;
    caMax += weight;
    if (row.isAbsentCa?.[comp.id]) continue; // absent → 0
    const max = componentMaxScore(comp);
    if (max <= 0) continue;
    const raw = computeRowTotal(
      row.caQuestionsMarks?.[comp.id] ?? {},
      componentRequiredAnswers(comp),
      comp.scoreMode
    );
    ca += (Math.min(Math.max(raw, 0), max) / max) * weight;
  }

  let final = 0;
  let finalMax = 0;
  if (finalBlueprint?.enabled) {
    const weight = Number(finalBlueprint.weightage) || 0;
    finalMax = weight;
    const max = finalMaxScore(finalBlueprint);
    if (!row.isAbsentFinal && max > 0) {
      const raw = computeRowTotal(row.finalExamQuestionsMarks ?? {}, finalBlueprint.questionsToAnswer, finalBlueprint.scoreMode);
      final = (Math.min(Math.max(raw, 0), max) / max) * weight;
    }
  }

  return {
    ca: round1(ca),
    final: round1(final),
    total: round1(ca + final),
    caMax: round1(caMax),
    finalMax: round1(finalMax),
  };
}

/** Percentage of the required cells that have been filled for one student. */
export interface RowProgress {
  filled: number;
  required: number;
  percent: number;
  isComplete: boolean;
}

export function computeRowProgress(
  row: MarkRowLike,
  caComponents: CaComponent[],
  finalBlueprint?: FinalBlueprint | null
): RowProgress {
  let filled = 0;
  let required = 0;

  for (const comp of caComponents ?? []) {
    if (row.isAbsentCa?.[comp.id]) continue;
    const need = Math.max(1, componentRequiredAnswers(comp));
    required += need;
    filled += Math.min(answeredCount(row.caQuestionsMarks?.[comp.id] ?? {}), need);
  }

  if (finalBlueprint?.enabled && !row.isAbsentFinal) {
    const need = Math.max(1, Number(finalBlueprint.questionsToAnswer) || 1);
    required += need;
    filled += Math.min(answeredCount(row.finalExamQuestionsMarks ?? {}), need);
  }

  const percent = required === 0 ? 100 : Math.round((filled / required) * 100);
  return { filled, required, percent, isComplete: required === 0 || filled >= required };
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type MarksheetIssueLevel = "error" | "warning";

export interface MarksheetIssue {
  level: MarksheetIssueLevel;
  /** Undefined for module-wide issues. */
  studentIndex?: string;
  message: string;
}

/**
 * Full marksheet audit. `error` blocks submission to the Second Examiner,
 * `warning` is advisory (the lecturer can still submit).
 */
export function validateMarksheet(
  rows: MarkRowLike[],
  caComponents: CaComponent[],
  finalBlueprint?: FinalBlueprint | null
): MarksheetIssue[] {
  const issues: MarksheetIssue[] = [];
  const comps = caComponents ?? [];

  // ── Module-level structure ────────────────────────────────────────────────
  if (rows.length === 0) {
    issues.push({ level: "error", message: "No students have been added to this marksheet." });
  }
  if (comps.length === 0 && !finalBlueprint?.enabled) {
    issues.push({ level: "error", message: "The blueprint is empty — define CA components or enable the final paper first." });
  }

  const caWeight = comps.reduce((sum, c) => sum + (Number(c.weightage) || 0), 0);
  const finalWeight = finalBlueprint?.enabled ? Number(finalBlueprint.weightage) || 0 : 0;
  if (comps.length > 0 || finalBlueprint?.enabled) {
    if (Math.abs(caWeight + finalWeight - 100) > 0.001) {
      issues.push({
        level: "error",
        message: `Blueprint weights total ${round1(caWeight + finalWeight)}% — they must total exactly 100%.`,
      });
    }
  }

  comps.forEach((comp, idx) => {
    const group = componentGroup(comp);
    const label = comp.name?.trim() || `${caTypeLabel(comp.type)} component ${idx + 1}`;

    if (!comp.name?.trim()) {
      issues.push({ level: "warning", message: `${label}: give this component a name.` });
    }
    if (!(Number(comp.weightage) > 0)) {
      issues.push({ level: "warning", message: `${label}: weightage is 0%.` });
    }

    if (group === "A") {
      if (!(componentQuestionMax(comp, "Q1") > 0)) {
        issues.push({ level: "error", message: `${label}: total marks must be greater than 0.` });
      }
    } else {
      const count = componentQuestionCount(comp);
      if (!(Number(comp.totalQuestions) > 0)) {
        issues.push({ level: "error", message: `${label}: total questions must be greater than 0.` });
      }
      const missing = questionKeys(count).filter(key => !(componentQuestionMax(comp, key) > 0));
      if (missing.length > 0) {
        issues.push({
          level: "error",
          message: `${label}: every question needs a weightage — missing ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}.`,
        });
      }
    }
  });

  if (finalBlueprint?.enabled) {
    if (!(Number(finalBlueprint.marksPerQuestion) > 0)) {
      issues.push({ level: "error", message: "Final paper: marks per question must be greater than 0." });
    }
    if (Number(finalBlueprint.questionsToAnswer) > Number(finalBlueprint.totalQuestions)) {
      issues.push({ level: "error", message: "Final paper: the number of questions to answer exceeds the total questions." });
    }
  }

  // ── Duplicate student indexes ─────────────────────────────────────────────
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.studentIndex)) duplicates.add(row.studentIndex);
    seen.add(row.studentIndex);
  }
  for (const index of duplicates) {
    issues.push({ level: "error", studentIndex: index, message: `${index}: duplicated in the marksheet.` });
  }

  // ── Per-student cell coverage & range ─────────────────────────────────────
  for (const row of rows) {
    const index = row.studentIndex;

    for (const comp of comps) {
      const label = comp.name?.trim() || caTypeLabel(comp.type);
      if (row.isAbsentCa?.[comp.id]) continue;

      const keys = componentQuestionKeys(comp);
      const required = Math.max(1, componentRequiredAnswers(comp));
      const marks = (row.caQuestionsMarks?.[comp.id] ?? {}) as Record<string, unknown>;
      const entered = enteredMarks(marks);

      if (entered.length < required) {
        issues.push({
          level: "error",
          studentIndex: index,
          message: `${index}: ${label} — ${entered.length} of ${required} required answers recorded.`,
        });
      } else if (entered.length > keys.length) {
        issues.push({
          level: "warning",
          studentIndex: index,
          message: `${index}: ${label} — ${entered.length} answers recorded but only ${keys.length} questions exist.`,
        });
      } else if (entered.length > required) {
        issues.push({
          level: "warning",
          studentIndex: index,
          message: `${index}: ${label} — ${entered.length} answers recorded but only ${required} are counted.`,
        });
      }

      for (const mark of entered) {
        const max = componentQuestionMax(comp, mark.key);
        if (mark.value < 0 || (max > 0 && mark.value > max)) {
          issues.push({
            level: "error",
            studentIndex: index,
            message: `${index}: ${label} ${mark.key} is ${mark.value} — must be between 0 and ${max}.`,
          });
        }
      }
    }

    if (finalBlueprint?.enabled && !row.isAbsentFinal) {
      const required = Math.max(1, Number(finalBlueprint.questionsToAnswer) || 1);
      const perMark = Number(finalBlueprint.marksPerQuestion) || 0;
      const entered = enteredMarks(row.finalExamQuestionsMarks ?? {});

      if (entered.length < required) {
        issues.push({
          level: "error",
          studentIndex: index,
          message: `${index}: final paper — ${entered.length} of ${required} required answers recorded.`,
        });
      } else if (entered.length > required) {
        issues.push({
          level: "warning",
          studentIndex: index,
          message: `${index}: final paper — ${entered.length} answers recorded but only ${required} are counted.`,
        });
      }

      for (const mark of entered) {
        if (mark.value < 0 || (perMark > 0 && mark.value > perMark)) {
          issues.push({
            level: "error",
            studentIndex: index,
            message: `${index}: final ${mark.key} is ${mark.value} — must be between 0 and ${perMark}.`,
          });
        }
      }
    }
  }

  return issues;
}

export function blockingIssues(issues: MarksheetIssue[]): MarksheetIssue[] {
  return issues.filter(i => i.level === "error");
}

/** Compact "first N issues, then +X more" summary for banners. */
export function summariseIssues(issues: MarksheetIssue[], limit = 3): string {
  const shown = issues.slice(0, limit).map(i => i.message);
  const rest = issues.length - shown.length;
  return rest > 0 ? `${shown.join(" ")} (+${rest} more)` : shown.join(" ");
}

// ─── Blueprint input validation (shared by the API and the Save button) ─────

function isFiniteNumber(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function isPositiveInt(value: unknown): boolean {
  return isFiniteNumber(value) && Number.isInteger(Number(value)) && Number(value) > 0;
}

/**
 * Validates a raw blueprint payload, understanding both component groups.
 * Returns null when structurally sound, otherwise the reason.
 */
export function validateBlueprintInput(
  caComponents: unknown,
  finalBlueprint: unknown
): string | null {
  if (!Array.isArray(caComponents)) return "caComponents must be an array.";
  if (!finalBlueprint || typeof finalBlueprint !== "object") return "finalBlueprint is required.";

  const bp = finalBlueprint as Record<string, unknown>;

  if (typeof bp.enabled !== "boolean") return "finalBlueprint.enabled must be a boolean.";
  if (!isFiniteNumber(bp.weightage) || Number(bp.weightage) < 0 || Number(bp.weightage) > 100) {
    return "Final paper weightage must be between 0 and 100.";
  }
  if (!isPositiveInt(bp.totalQuestions)) return "Final paper total questions must be a positive whole number.";
  if (!isPositiveInt(bp.marksPerQuestion)) return "Final paper marks per question must be a positive whole number.";
  if (!isPositiveInt(bp.questionsToAnswer)) return "Final paper questions to answer must be a positive whole number.";
  if (Number(bp.questionsToAnswer) > Number(bp.totalQuestions)) {
    return "Final paper questions to answer cannot exceed the total questions.";
  }
  if (bp.scoreMode !== "SUM" && bp.scoreMode !== "AVG") return "Final paper score mode must be SUM or AVG.";

  for (let i = 0; i < caComponents.length; i++) {
    const comp = caComponents[i] as Record<string, unknown>;
    const rawLabel = `CA component ${i + 1}`;
    if (!comp || typeof comp !== "object") return `${rawLabel} is not a valid object.`;
    if (typeof comp.id !== "string" || !comp.id.trim()) return `${rawLabel} is missing an id.`;
    if (typeof comp.type !== "string" || !comp.type.trim()) return `${rawLabel} is missing a type.`;
    if (typeof comp.name !== "string" || !comp.name.trim()) return `${rawLabel} needs a name.`;
    if (!isFiniteNumber(comp.weightage) || Number(comp.weightage) < 0 || Number(comp.weightage) > 100) {
      return `${rawLabel} weightage must be between 0 and 100.`;
    }
    if (comp.scoreMode !== "SUM" && comp.scoreMode !== "AVG") return `${rawLabel} score mode must be SUM or AVG.`;

    const label = `CA component ${i + 1} (${caTypeLabel(comp.type)})`;

    if (caGroupOf(comp.type) === "A") {
      // Group A — one overall mark for the component.
      if (!isPositiveInt(comp.totalMarks)) {
        return `${label}: total marks must be a positive whole number.`;
      }
    } else {
      // Group B — a weightage for every question.
      const expected = normaliseCaComponent(comp);
      const count = positiveInt(comp.totalQuestions);
      if (!count) return `${label}: total questions must be a positive whole number.`;
      if (count > 50) return `${label}: total questions cannot exceed 50.`;
      if (!Array.isArray(comp.questionMarks)) {
        return `${label}: every question needs a weightage.`;
      }
      if (comp.questionMarks.length !== count) {
        return `${label}: expected ${count} question weightage(s) but received ${comp.questionMarks.length}.`;
      }
      for (let q = 0; q < count; q++) {
        const value = Number((comp.questionMarks as unknown[])[q]);
        if (!Number.isFinite(value) || value <= 0) {
          return `${label}: weightage for Q${q + 1} must be greater than 0.`;
        }
        if (value > 1000) {
          return `${label}: weightage for Q${q + 1} looks too large (maximum 1000).`;
        }
      }
      void expected;
    }
  }

  const caTotal = caComponents.reduce((sum, c) => sum + (Number((c as Record<string, unknown>).weightage) || 0), 0);
  const finalTotal = Number(bp.weightage) || 0;
  if (Math.abs(caTotal + finalTotal - 100) > 0.001) {
    return `Total weight must equal exactly 100%. Current: ${round1(caTotal + finalTotal)}% (CA: ${round1(caTotal)}% + Final: ${round1(finalTotal)}%)`;
  }

  return null;
}

// ─── Server-side sanitiser ───────────────────────────────────────────────────

export interface SanitisedRow {
  studentIndex: string;
  caQuestionsMarks: Record<string, Record<string, number>>;
  finalExamQuestionsMarks: Record<string, number>;
  isAbsentCa: Record<string, boolean>;
  isAbsentFinal: boolean;
}

/**
 * Strips anything the blueprint does not recognise and clamps every value into
 * range, so a malformed client payload can never write junk into the database.
 */
export function sanitiseMarkRow(
  raw: Record<string, unknown>,
  caComponents: CaComponent[],
  finalBlueprint?: FinalBlueprint | null
): SanitisedRow | null {
  const studentIndex = typeof raw.studentIndex === "string" ? raw.studentIndex.trim().toUpperCase() : "";
  if (!studentIndex) return null;

  const rawCa = (raw.caQuestionsMarks ?? {}) as Record<string, Record<string, unknown>>;
  const rawAbsentCa = (raw.isAbsentCa ?? {}) as Record<string, unknown>;
  const rawFinal = (raw.finalExamQuestionsMarks ?? {}) as Record<string, unknown>;

  const caQuestionsMarks: Record<string, Record<string, number>> = {};
  const isAbsentCa: Record<string, boolean> = {};

  for (const comp of caComponents ?? []) {
    const absent = rawAbsentCa[comp.id] === true;
    isAbsentCa[comp.id] = absent;
    if (absent) {
      caQuestionsMarks[comp.id] = {};
      continue;
    }
    const maxima: Record<string, number> = {};
    for (const key of componentQuestionKeys(comp)) maxima[key] = componentQuestionMax(comp, key);
    caQuestionsMarks[comp.id] = sanitiseQuestionMap(rawCa[comp.id], maxima);
  }

  const isAbsentFinal = raw.isAbsentFinal === true;
  const finalCount = Math.max(0, Number(finalBlueprint?.totalQuestions) || 0);
  const finalMaxima: Record<string, number> = {};
  for (const key of questionKeys(finalCount)) {
    finalMaxima[key] = Number(finalBlueprint?.marksPerQuestion) || 0;
  }

  const finalExamQuestionsMarks = isAbsentFinal ? {} : sanitiseQuestionMap(rawFinal, finalMaxima);

  return { studentIndex, caQuestionsMarks, finalExamQuestionsMarks, isAbsentCa, isAbsentFinal };
}

/** Keeps only the expected keys, drops blanks, clamps each to its own maximum. */
export function sanitiseQuestionMap(
  raw: unknown,
  maxima: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;

  const source = raw as Record<string, unknown>;

  for (const key of sortQuestionKeys(Object.keys(source))) {
    const max = maxima[key];
    if (max === undefined) continue; // unknown question key — drop it
    const value = toFiniteNumber(source[key]);
    if (value === null) continue;
    out[key] = Math.min(max > 0 ? max : value, Math.max(0, value));
  }

  return out;
}

// ─── CSV export ──────────────────────────────────────────────────────────────

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Full marksheet export (one row per student) including per-question marks,
 * raw totals and the weighted module mark — ready for Excel / moderation.
 */
export function buildMarksheetCsv(
  moduleCode: string,
  rows: MarkRowLike[],
  caComponents: CaComponent[],
  finalBlueprint?: FinalBlueprint | null
): string {
  const comps = caComponents ?? [];
  const finalQs = finalBlueprint?.enabled ? questionKeys(finalBlueprint.totalQuestions) : [];

  const header: string[] = ["Student Index"];
  for (const comp of comps) {
    const label = comp.name?.trim() || caTypeLabel(comp.type);
    for (const q of componentQuestionKeys(comp)) {
      header.push(componentGroup(comp) === "A" ? `${label} Mark` : `${label} ${q}`);
    }
    header.push(`${label} Total`, `${label} Max`, `${label} Absent`);
  }
  for (const q of finalQs) header.push(`Final ${q}`);
  if (finalBlueprint?.enabled) {
    header.push("Final Total", "Final Max", "Final Absent");
  }
  header.push("CA Weighted", "Final Weighted", "Module Mark (100)");

  const lines = [header.map(csvCell).join(",")];

  for (const row of rows) {
    const cells: unknown[] = [row.studentIndex];

    for (const comp of comps) {
      const marks = (row.caQuestionsMarks?.[comp.id] ?? {}) as Record<string, unknown>;
      const absent = row.isAbsentCa?.[comp.id] === true;
      const keys = componentQuestionKeys(comp);

      for (const q of keys) {
        cells.push(absent ? "AB" : (toFiniteNumber(marks[q]) ?? ""));
      }
      cells.push(
        absent ? "AB" : round1(computeRowTotal(marks, componentRequiredAnswers(comp), comp.scoreMode))
      );
      cells.push(round1(componentMaxScore(comp)));
      cells.push(absent ? "YES" : "");
    }

    const finalMarks = (row.finalExamQuestionsMarks ?? {}) as Record<string, unknown>;
    for (const q of finalQs) {
      cells.push(row.isAbsentFinal ? "AB" : (toFiniteNumber(finalMarks[q]) ?? ""));
    }
    if (finalBlueprint?.enabled) {
      cells.push(row.isAbsentFinal ? "AB" : round1(computeRowTotal(finalMarks, finalBlueprint.questionsToAnswer, finalBlueprint.scoreMode)));
      cells.push(round1(finalMaxScore(finalBlueprint)));
      cells.push(row.isAbsentFinal ? "YES" : "");
    }

    const weighted = computeWeightedScores(row, comps, finalBlueprint);
    cells.push(weighted.ca, weighted.final, weighted.total);

    lines.push(cells.map(csvCell).join(","));
  }

  return lines.join("\n");
}

/** Trigger a client-side download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
