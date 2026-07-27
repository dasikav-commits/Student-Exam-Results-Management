// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types for the Wayamba Exam Portal
// ─────────────────────────────────────────────────────────────────────────────

/** A single CA component in a module's blueprint */
export interface CaComponent {
  id: string;
  type: string;              // e.g. "QUIZ", "ASSIGNMENT", "MIDTERM"
  name: string;
  weightage: number;         // % (contributes to 100% total with finalBlueprint)
  totalQuestions: number;
  marksPerQuestion: number;
  questionsToAnswer: number; // must be <= totalQuestions
  scoreMode: "SUM" | "AVG";
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
export type MarksheetStatus = "DRAFT" | "MARKING" | "SECOND_CHECKING" | "FINALIZED";

export interface ModuleStats {
  caComponents?: CaComponent[];
  finalBlueprint?: FinalBlueprint;
  examTemplate?: ExamQuestionConfig[];
  caCompletionRate?: number;
  marksheetStatus?: MarksheetStatus;
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
}