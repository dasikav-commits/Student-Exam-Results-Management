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
// CA scoring semantics stay identical to the Second Examiner desk so variance
// comparisons remain meaningful:
//   • Only the first `questionsToAnswer` answered questions count, ordered
//     naturally (Q1, Q2, … Q10 — never Q1, Q10, Q2). JSONB does not preserve
//     key order, so relying on it made totals unstable across reloads.
//   • SUM  → sum of those answers.
//   • AVG  → that sum divided by `questionsToAnswer`.
// Final-paper scoring is sectioned and weighted by required maximum marks below.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CaComponent,
  CaGroup,
  FinalBlueprint,
  FinalPaperMarks,
  FinalParentSection,
  FinalQuestionDescriptor,
  FinalSectionBlueprint,
  FinalSectionKey,
  ModuleStats,
} from "@/types/hod";

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

// ─── Final-paper blueprint and marks normalisation ────────────────────────────

const FINAL_SECTION_KEYS: readonly FinalSectionKey[] = ["mcq", "essay", "practical"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normaliseFinalSection(raw: unknown): FinalSectionBlueprint {
  const source = Array.isArray(raw) ? { questions: raw } : asRecord(raw);
  let questionsRaw = Array.isArray(source.questions) ? source.questions : [];

  // Be liberal when reading early sectioned prototypes that stored the count
  // and a uniform maximum instead of explicit question descriptors.
  if (questionsRaw.length === 0) {
    const count = positiveInt(source.totalQuestions) ?? 0;
    const questionMarks = Array.isArray(source.questionMarks) ? source.questionMarks : [];
    const uniformMax = finiteNumber(source.marksPerQuestion, 0);
    questionsRaw = Array.from({ length: count }, (_, index) => ({
      id: `Q${index + 1}`,
      maxMarks: finiteNumber(questionMarks[index], uniformMax),
    }));
  }

  const questions: FinalQuestionDescriptor[] = questionsRaw.map((item, index) => {
    const question = asRecord(item);
    const id = typeof question.id === "string" && question.id.trim()
      ? question.id.trim()
      : `Q${index + 1}`;
    const questionMaxes = Array.isArray(source.questionMarks) ? source.questionMarks : [];
    const maxMarks = finiteNumber(
      question.maxMarks ?? question.maximumMarks ?? question.marks,
      finiteNumber(questionMaxes[index], finiteNumber(source.marksPerQuestion, 0))
    );
    return { id, maxMarks };
  });

  const requestedRequired = source.questionsToAnswer ?? source.requiredQuestions ?? source.requiredQuestionCount;
  const requiredValue = Number(requestedRequired);
  const questionsToAnswer = questions.length === 0
    ? 0
    : Number.isInteger(requiredValue) && requiredValue > 0
      ? Math.min(questions.length, requiredValue)
      : questions.length;

  return { questions, questionsToAnswer };
}

/**
 * Upgrade both the sectioned blueprint and the former flat Q1…Qn blueprint to
 * one canonical shape. Legacy questions are assigned to Theory → Essay.
 */
export function normaliseFinalBlueprint(raw: unknown, legacyTemplate?: unknown): FinalBlueprint {
  const source = asRecord(raw);
  const template = Array.isArray(legacyTemplate) ? legacyTemplate.map(asRecord) : [];
  const templateHasQuestion = template.length > 0;
  const sections = asRecord(source.sections);
  const theorySource = asRecord(source.theory ?? sections.theory);
  const structured =
    source.theory !== undefined || source.practical !== undefined || source.sections !== undefined ||
    source.mcq !== undefined || source.essay !== undefined;

  if (structured) {
    const mcq = theorySource.mcq ?? theorySource.MCQ ?? source.mcq;
    const essay = theorySource.essay ?? theorySource.Essay ?? source.essay;
    const practical = source.practical ?? sections.practical;
    return {
      enabled: source.enabled === true,
      weightage: finiteNumber(source.weightage, 0),
      theory: {
        mcq: normaliseFinalSection(mcq),
        essay: normaliseFinalSection(essay),
      },
      practical: normaliseFinalSection(practical),
    };
  }

  const legacyCount = positiveInt(source.totalQuestions) ?? (templateHasQuestion ? template.length : 0);
  const legacyPerQuestion = finiteNumber(source.marksPerQuestion, 0);
  const legacyQuestionMarks = Array.isArray(source.questionMarks) ? source.questionMarks : [];
  const essayQuestions: FinalQuestionDescriptor[] = Array.from({ length: legacyCount }, (_, index) => {
    const templateQuestion = template.find(question => question.id === `Q${index + 1}`) ?? template[index];
    return {
      id: `Q${index + 1}`,
      maxMarks: finiteNumber(
        templateQuestion?.maxMarks,
        finiteNumber(legacyQuestionMarks[index], legacyPerQuestion)
      ),
    };
  });
  const legacyRequired = positiveInt(source.questionsToAnswer) ?? legacyCount;
  const essay: FinalSectionBlueprint = {
    questions: essayQuestions,
    questionsToAnswer: essayQuestions.length === 0
      ? 0
      : Math.min(essayQuestions.length, legacyRequired),
  };

  return {
    enabled: source.enabled === true,
    weightage: finiteNumber(source.weightage, 0),
    theory: {
      mcq: { questions: [], questionsToAnswer: 0 },
      essay,
    },
    practical: { questions: [], questionsToAnswer: 0 },
  };
}

export interface FinalPaperSectionInfo {
  key: FinalSectionKey;
  parent: FinalParentSection;
  label: string;
  blueprint: FinalSectionBlueprint;
}

export function getFinalPaperSections(blueprint: FinalBlueprint): FinalPaperSectionInfo[] {
  return [
    { key: "mcq", parent: "theory", label: "Theory · MCQ", blueprint: blueprint.theory.mcq },
    { key: "essay", parent: "theory", label: "Theory · Essay", blueprint: blueprint.theory.essay },
    { key: "practical", parent: "practical", label: "Practical", blueprint: blueprint.practical },
  ];
}

export function getFinalSectionBlueprint(
  blueprint: FinalBlueprint,
  key: FinalSectionKey
): FinalSectionBlueprint {
  return key === "practical" ? blueprint.practical : blueprint.theory[key];
}

export function getFinalSectionParent(key: FinalSectionKey): FinalParentSection {
  return key === "practical" ? "practical" : "theory";
}

export function finalSectionQuestionMax(section: FinalSectionBlueprint, questionId: string): number {
  return finiteNumber(section.questions.find(question => question.id === questionId)?.maxMarks, 0);
}

export function finalSectionRequiredCount(section: FinalSectionBlueprint): number {
  const count = section.questions.length;
  if (count === 0) return 0;
  const required = positiveInt(section.questionsToAnswer);
  return required ? Math.min(count, required) : count;
}

/** Maximum marks required from a section (sum of the first required questions). */
export function finalSectionMaxScore(section: FinalSectionBlueprint): number {
  return section.questions
    .slice(0, finalSectionRequiredCount(section))
    .reduce((sum, question) => sum + Math.max(0, finiteNumber(question.maxMarks, 0)), 0);
}

export function finalMaxScore(blueprint?: FinalBlueprint | null): number {
  if (!blueprint) return 0;
  const normalised = normaliseFinalBlueprint(blueprint);
  return getFinalPaperSections(normalised)
    .reduce((sum, section) => sum + finalSectionMaxScore(section.blueprint), 0);
}

export function finalSectionWeightage(blueprint: FinalBlueprint, key: FinalSectionKey): number {
  const totalMax = finalMaxScore(blueprint);
  if (totalMax <= 0) return 0;
  return (finalSectionMaxScore(getFinalSectionBlueprint(blueprint, key)) / totalMax)
    * (Number(blueprint.weightage) || 0);
}

export function buildFinalExamTemplate(blueprint: FinalBlueprint): {
  id: string;
  maxMarks: number;
  section: FinalSectionKey;
  parent: FinalParentSection;
}[] {
  return getFinalPaperSections(blueprint).flatMap(({ key, parent, blueprint: section }) =>
    section.questions.map(question => ({
      id: question.id,
      maxMarks: question.maxMarks,
      section: key,
      parent,
    }))
  );
}

export interface FinalAbsenceState {
  isAbsentTheory: boolean;
  isAbsentPractical: boolean;
  isAbsentFinal: boolean;
}

/** Legacy isAbsentFinal=true means both parents are absent unless new flags exist. */
export function normaliseFinalAbsence(row: {
  isAbsentTheory?: boolean | null;
  isAbsentPractical?: boolean | null;
  isAbsentFinal?: boolean | null;
} | null | undefined): FinalAbsenceState {
  const hasParentFlags = (row?.isAbsentTheory !== undefined && row?.isAbsentTheory !== null)
    || (row?.isAbsentPractical !== undefined && row?.isAbsentPractical !== null);
  const legacyAbsent = row?.isAbsentFinal === true;
  // After schema sync old whole-paper absence rows may have new columns at the
  // default false value. Preserve that legacy meaning until either parent is
  // explicitly marked absent/present by the new workflow.
  const legacyWholePaperAbsent = legacyAbsent
    && row?.isAbsentTheory !== true
    && row?.isAbsentPractical !== true;
  const isAbsentTheory = legacyWholePaperAbsent || (hasParentFlags
    ? row?.isAbsentTheory === true
    : legacyAbsent);
  const isAbsentPractical = legacyWholePaperAbsent || (hasParentFlags
    ? row?.isAbsentPractical === true
    : legacyAbsent);
  return {
    isAbsentTheory,
    isAbsentPractical,
    isAbsentFinal: isAbsentTheory && isAbsentPractical,
  };
}

export function isFinalParentAbsent(
  row: { isAbsentTheory?: boolean | null; isAbsentPractical?: boolean | null; isAbsentFinal?: boolean | null },
  parent: FinalParentSection
): boolean {
  const absence = normaliseFinalAbsence(row);
  return parent === "theory" ? absence.isAbsentTheory : absence.isAbsentPractical;
}

export function getFinalSectionMarks(marks: unknown, key: FinalSectionKey): Record<string, unknown> {
  const source = asRecord(marks);
  const theory = asRecord(source.theory);
  const section = key === "practical" ? source.practical : theory[key] ?? source[key];
  const sectionRecord = asRecord(section);
  if (sectionRecord.marks && typeof sectionRecord.marks === "object") return asRecord(sectionRecord.marks);
  if (sectionRecord.questions && typeof sectionRecord.questions === "object" && !Array.isArray(sectionRecord.questions)) {
    return asRecord(sectionRecord.questions);
  }
  return sectionRecord;
}

/**
 * Convert old flat Q1…Qn marks to the Essay section, even after the blueprint
 * itself has already been upgraded and no longer has legacy top-level fields.
 */
export function normaliseFinalMarks(marks: unknown, blueprintInput: unknown): FinalPaperMarks {
  const blueprint = normaliseFinalBlueprint(blueprintInput);
  const source = asRecord(marks);
  const theory = asRecord(source.theory);
  const hasSectionedMarks = source.theory !== undefined || source.practical !== undefined
    || source.mcq !== undefined || source.essay !== undefined;

  const rawMcq = hasSectionedMarks ? (theory.mcq ?? source.mcq) : {};
  const rawEssay = hasSectionedMarks ? (theory.essay ?? source.essay) : source;
  const rawPractical = hasSectionedMarks ? source.practical : {};

  const maximaFor = (section: FinalSectionBlueprint): Record<string, number> =>
    Object.fromEntries(section.questions.map(question => [question.id, question.maxMarks]));

  return {
    theory: {
      mcq: sanitiseQuestionMap(rawMcq, maximaFor(blueprint.theory.mcq)),
      essay: sanitiseQuestionMap(rawEssay, maximaFor(blueprint.theory.essay)),
    },
    practical: sanitiseQuestionMap(rawPractical, maximaFor(blueprint.practical)),
  };
}

export function normaliseFinalMarkRow(row: MarkRowLike, blueprintInput: unknown): {
  finalExamQuestionsMarks: FinalPaperMarks;
  secondExamMarks: FinalPaperMarks;
} & FinalAbsenceState {
  const blueprint = normaliseFinalBlueprint(blueprintInput);
  return {
    finalExamQuestionsMarks: normaliseFinalMarks(row.finalExamQuestionsMarks, blueprint),
    secondExamMarks: normaliseFinalMarks(row.secondExamMarks, blueprint),
    ...normaliseFinalAbsence(row),
  };
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
  /** Structured section marks, or a legacy flat Q1…Qn map before normalisation. */
  finalExamQuestionsMarks?: unknown;
  secondExamMarks?: unknown;
  isAbsentCa?: Record<string, boolean> | null;
  isAbsentTheory?: boolean | null;
  isAbsentPractical?: boolean | null;
  /** Compatibility summary for old stored rows and integrations. */
  isAbsentFinal?: boolean | null;
  /** Cohort eligibility — rows without the flag (pre-migration) count as eligible. */
  isEligible?: boolean | null;
}

/**
 * Whether a roster row counts towards the marksheet. Ineligible students stay
 * visible on the grid but are excluded from completeness audits, weighted
 * totals, CSV and PDF exports.
 */
export function isRowEligible(row: Pick<MarkRowLike, "isEligible"> | null | undefined): boolean {
  return row?.isEligible !== false;
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
export function toFiniteNumber(value: unknown): number | null {
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

export function hasAnyMark(marks?: unknown): boolean {
  if (!marks || typeof marks !== "object" || Array.isArray(marks)) return false;
  const source = marks as Record<string, unknown>;
  if (enteredMarks(source).length > 0) return true;
  return Object.values(source).some(value =>
    !!value && typeof value === "object" && hasAnyMark(value)
  );
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

export interface FinalPaperTotals {
  /** Raw totals per question section, before absence is applied. */
  sectionRaw: Record<FinalSectionKey, number>;
  sectionMax: Record<FinalSectionKey, number>;
  sectionWeighted: Record<FinalSectionKey, number>;
  /** Raw sum from sections the student attended. */
  rawTotal: number;
  maxTotal: number;
  /** Weighted Final Paper contribution, out of the overall blueprint weightage. */
  weighted: number;
}

/** Raw score for the required questions of one final-paper section. */
export function computeFinalSectionTotal(
  marks: unknown,
  section: FinalSectionBlueprint
): number {
  return section.questions
    .slice(0, finalSectionRequiredCount(section))
    .reduce((sum, question) => {
      const value = toFiniteNumber(asRecord(marks)[question.id]);
      if (value === null) return sum;
      const max = Math.max(0, finiteNumber(question.maxMarks, 0));
      return sum + Math.min(max > 0 ? max : value, Math.max(0, value));
    }, 0);
}

/**
 * Final-paper raw and weighted totals. Each section gets a share of the single
 * Final Paper weightage proportional to its required maximum marks. Thus the
 * weighted result is equivalent to scoring the whole paper out of its combined
 * configured maximum, while making the MCQ / Essay / Practical shares explicit.
 */
export function computeFinalPaperTotals(
  row: MarkRowLike,
  blueprintInput?: FinalBlueprint | null,
  marksInput?: unknown
): FinalPaperTotals {
  const blueprint = normaliseFinalBlueprint(blueprintInput);
  const marks = normaliseFinalMarks(
    marksInput === undefined ? row.finalExamQuestionsMarks : marksInput,
    blueprint
  );
  const absence = normaliseFinalAbsence(row);
  const sectionRaw = {} as Record<FinalSectionKey, number>;
  const sectionMax = {} as Record<FinalSectionKey, number>;
  const sectionWeighted = {} as Record<FinalSectionKey, number>;
  const sectionBlueprints: Record<FinalSectionKey, FinalSectionBlueprint> = {
    mcq: blueprint.theory.mcq,
    essay: blueprint.theory.essay,
    practical: blueprint.practical,
  };
  const parentAbsent: Record<FinalSectionKey, boolean> = {
    mcq: absence.isAbsentTheory,
    essay: absence.isAbsentTheory,
    practical: absence.isAbsentPractical,
  };
  const totalMax = getFinalPaperSections(blueprint)
    .reduce((sum, section) => sum + finalSectionMaxScore(section.blueprint), 0);
  let rawTotal = 0;
  let weighted = 0;

  for (const key of FINAL_SECTION_KEYS) {
    const section = sectionBlueprints[key];
    const max = finalSectionMaxScore(section);
    const raw = computeFinalSectionTotal(getFinalSectionMarks(marks, key), section);
    const contributionMax = totalMax > 0
      ? (max / totalMax) * (Number(blueprint.weightage) || 0)
      : 0;
    const contribution = !parentAbsent[key] && max > 0
      ? (Math.min(Math.max(raw, 0), max) / max) * contributionMax
      : 0;

    sectionRaw[key] = round1(raw);
    sectionMax[key] = round1(max);
    sectionWeighted[key] = round1(contribution);
    if (!parentAbsent[key]) rawTotal += raw;
    weighted += contribution;
  }

  return {
    sectionRaw,
    sectionMax,
    sectionWeighted,
    rawTotal: round1(rawTotal),
    maxTotal: round1(totalMax),
    weighted: round1(weighted),
  };
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
    const blueprint = normaliseFinalBlueprint(finalBlueprint);
    finalMax = Number(blueprint.weightage) || 0;
    final = computeFinalPaperTotals(row, blueprint).weighted;
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

  if (finalBlueprint?.enabled) {
    const blueprint = normaliseFinalBlueprint(finalBlueprint);
    const marks = normaliseFinalMarks(row.finalExamQuestionsMarks, blueprint);
    const absence = normaliseFinalAbsence(row);
    for (const section of getFinalPaperSections(blueprint)) {
      if (section.parent === "theory" ? absence.isAbsentTheory : absence.isAbsentPractical) continue;
      const requiredQuestions = section.blueprint.questions.slice(0, finalSectionRequiredCount(section.blueprint));
      required += requiredQuestions.length;
      const sectionMarks = getFinalSectionMarks(marks, section.key);
      filled += requiredQuestions.filter(question => toFiniteNumber(sectionMarks[question.id]) !== null).length;
    }
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
  const finalBp = normaliseFinalBlueprint(finalBlueprint);

  // ── Module-level structure ────────────────────────────────────────────────
  if (rows.length === 0) {
    issues.push({ level: "error", message: "No students have been added to this marksheet." });
  }
  if (comps.length === 0 && !finalBp.enabled) {
    issues.push({ level: "error", message: "The blueprint is empty — define CA components or enable the final paper first." });
  }

  const caWeight = comps.reduce((sum, c) => sum + (Number(c.weightage) || 0), 0);
  const finalWeight = finalBp.enabled ? Number(finalBp.weightage) || 0 : 0;
  if (comps.length > 0 || finalBp.enabled) {
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

  if (finalBp.enabled) {
    const configuredQuestions = getFinalPaperSections(finalBp)
      .reduce((sum, section) => sum + section.blueprint.questions.length, 0);
    if (configuredQuestions === 0) {
      issues.push({ level: "error", message: "Final paper: add at least one question to MCQ, Essay, or Practical." });
    }
    for (const section of getFinalPaperSections(finalBp)) {
      const { blueprint, label } = section;
      const required = finalSectionRequiredCount(blueprint);
      if (blueprint.questions.length > 50) {
        issues.push({ level: "error", message: `${label}: no more than 50 questions can be configured.` });
      }
      if (blueprint.questions.length > 0 && (required < 1 || required > blueprint.questions.length)) {
        issues.push({ level: "error", message: `${label}: required question count must be between 1 and the configured question count.` });
      }
      const seenQuestionIds = new Set<string>();
      for (const question of blueprint.questions) {
        if (!question.id.trim() || seenQuestionIds.has(question.id)) {
          issues.push({ level: "error", message: `${label}: question IDs must be present and unique.` });
          break;
        }
        seenQuestionIds.add(question.id);
        if (!(Number(question.maxMarks) > 0)) {
          issues.push({ level: "error", message: `${label} ${question.id}: maximum marks must be greater than 0.` });
        }
      }
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
  // Ineligible students are outside the authorised cohort: their blanks must
  // not block submission, so they are skipped by the coverage audit entirely.
  for (const row of rows) {
    if (!isRowEligible(row)) continue;
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

    if (finalBp.enabled) {
      const absence = normaliseFinalAbsence(row);
      const rawFinalMarks = asRecord(row.finalExamQuestionsMarks);
      const hasSectionedMarks = rawFinalMarks.theory !== undefined
        || rawFinalMarks.practical !== undefined
        || rawFinalMarks.mcq !== undefined
        || rawFinalMarks.essay !== undefined;
      const normalisedMarks = normaliseFinalMarks(rawFinalMarks, finalBp);

      for (const section of getFinalPaperSections(finalBp)) {
        const absent = section.parent === "theory" ? absence.isAbsentTheory : absence.isAbsentPractical;
        if (absent) continue;

        const requiredQuestions = section.blueprint.questions
          .slice(0, finalSectionRequiredCount(section.blueprint));
        const marksForCoverage = getFinalSectionMarks(normalisedMarks, section.key);
        const enteredRequired = requiredQuestions.filter(question =>
          toFiniteNumber(marksForCoverage[question.id]) !== null
        ).length;
        if (enteredRequired < requiredQuestions.length) {
          issues.push({
            level: "error",
            studentIndex: index,
            message: `${index}: ${section.label} — ${enteredRequired} of ${requiredQuestions.length} required marks recorded.`,
          });
        }

        const rawSectionMarks = hasSectionedMarks
          ? getFinalSectionMarks(rawFinalMarks, section.key)
          : section.key === "essay" ? rawFinalMarks : {};
        for (const question of section.blueprint.questions) {
          const value = toFiniteNumber(rawSectionMarks[question.id]);
          const max = Number(question.maxMarks) || 0;
          if (value !== null && (value < 0 || (max > 0 && value > max))) {
            issues.push({
              level: "error",
              studentIndex: index,
              message: `${index}: ${section.label} ${question.id} is ${value} — must be between 0 and ${max}.`,
            });
          }
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

  const theory = asRecord(bp.theory);
  const structured = bp.theory !== undefined || bp.practical !== undefined || bp.sections !== undefined
    || bp.mcq !== undefined || bp.essay !== undefined;
  if (structured) {
    const sectionInputs: { key: FinalSectionKey; label: string; value: unknown }[] = [
      { key: "mcq", label: "Theory · MCQ", value: theory.mcq ?? bp.mcq },
      { key: "essay", label: "Theory · Essay", value: theory.essay ?? bp.essay },
      { key: "practical", label: "Practical", value: bp.practical ?? asRecord(bp.sections).practical },
    ];
    let configuredQuestionCount = 0;
    for (const sectionInput of sectionInputs) {
      const section = asRecord(sectionInput.value);
      const questions = Array.isArray(sectionInput.value)
        ? sectionInput.value
        : Array.isArray(section.questions) ? section.questions : null;
      if (questions === null) return `${sectionInput.label}: questions must be a list.`;
      if (questions.length > 50) return `${sectionInput.label}: no more than 50 questions can be configured.`;
      configuredQuestionCount += questions.length;

      const requiredValue = section.questionsToAnswer ?? section.requiredQuestions ?? section.requiredQuestionCount;
      if (questions.length === 0) {
        if (requiredValue !== undefined && Number(requiredValue) !== 0) {
          return `${sectionInput.label}: required question count must be 0 when no questions are configured.`;
        }
      } else if (!isPositiveInt(requiredValue) || Number(requiredValue) > questions.length) {
        return `${sectionInput.label}: required question count must be between 1 and ${questions.length}.`;
      }

      const ids = new Set<string>();
      for (let index = 0; index < questions.length; index++) {
        const question = questions[index] as Record<string, unknown>;
        if (!question || typeof question !== "object") {
          return `${sectionInput.label}: question ${index + 1} is invalid.`;
        }
        const id = typeof question.id === "string" ? question.id.trim() : "";
        if (!id) return `${sectionInput.label}: question ${index + 1} needs an ID.`;
        if (ids.has(id)) return `${sectionInput.label}: question IDs must be unique.`;
        ids.add(id);
        if (!isFiniteNumber(question.maxMarks) || Number(question.maxMarks) <= 0 || Number(question.maxMarks) > 1000) {
          return `${sectionInput.label} ${id}: maximum marks must be greater than 0 and no more than 1000.`;
        }
      }
    }
    if (bp.enabled && configuredQuestionCount === 0) {
      return "Add at least one question to MCQ, Essay, or Practical before enabling the final paper.";
    }
  } else {
    // Accept the previous flat blueprint while old clients are still in use.
    if (!isPositiveInt(bp.totalQuestions)) return "Final paper total questions must be a positive whole number.";
    if (!isPositiveInt(bp.marksPerQuestion)) return "Final paper marks per question must be a positive whole number.";
    if (!isPositiveInt(bp.questionsToAnswer)) return "Final paper questions to answer must be a positive whole number.";
    if (Number(bp.questionsToAnswer) > Number(bp.totalQuestions)) {
      return "Final paper questions to answer cannot exceed the total questions.";
    }
    if (bp.scoreMode !== "SUM" && bp.scoreMode !== "AVG") return "Final paper score mode must be SUM or AVG.";
  }

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
  finalExamQuestionsMarks: FinalPaperMarks;
  isAbsentCa: Record<string, boolean>;
  isAbsentTheory: boolean;
  isAbsentPractical: boolean;
  isAbsentFinal: boolean;
  /** Cohort eligibility — anything but an explicit `false` stays eligible. */
  isEligible: boolean;
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
  const rawFinal = raw.finalExamQuestionsMarks ?? {};
  const finalBp = normaliseFinalBlueprint(finalBlueprint);
  const absence = normaliseFinalAbsence(raw);

  const caQuestionsMarks: Record<string, Record<string, number>> = {};
  const isAbsentCa: Record<string, boolean> = {};

  for (const comp of caComponents ?? []) {
    isAbsentCa[comp.id] = rawAbsentCa[comp.id] === true;
    // Keep valid marks even while this component is marked absent. Clearing
    // absence in the register should reveal the marks that were already entered.
    const maxima: Record<string, number> = {};
    for (const key of componentQuestionKeys(comp)) maxima[key] = componentQuestionMax(comp, key);
    caQuestionsMarks[comp.id] = sanitiseQuestionMap(rawCa[comp.id], maxima);
  }

  // Absence changes the scoring treatment but never destroys entered marks.
  const finalExamQuestionsMarks = normaliseFinalMarks(rawFinal, finalBp);
  const isAbsentFinal = absence.isAbsentTheory && absence.isAbsentPractical;
  const isEligible = raw.isEligible !== false;

  return {
    studentIndex,
    caQuestionsMarks,
    finalExamQuestionsMarks,
    isAbsentCa,
    isAbsentTheory: absence.isAbsentTheory,
    isAbsentPractical: absence.isAbsentPractical,
    isAbsentFinal,
    isEligible,
  };
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
  const finalBp = normaliseFinalBlueprint(finalBlueprint);
  const finalSections = finalBp.enabled ? getFinalPaperSections(finalBp) : [];

  const header: string[] = ["Student Index"];
  for (const comp of comps) {
    const label = comp.name?.trim() || caTypeLabel(comp.type);
    for (const q of componentQuestionKeys(comp)) {
      header.push(componentGroup(comp) === "A" ? `${label} Mark` : `${label} ${q}`);
    }
    header.push(`${label} Total`, `${label} Max`, `${label} Absent`);
  }
  for (const section of finalSections) {
    for (const question of section.blueprint.questions) {
      header.push(`Final ${section.label} ${question.id}`);
    }
    header.push(`${section.label} Total`, `${section.label} Max`);
  }
  if (finalBp.enabled) {
    header.push("Theory Absent", "Practical Absent", "Final Raw Total", "Final Raw Max");
  }
  header.push("CA Weighted", "Final Weighted", "Module Mark (100)");

  const lines = [header.map(csvCell).join(",")];

  // Ineligible students are outside the authorised cohort — the export carries
  // only the rows that count towards the module result.
  for (const row of rows.filter(isRowEligible)) {
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

    const finalMarks = normaliseFinalMarks(row.finalExamQuestionsMarks, finalBp);
    const absence = normaliseFinalAbsence(row);
    for (const section of finalSections) {
      const absent = section.parent === "theory" ? absence.isAbsentTheory : absence.isAbsentPractical;
      const sectionMarks = getFinalSectionMarks(finalMarks, section.key);
      for (const question of section.blueprint.questions) {
        cells.push(absent ? "AB" : (toFiniteNumber(sectionMarks[question.id]) ?? ""));
      }
      cells.push(
        absent ? "AB" : round1(computeFinalSectionTotal(sectionMarks, section.blueprint)),
        round1(finalSectionMaxScore(section.blueprint))
      );
    }
    if (finalBp.enabled) {
      const finalTotals = computeFinalPaperTotals(row, finalBp, finalMarks);
      cells.push(
        absence.isAbsentTheory ? "YES" : "",
        absence.isAbsentPractical ? "YES" : "",
        finalTotals.rawTotal,
        finalTotals.maxTotal
      );
    }

    const weighted = computeWeightedScores(row, comps, finalBp);
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
