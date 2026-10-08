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

/** Final-paper sections use stable question IDs and an independent maximum per question. */
export type FinalSectionKey = "mcq" | "essay" | "practical";
export type FinalParentSection = "theory" | "practical";

export interface FinalQuestionDescriptor {
  id: string;      // "Q1", "Q2", ... (unique within its section)
  maxMarks: number;
}

export interface FinalSectionBlueprint {
  questions: FinalQuestionDescriptor[];
  /** First N questions are required; MCQ always requires every configured question. */
  questionsToAnswer: number;
}

/**
 * Final-paper blueprint. Theory contains MCQ and Essay sections; Practical is
 * a separate parent section. The paper has one overall weightage. A section's
 * share of that weight is proportional to its required maximum marks.
 */
export interface FinalBlueprint {
  enabled: boolean;
  weightage: number;         // % (contributes to 100% total with CA components)
  theory: {
    mcq: FinalSectionBlueprint;
    essay: FinalSectionBlueprint;
  };
  practical: FinalSectionBlueprint;
}

/** Marks for each question in the sectioned final paper. */
export interface FinalPaperMarks {
  theory: {
    mcq: Record<string, number>;
    essay: Record<string, number>;
  };
  practical: Record<string, number>;
}

/** Auto-generated examiner template, tagged by the section that owns the question. */
export interface ExamQuestionConfig {
  id: string;
  maxMarks: number;
  section: FinalSectionKey;
  parent: FinalParentSection;
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
  /** Cohort size authorised by the HOD for this module. */
  eligibleStudents: number;
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
  /** Active Lecturer's final-paper marks, grouped by section. */
  finalExamQuestionsMarks: FinalPaperMarks;
  /** Second Examiner's independent final-paper marks, grouped by section. */
  secondExamMarks: FinalPaperMarks;
  isAbsentCa: Record<string, boolean>;
  /** Absence is recorded at the paper-parent level; Theory covers MCQ and Essay. */
  isAbsentTheory: boolean;
  isAbsentPractical: boolean;
  /** Compatibility summary: true only when both Theory and Practical are absent. */
  isAbsentFinal: boolean;
  /**
   * Cohort eligibility. Defaults to true (the HOD authorises the cohort when
   * the module is created); rows before the column existed are treated as
   * eligible, so this stays optional.
   */
  isEligible?: boolean;
}