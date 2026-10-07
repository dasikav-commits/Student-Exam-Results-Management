// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types for the Wayamba Exam Portal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CA components come in two structural flavours, decided by their type:
 *
 *  • GROUP A — practical / performance work (PROJECT, PRESENTATION, LAB_REPORT).
 *    Scored as one mark for the whole component, out of `totalMarks`.
 *
 *  • GROUP B — written / discrete assessments (QUIZ, ASSIGNMENT, MIDTERM, TUTORIAL).
 *    Scored question by question, where every question carries its own weightage
 *    (marks) in `questionMarks`, aligned to Q1…Qn.
 *
 * The group is derived from `type` (see `caGroupOf` in @/lib/lecturer-marks) and
 * mirrored onto the stored object so a component keeps its scoring shape even if
 * its type is later re-labelled.
 */
export type CaGroup = "A" | "B";

/** A single CA component in a module's blueprint */
export interface CaComponent {
  id: string;
  type: string;              // e.g. "QUIZ", "PROJECT", "LAB_REPORT"
  name: string;
  weightage: number;         // % (contributes to 100% total with finalBlueprint)
  scoreMode: "SUM" | "AVG";
  /** Scoring shape — always written by the Lecturer Desk. */
  group?: CaGroup;

  // ── Group A fields ────────────────────────────────────────────────────────
  /** Total marks obtainable for the whole component (e.g. 100). */
  totalMarks?: number;

  // ── Group B fields ────────────────────────────────────────────────────────
  /** Number of questions on the paper. */
  totalQuestions?: number;
  /** Per-question weightage (marks), index 0 → Q1. Length matches totalQuestions. */
  questionMarks?: number[];

  // ── Derived / legacy (kept so older stored blueprints keep working) ───────
  /** Derived: the highest per-question weightage (Group B) or totalMarks (Group A). */
  marksPerQuestion?: number;
  /** Derived: how many answers the student must provide (Group A → 1). */
  questionsToAnswer?: number;
}

/** Final exam blueprint block */
export interface FinalBlueprint {
  enabled: boolean;
  weightage: number;         // % (contributes to 100% total with CA components)
  totalQuestions: number;
  marksPerQuestion: number;
  questionsToAnswer: number;
  scoreMode: "SUM" | "AVG";
}

/** Auto-generated exam template from finalBlueprint.totalQuestions */
export interface ExamQuestionConfig {
  id: string;      // "Q1", "Q2", ...
  maxMarks: number;
}

/** Parsed Module.stats shape */
export type MarksheetStatus =
  | "DRAFT"
  | "MARKING"
  | "SECOND_CHECKING"
  | "FINALIZED"
  | "RECONCILIATION_NEEDED"
  | "RECONCILED";

export interface ModuleStats {
  caComponents?: CaComponent[];
  finalBlueprint?: FinalBlueprint;
  examTemplate?: ExamQuestionConfig[];
  caCompletionRate?: number;
  marksheetStatus?: MarksheetStatus;
  // ── Workflow bookkeeping written by the desks (free-form JSON column) ──────
  /** Active Lecturer approved the Examiner's assessment after a variance. */
  lecturerApproved?: boolean;
  lecturerApprovedAt?: string;
  /** Set when the lecturer submits the marksheet for second checking. */
  submittedAt?: string;
  /** Who the submitted marksheet was addressed to (same submit, two addressees). */
  submittedTo?: "FACULTY" | "HOD";
  /** Set when the lecturer recalls a submission back to MARKING. */
  recalledAt?: string;
  recallCount?: number;
  marksheetStartedAt?: string;
  blueprintUpdatedAt?: string;
  varianceThreshold?: number;
  reconciliationRequestedAt?: string;
  reconciledAt?: string;
}

/** Full module row returned from API */
export interface DepartmentModule {
  id: number;
  code: string;
  name: string;
  credits: number;
  isFrozen: boolean;
  activeLecturerId?: number | null;
  examLecturerId?: number | null;
  assignedActiveLec?: { id: number; fullName: string } | null;
  assignedExamLec?: { id: number; fullName: string } | null;
  stats: ModuleStats;
  roleInModule?: "LECTURER" | "EXAMINER";
  isExaminerViewOnly?: boolean;
}

export type LecturerModule = DepartmentModule;

/** Lecturer roster item from /api/hod/lecturers */
export interface DepartmentLecturer {
  id: number;
  fullName: string;
  email: string;
  isHod: boolean;
  isActiveLec: boolean;
  isExamLec: boolean;
  activeModules: string[];
  examModules: string[];
}

/** Student mark row stored in DB */
export interface StudentMarkRecord {
  id: number;
  moduleCode: string;
  studentIndex: string;
  caQuestionsMarks: Record<string, Record<string, number>>;
  /** Active Lecturer's final exam per-question marks */
  finalExamQuestionsMarks: Record<string, number>;
  /** Second Examiner's independent final exam per-question marks */
  secondExamMarks: Record<string, number>;
  isAbsentCa: Record<string, boolean>;
  isAbsentFinal: boolean;
  /**
   * Cohort eligibility. Defaults to true (the HOD authorises the cohort when
   * the module is created); rows before the column existed are treated as
   * eligible, so this stays optional.
   */
  isEligible?: boolean;
}