"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { ProfileSettingsDrawer } from "@/components/ProfileSettingsDrawer";
import { ConfirmDialog, type ConfirmTone } from "@/components/lecturer/ConfirmDialog";
import { MarksheetSummary, type MarksheetSummaryRow } from "@/components/lecturer/MarksheetSummary";
import { ComponentMarksDialog } from "@/components/lecturer/ComponentMarksDialog";
import { openCaGridPrintWindow } from "@/lib/ca-print";
import {
  BookOpen, Plus, Trash2, Save, Loader2, AlertCircle, CheckCircle2,
  Lock, Sliders, UserPlus, FileText,
  ChevronDown, Key, Flame, Shield, ClipboardList,
  BarChart2, Settings, ArrowLeftRight, ShieldOff, GitMerge, Bell,
  User, LogOut, Search, Download, ClipboardPaste, RotateCcw, Undo2,
  TriangleAlert, Info, Table2, X, Send, ArrowDownToLine,
  Pencil, Check, Printer, Maximize2, GraduationCap, Building2,
} from "lucide-react";
import type { CaComponent, CaGroup, DepartmentModule, FinalBlueprint, ModuleStats, StudentMarkRecord } from "@/types/hod";
import {
  CA_GROUP_A_TYPES,
  CA_GROUP_B_TYPES,
  CA_GROUP_META,
  CA_TYPES_BY_GROUP,
  VARIANCE_THRESHOLD,
  blockingIssues,
  buildMarksheetCsv,
  caGroupOf,
  caTypeLabel,
  componentQuestionCount,
  componentQuestionKeys,
  componentQuestionMax,
  componentRawTotal,
  componentRequiredAnswers,
  computeRowProgress,
  computeRowTotal,
  computeWeightedScores,
  downloadCsv,
  enteredMarks,
  isLecturerLocked,
  isRowEligible,
  normaliseCaComponent,
  normaliseCaComponents,
  questionKeys,
  statusBadgeClass,
  statusLabel,
  validateBlueprintInput,
  validateMarksheet,
  type MarksheetIssue,
} from "@/lib/lecturer-marks";

// ─── Local state types ────────────────────────────────────────────────────────
type MainTab = "blueprint" | "marks";
type BlueprintSubTab = "ca" | "final";
type MarksSubTab = "ca_marks" | "final_marks";

interface ConfirmState {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  tone: ConfirmTone;
  action: () => void | Promise<void>;
}

const EMPTY_BLUEPRINT: FinalBlueprint = {
  enabled: false, weightage: 0, totalQuestions: 5,
  marksPerQuestion: 20, questionsToAnswer: 5, scoreMode: "SUM",
};

const SCORE_MODES: { value: "SUM" | "AVG"; label: string }[] = [
  { value: "SUM", label: "Direct Sum (Σ)" },
  { value: "AVG", label: "Average (μ)" },
];

/**
 * CA blueprints come in two shapes (see @/types/hod):
 *   Group A — practical/performance work: one mark per student.
 *   Group B — written assessments: one mark per question, each with its own weightage.
 */
const GROUP_A_PREVIEW: readonly string[] = CA_GROUP_A_TYPES.slice(0, 3);
const GROUP_B_PREVIEW: readonly string[] = CA_GROUP_B_TYPES.slice(0, 4);

/** Index formats we accept as a student identifier. */
const INDEX_PATTERN = /^[A-Z0-9/\-]{3,20}$/;

/**
 * `Module.stats` is a free-form JSON column. Read it through one helper so the
 * workflow fields stay typed instead of being cast at every call site.
 */
function statsOf(mod?: DepartmentModule | null): ModuleStats {
  return mod?.stats ?? {};
}

function clampMark(value: number, max: number): number {
  const ceiling = Number.isFinite(max) && max > 0 ? max : Number.MAX_SAFE_INTEGER;
  return Math.min(ceiling, Math.max(0, value));
}

/** Excel / Sheets paste → grid of numbers (blank cells become null). */
function parseClipboardGrid(text: string): (number | null)[][] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line =>
      line.split("\t").map(cell => {
        const trimmed = cell.trim();
        if (!trimmed) return null;
        const value = Number(trimmed);
        return Number.isFinite(value) ? value : null;
      })
    );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function LecturerConsolePage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useRequireAuth();   // ← redirects to /login if no session
  const { logout } = useAuth();

  // Modules
  const [modules, setModules] = useState<DepartmentModule[]>([]);
  const [activeModule, setActiveModule] = useState<DepartmentModule | null>(null);

  // Blueprint state
  const [caComponents, setCaComponents] = useState<CaComponent[]>([]);
  const [finalBlueprint, setFinalBlueprint] = useState<FinalBlueprint>(EMPTY_BLUEPRINT);
  /** Last server-confirmed blueprint, used to flag structural edits. */
  const [savedBlueprint, setSavedBlueprint] = useState<{ ca: CaComponent[]; bp: FinalBlueprint } | null>(null);

  // Marks state
  const [students, setStudents] = useState<StudentMarkRecord[]>([]);
  /** Indexes present in the database for this module (deletions must persist). */
  const [persistedIndexes, setPersistedIndexes] = useState<string[]>([]);
  const [removedIndexes, setRemovedIndexes] = useState<string[]>([]);
  const [newIndexInput, setNewIndexInput] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // UI state
  const [mainTab, setMainTab] = useState<MainTab>("blueprint");
  const [bpTab, setBpTab] = useState<BlueprintSubTab>("ca");
  const [marksTab, setMarksTab] = useState<MarksSubTab>("ca_marks");
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isModulesLoading, setIsModulesLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApprovingReconciliation, setIsApprovingReconciliation] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isIssuesOpen, setIsIssuesOpen] = useState(false);
  /** Student indexes whose register row is unlocked for inline editing. */
  const [editingRows, setEditingRows] = useState<Set<string>>(new Set());
  /** Component whose drill-down marks popup is open (CA grid header click). */
  const [popupCompId, setPopupCompId] = useState<string | null>(null);
  const [isSendMenuOpen, setIsSendMenuOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [isConfirmBusy, setIsConfirmBusy] = useState(false);

  const userCapabilities = user?.capabilities ?? { isHOD: false, isActiveLec: true, isExamLec: false };
  // isActiveLec gate — pure examiners who land here see a locked-down view
  const isActiveLec = userCapabilities.isActiveLec;

  const activeStats = statsOf(activeModule);
  const activeStatus = activeStats.marksheetStatus;
  const isFrozen = activeModule?.isFrozen ?? false;
  /** Post-finalisation states close the lecturer's ledger entirely. */
  const isLockedByStatus = isLecturerLocked(activeStatus);
  const isReadOnly = isFrozen || isLockedByStatus;
  const isSecondChecking = activeStatus === "SECOND_CHECKING";
  const lecturerApproved = activeStats.lecturerApproved === true;
  const showComparison =
    activeStatus === "FINALIZED" || activeStatus === "RECONCILIATION_NEEDED" || activeStatus === "RECONCILED";
  const isReconciliationNeeded = activeStatus === "RECONCILIATION_NEEDED";

  const selectModule = useCallback(async (mod: DepartmentModule) => {
    setActiveModule(mod);
    setFeedback(null);
    setStudents([]);
    setPersistedIndexes([]);
    setRemovedIndexes([]);
    setIsDirty(false);
    setSearchTerm("");
    setIsBulkOpen(false);
    setBulkText("");
    setIsSummaryOpen(false);
    setIsIssuesOpen(false);
    setMainTab("blueprint");

    const stats = statsOf(mod);
    // Blueprints saved before the Group A / Group B split are upgraded here.
    const nextCa: CaComponent[] = normaliseCaComponents(stats.caComponents);
    const nextBp: FinalBlueprint = stats.finalBlueprint ?? EMPTY_BLUEPRINT;
    setCaComponents(nextCa);
    setFinalBlueprint(nextBp);
    setSavedBlueprint({ ca: nextCa, bp: nextBp });

    try {
      const r = await fetch(`/api/lecturer/marks?moduleCode=${encodeURIComponent(mod.code)}`);
      if (r.ok) {
        const rows: StudentMarkRecord[] = await r.json();
        setStudents(rows);
        setPersistedIndexes(rows.map(row => row.studentIndex));
      }
    } catch {}
  }, []);

  // ── Auth-guarded module fetch ───────────────────────────────────────────────
  useEffect(() => {
    const email = user?.email;
    if (!email) return;   // no session — useRequireAuth handles the redirect

    let cancelled = false;

    const loadModules = async () => {
      setIsModulesLoading(true);
      try {
        const res = await fetch(`/api/lecturer/modules?email=${encodeURIComponent(email)}`);
        if (!res.ok || cancelled) return;
        const data: DepartmentModule[] = await res.json();
        if (cancelled) return;
        setModules(data);
        if (data.length > 0) await selectModule(data[0]);
      } catch (err) {
        console.error("Error loading modules:", err);
      } finally {
        if (!cancelled) setIsModulesLoading(false);
      }
    };

    loadModules();
    return () => {
      cancelled = true;
    };
  }, [user?.email, selectModule]);

  // ── Unsaved-changes guard ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const handleWorkspaceSwitch = (desk: "LECTURER" | "HOD" | "EXAMINER") => {
    setIsRoleMenuOpen(false);
    if (desk === "HOD") router.push("/dashboard/hod");
    if (desk === "EXAMINER") router.push("/dashboard/examiner");
  };

  // ── Derived marksheet data ─────────────────────────────────────────────────
  const issues = useMemo(
    () => validateMarksheet(students, caComponents, finalBlueprint),
    [students, caComponents, finalBlueprint]
  );
  const errors = useMemo(() => blockingIssues(issues), [issues]);
  const warnings = useMemo(() => issues.filter(issue => issue.level === "warning"), [issues]);

  /** Student indexes that still have something to fix. */
  const problemIndexes = useMemo(
    () => new Set(issues.filter(issue => issue.studentIndex).map(issue => issue.studentIndex as string)),
    [issues]
  );

  const moduleIssues = useMemo(() => issues.filter(issue => !issue.studentIndex), [issues]);
  const studentIssueGroups = useMemo(() => {
    const groups = new Map<string, MarksheetIssue[]>();
    for (const issue of issues) {
      if (!issue.studentIndex) continue;
      const list = groups.get(issue.studentIndex) ?? [];
      list.push(issue);
      groups.set(issue.studentIndex, list);
    }
    return Array.from(groups.entries());
  }, [issues]);

  const errorCount = errors.length;
  const warningCount = warnings.length;

  const caWeightTotal = caComponents.reduce((sum, comp) => sum + (Number(comp.weightage) || 0), 0);
  const groupWeightTotal = (group: CaGroup) =>
    caComponents
      .filter(comp => (comp.group ?? caGroupOf(comp.type)) === group)
      .reduce((sum, comp) => sum + (Number(comp.weightage) || 0), 0);
  const grandWeightTotal = caWeightTotal + (Number(finalBlueprint.weightage) || 0);
  const blankBlueprint = caComponents.length === 0 && !finalBlueprint.enabled;

  const blueprintError = useMemo(
    () => (blankBlueprint ? null : validateBlueprintInput(caComponents, finalBlueprint)),
    [caComponents, finalBlueprint, blankBlueprint]
  );

  const isBlueprintDirty = useMemo(() => {
    if (!savedBlueprint) return false;
    return JSON.stringify(savedBlueprint.ca) !== JSON.stringify(caComponents)
      || JSON.stringify(savedBlueprint.bp) !== JSON.stringify(finalBlueprint);
  }, [savedBlueprint, caComponents, finalBlueprint]);

  const visibleStudents = useMemo(() => {
    const term = searchTerm.trim().toUpperCase();
    const withIndex = students.map((row, index) => ({ row, index }));
    if (!term) return withIndex;
    return withIndex.filter(({ row }) => row.studentIndex.toUpperCase().includes(term));
  }, [students, searchTerm]);

  const summaryRows: MarksheetSummaryRow[] = useMemo(
    () =>
      visibleStudents
        // Ineligible students sit outside the authorised cohort: they stay on
        // the register but never count towards averages or completion.
        .filter(({ row }) => isRowEligible(row))
        .map(({ row }) => {
        const weighted = computeWeightedScores(row, caComponents, finalBlueprint);
        const progress = computeRowProgress(row, caComponents, finalBlueprint);
        const lecTotal = computeRowTotal(row.finalExamQuestionsMarks, finalBlueprint.questionsToAnswer, finalBlueprint.scoreMode);
        const examTotalRaw = computeRowTotal(row.secondExamMarks, finalBlueprint.questionsToAnswer, finalBlueprint.scoreMode);
        const hasExamMarks = enteredMarks(row.secondExamMarks).length > 0;
        const variance = showComparison && !row.isAbsentFinal && hasExamMarks
          ? Math.abs(lecTotal - examTotalRaw)
          : null;
        return {
          studentIndex: row.studentIndex,
          ca: weighted.ca,
          final: weighted.final,
          total: weighted.total,
          caMax: weighted.caMax,
          finalMax: weighted.finalMax,
          progress: progress.percent,
          isAbsentFinal: row.isAbsentFinal,
          examTotal: hasExamMarks ? examTotalRaw : null,
          variance,
          varianceFlagged: variance !== null && variance > VARIANCE_THRESHOLD,
          issueCount: issues.filter(issue => issue.studentIndex === row.studentIndex).length,
        };
      }),
    [visibleStudents, caComponents, finalBlueprint, showComparison, issues]
  );

  /** Roster rows unticked as ineligible — excluded from totals and exports. */
  const ineligibleCount = useMemo(
    () => students.filter(row => !isRowEligible(row)).length,
    [students]
  );

  /** Component whose drill-down marks popup is currently open. */
  const popupComponent = caComponents.find(comp => comp.id === popupCompId) ?? null;

  // ── CA Component handlers ──────────────────────────────────────────────────
  /** Creates a blank component in the requested scoring group. */
  const addCA = (group: CaGroup) => {
    const type = CA_TYPES_BY_GROUP[group][0];
    const base = { id: crypto.randomUUID(), type, name: "", weightage: 0, scoreMode: "SUM" as const };
    const comp = group === "A"
      ? normaliseCaComponent({ ...base, totalMarks: 100 })
      : normaliseCaComponent({ ...base, totalQuestions: 3, questionMarks: [10, 10, 10] });
    setCaComponents(prev => [...prev, comp]);
  };

  const removeCA = (id: string) => {
    const comp = caComponents.find(c => c.id === id);
    const hasMarks = students.some(row => enteredMarks(row.caQuestionsMarks?.[id] ?? {}).length > 0);
    const label = comp?.name?.trim() || comp?.type || "this component";

    const doRemove = () => {
      setCaComponents(prev => prev.filter(c => c.id !== id));
      setFeedback({
        type: "info",
        text: `Removed ${label} from the blueprint. Save the blueprint to clear its recorded marks.`,
      });
    };

    if (hasMarks) {
      setConfirmState({
        title: "Remove component with recorded marks?",
        tone: "danger",
        confirmLabel: "Remove component",
        body: (
          <>
            <p>
              <strong>{label}</strong> already has marks captured for this module.
            </p>
            <p className="text-rose-600 font-semibold">
              Saving the blueprint will permanently discard those marks.
            </p>
          </>
        ),
        action: doRemove,
      });
      return;
    }

    doRemove();
  };

  const patchCA = (id: string, patch: Partial<CaComponent>) =>
    setCaComponents(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));

  const updateCA = <K extends keyof CaComponent,>(id: string, field: K, value: CaComponent[K]) =>
    patchCA(id, { [field]: value } as Partial<CaComponent>);

  /** Group A — the single mark the whole component is scored out of. */
  const updateCaTotalMarks = (id: string, raw: string) => {
    const value = Math.max(1, Math.floor(Number(raw) || 0));
    patchCA(id, {
      totalMarks: value,
      marksPerQuestion: value,
      questionMarks: [value],
      questionsToAnswer: 1,
    });
  };

  /**
   * Group B — changing "total questions" re-shapes the per-question weightage
   * rows, extending new rows with the last value the lecturer typed.
   */
  const updateCaTotalQuestions = (id: string, raw: string) => {
    setCaComponents(prev => prev.map(c => {
      if (c.id !== id) return c;
      const count = Math.max(1, Math.min(50, Math.floor(Number(raw) || 1)));
      const current = c.questionMarks ?? [];
      const seed = current[current.length - 1] ?? (Number(c.marksPerQuestion) || 10);
      const questionMarks = Array.from({ length: count }, (_, i) =>
        Number(current[i]) > 0 ? Number(current[i]) : seed
      );
      return { ...c, totalQuestions: count, questionMarks, questionsToAnswer: count };
    }));
  };

  /** Group B — the weightage (marks) carried by a single question. */
  const updateCaQuestionMark = (id: string, index: number, raw: string) => {
    setCaComponents(prev => prev.map(c => {
      if (c.id !== id) return c;
      const questionMarks = [...(c.questionMarks ?? [])];
      questionMarks[index] = Math.max(0, Number(raw) || 0);
      return { ...c, questionMarks, marksPerQuestion: Math.max(...questionMarks, 0) };
    }));
  };

  /** Spread the current value across every question of a Group B component. */
  const fillCaQuestionMarks = (id: string) => {
    setCaComponents(prev => prev.map(c => {
      if (c.id !== id) return c;
      const marks = c.questionMarks ?? [];
      const seed = marks[0] ?? 10;
      const filled = marks.map(() => seed);
      return { ...c, questionMarks: filled, marksPerQuestion: seed };
    }));
  };

  /**
   * Switching the type across groups re-shapes the component, carrying the
   * overall mark across so the lecturer does not lose their intention.
   */
  const changeCaType = (id: string, type: string) => {
    setCaComponents(prev => prev.map(c => {
      if (c.id !== id) return c;
      const nextGroup = caGroupOf(type);
      const currentGroup = c.group ?? caGroupOf(c.type);
      if (nextGroup === currentGroup) return { ...c, type };

      if (nextGroup === "A") {
        const totalMarks = componentRawTotal(c) || 100;
        return { ...c, type, group: "A", totalMarks, marksPerQuestion: totalMarks, questionMarks: [totalMarks], totalQuestions: 1, questionsToAnswer: 1 };
      }

      const count = Math.max(1, Math.floor(Number(c.totalQuestions) || 3));
      const total = c.totalMarks ?? componentRawTotal(c) ?? count * 10;
      const per = Math.max(1, Math.round(total / count));
      const questionMarks = Array.from({ length: count }, () => per);
      return { ...c, type, group: "B", totalQuestions: count, questionMarks, questionsToAnswer: count, marksPerQuestion: per, totalMarks: undefined };
    }));
  };

  // ── Blueprint Save ─────────────────────────────────────────────────────────
  const handleSaveBlueprint = async (): Promise<boolean> => {
    if (!activeModule) return false;
    if (blueprintError) {
      setFeedback({ type: "error", text: blueprintError });
      return false;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/lecturer/modules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleCode: activeModule.code, caComponents, finalBlueprint }),
      });
      const result = await res.json();
      if (res.ok) {
        const nextCa: CaComponent[] = result.stats?.caComponents
          ? normaliseCaComponents(result.stats.caComponents)
          : caComponents;
        const nextBp: FinalBlueprint = result.stats?.finalBlueprint ?? finalBlueprint;
        setCaComponents(nextCa);
        setFinalBlueprint(nextBp);
        setSavedBlueprint({ ca: nextCa, bp: nextBp });
        setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: result.stats } : m));
        setActiveModule(prev => prev ? { ...prev, stats: result.stats } : null);
        setFeedback({
          type: "success",
          text: result.orphanedMarksCleared
            ? `Blueprint saved. ${result.orphanedMarksCleared} student record(s) had marks from deleted components cleared.`
            : "Blueprint saved successfully.",
        });
        return true;
      }
      setFeedback({ type: "error", text: result.error ?? "Failed to save blueprint." });
      return false;
    } catch {
      setFeedback({ type: "error", text: "Network error. Please try again." });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // ── Student roster helpers ─────────────────────────────────────────────────
  const mutateStudents = (updater: (prev: StudentMarkRecord[]) => StudentMarkRecord[]) => {
    setStudents(prev => updater(prev));
    setIsDirty(true);
  };

  const normaliseIndex = (raw: string) => raw.trim().toUpperCase();

  const addStudent = (raw?: string) => {
    const idx = normaliseIndex(raw ?? newIndexInput);
    if (!idx) return;

    if (!INDEX_PATTERN.test(idx)) {
      setFeedback({ type: "error", text: `"${idx}" is not a valid student index (letters, digits, - and / only).` });
      return;
    }
    if (removedIndexes.includes(idx)) {
      // Restoring a pending removal is cheaper than re-creating the row.
      setRemovedIndexes(prev => prev.filter(item => item !== idx));
      setNewIndexInput("");
      setFeedback({ type: "info", text: `${idx} restored to the marksheet.` });
      return;
    }
    if (students.some(row => row.studentIndex === idx)) {
      setFeedback({ type: "error", text: `${idx} is already on this marksheet.` });
      return;
    }

    mutateStudents(prev => [...prev, {
      id: 0, moduleCode: activeModule?.code ?? "",
      studentIndex: idx,
      caQuestionsMarks: {}, finalExamQuestionsMarks: {},
      secondExamMarks: {},
      isAbsentCa: {}, isAbsentFinal: false,
      // The HOD authorised the cohort when the module was created, so a newly
      // added student starts eligible; the lecturer unticks exceptions.
      isEligible: true,
    }]);
    setNewIndexInput("");
    setFeedback(null);
  };

  const handleBulkAdd = () => {
    const tokens = bulkText
      .split(/[\s,;]+/)
      .map(normaliseIndex)
      .filter(token => token.length > 0);

    if (tokens.length === 0) {
      setFeedback({ type: "error", text: "Paste at least one student index." });
      return;
    }

    const existing = new Set(students.map(row => row.studentIndex));
    const added: StudentMarkRecord[] = [];
    const rejected: string[] = [];
    const duplicates: string[] = [];

    for (const token of tokens) {
      if (!INDEX_PATTERN.test(token)) { rejected.push(token); continue; }
      if (existing.has(token)) { duplicates.push(token); continue; }
      existing.add(token);
      added.push({
        id: 0, moduleCode: activeModule?.code ?? "",
        studentIndex: token,
        caQuestionsMarks: {}, finalExamQuestionsMarks: {},
        secondExamMarks: {},
        isAbsentCa: {}, isAbsentFinal: false,
        isEligible: true,
      });
    }

    if (added.length > 0) {
      // Restored indexes should no longer be pending deletion.
      setRemovedIndexes(prev => prev.filter(index => !added.some(row => row.studentIndex === index)));
      mutateStudents(prev => [...prev, ...added]);
      setBulkText("");
      setIsBulkOpen(false);
    }

    const parts = [`${added.length} student(s) added.`];
    if (duplicates.length > 0) parts.push(`${duplicates.length} already on the marksheet.`);
    if (rejected.length > 0) parts.push(`${rejected.length} skipped (invalid format): ${rejected.slice(0, 3).join(", ")}${rejected.length > 3 ? "…" : ""}`);

    setFeedback({ type: added.length > 0 ? "success" : "error", text: parts.join(" ") });
  };

  const requestRemoveStudent = (row: StudentMarkRecord) => {
    const isPersisted = persistedIndexes.includes(row.studentIndex);
    const hasExamMarks = enteredMarks(row.secondExamMarks).length > 0;
    const hasAnyMarks = enteredMarks(row.finalExamQuestionsMarks).length > 0
      || caComponents.some(comp => enteredMarks(row.caQuestionsMarks?.[comp.id] ?? {}).length > 0);

    const doRemove = () => {
      mutateStudents(prev => prev.filter(item => item.studentIndex !== row.studentIndex));
      if (isPersisted) setRemovedIndexes(prev => (prev.includes(row.studentIndex) ? prev : [...prev, row.studentIndex]));
      setFeedback(null);
    };

    if (hasExamMarks || hasAnyMarks) {
      setConfirmState({
        title: `Remove ${row.studentIndex} from the marksheet?`,
        tone: "danger",
        confirmLabel: "Remove student",
        body: (
          <>
            <p>This student has marks recorded on this marksheet.</p>
            <p className="text-rose-600 font-semibold">
              {hasExamMarks
                ? "The Second Examiner has already marked this row — it will be kept in the database and only hidden from your desk."
                : "The row will be deleted from the database when you save."}
            </p>
          </>
        ),
        action: doRemove,
      });
      return;
    }

    doRemove();
  };

  const restoreIndex = (index: string) => {
    setRemovedIndexes(prev => prev.filter(item => item !== index));
    setFeedback({ type: "info", text: `${index} will be kept — save to confirm.` });
  };

  // ── Mark mutation helpers ──────────────────────────────────────────────────
  const updateCAMark = (studentIdx: string, compId: string, q: string, val: number, maxMarks: number) =>
    mutateStudents(prev => prev.map(row => {
      if (row.studentIndex !== studentIdx) return row;
      const compMarks = { ...(row.caQuestionsMarks[compId] ?? {}) };
      compMarks[q] = clampMark(val, maxMarks);
      return { ...row, caQuestionsMarks: { ...row.caQuestionsMarks, [compId]: compMarks } };
    }));

  const updateFinalMark = (studentIdx: string, q: string, val: number) =>
    mutateStudents(prev => prev.map(row => {
      if (row.studentIndex !== studentIdx) return row;
      const fm = { ...row.finalExamQuestionsMarks };
      fm[q] = clampMark(val, finalBlueprint.marksPerQuestion);
      return { ...row, finalExamQuestionsMarks: fm };
    }));

  const toggleAbsentCA = (studentIdx: string, compId: string) =>
    mutateStudents(prev => prev.map(row => {
      if (row.studentIndex !== studentIdx) return row;
      const absent = !row.isAbsentCa[compId];
      const nextAbsent = { ...row.isAbsentCa, [compId]: absent };
      const nextMarks = { ...row.caQuestionsMarks };
      if (absent) nextMarks[compId] = {};
      return { ...row, isAbsentCa: nextAbsent, caQuestionsMarks: nextMarks };
    }));

  const toggleAbsentFinal = (studentIdx: string) =>
    mutateStudents(prev => prev.map(row => {
      if (row.studentIndex !== studentIdx) return row;
      const absent = !row.isAbsentFinal;
      return { ...row, isAbsentFinal: absent, finalExamQuestionsMarks: absent ? {} : row.finalExamQuestionsMarks };
    }));

  // ── Cohort eligibility + per-row edit mode ────────────────────────────────
  /** Untick a student who falls outside the cohort the HOD authorised. */
  const toggleEligible = (studentIdx: string) =>
    mutateStudents(prev => prev.map(row =>
      row.studentIndex === studentIdx ? { ...row, isEligible: !isRowEligible(row) } : row
    ));

  /** The register is read-only by default; the pencil unlocks one row. */
  const toggleRowEdit = (studentIdx: string) =>
    setEditingRows(prev => {
      const next = new Set(prev);
      if (next.has(studentIdx)) next.delete(studentIdx);
      else next.add(studentIdx);
      return next;
    });

  // ── Keyboard navigation + Excel-style paste ────────────────────────────────
  const focusCell = (grid: string, column: string, fromRow: number, direction: 1 | -1) => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[data-grid="${grid}"][data-col="${column}"]`)
    );
    const next = nodes
      .map(node => ({ node, row: Number(node.dataset.row ?? "-1") }))
      .filter(entry => (direction === 1 ? entry.row > fromRow : entry.row < fromRow))
      .sort((a, b) => (direction === 1 ? a.row - b.row : b.row - a.row))[0];

    if (next) {
      next.node.focus();
      next.node.select();
    }
  };

  const handleCellKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    grid: string,
    column: string,
    rowIndex: number
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    focusCell(grid, column, rowIndex, event.shiftKey ? -1 : 1);
  };

  const handleCaPaste = (
    event: React.ClipboardEvent<HTMLInputElement>,
    comp: CaComponent,
    startRowIndex: number,
    startKey: string
  ) => {
    const grid = parseClipboardGrid(event.clipboardData.getData("text/plain"));
    if (grid.length === 0) return;
    event.preventDefault();

    const keys = componentQuestionKeys(comp);
    const startColumn = Math.max(0, keys.indexOf(startKey));

    mutateStudents(prev => {
      const next = [...prev];
      grid.forEach((cells, rowOffset) => {
        const target = startRowIndex + rowOffset;
        if (target < 0 || target >= next.length) return;
        const row = next[target];
        if (row.isAbsentCa[comp.id]) return;
        const compMarks = { ...(row.caQuestionsMarks[comp.id] ?? {}) };
        cells.forEach((value, columnOffset) => {
          const key = keys[startColumn + columnOffset];
          if (!key || value === null) return;
          compMarks[key] = clampMark(value, componentQuestionMax(comp, key));
        });
        next[target] = { ...row, caQuestionsMarks: { ...row.caQuestionsMarks, [comp.id]: compMarks } };
      });
      return next;
    });

    setFeedback({
      type: "info",
      text: `Pasted ${grid.length} row(s) into ${comp.name || caTypeLabel(comp.type)}. Review the values, then save.`,
    });
  };

  const handleFinalPaste = (
    event: React.ClipboardEvent<HTMLInputElement>,
    startRowIndex: number,
    startKey: string
  ) => {
    const grid = parseClipboardGrid(event.clipboardData.getData("text/plain"));
    if (grid.length === 0) return;
    event.preventDefault();

    const keys = questionKeys(finalBlueprint.totalQuestions);
    const startColumn = Math.max(0, keys.indexOf(startKey));

    mutateStudents(prev => {
      const next = [...prev];
      grid.forEach((cells, rowOffset) => {
        const target = startRowIndex + rowOffset;
        if (target < 0 || target >= next.length) return;
        const row = next[target];
        if (row.isAbsentFinal) return;
        const marks = { ...row.finalExamQuestionsMarks };
        cells.forEach((value, columnOffset) => {
          const key = keys[startColumn + columnOffset];
          if (!key || value === null) return;
          marks[key] = clampMark(value, finalBlueprint.marksPerQuestion);
        });
        next[target] = { ...row, finalExamQuestionsMarks: marks };
      });
      return next;
    });

    setFeedback({ type: "info", text: `Pasted ${grid.length} row(s) into the final paper grid. Review the values, then save.` });
  };

  // ── Save marks / submission flow ───────────────────────────────────────────
  const saveMarks = useCallback(async (): Promise<boolean> => {
    if (!activeModule) return false;
    if (students.length === 0 && removedIndexes.length === 0) {
      setFeedback({ type: "error", text: "Add at least one student before saving." });
      return false;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/lecturer/marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleCode: activeModule.code, students, deletedIndexes: removedIndexes }),
      });
      const result = await res.json();

      if (!res.ok) {
        setFeedback({ type: "error", text: result.error ?? "Failed to save marks." });
        return false;
      }

      if (result.stats) {
        setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: result.stats } : m));
        setActiveModule(prev => prev ? { ...prev, stats: result.stats } : null);
      }

      setPersistedIndexes(students.map(row => row.studentIndex));
      setRemovedIndexes([]);
      setIsDirty(false);

      const notes: string[] = [];
      if (result.created) notes.push(`${result.created} new`);
      if (result.updated) notes.push(`${result.updated} updated`);
      if (result.deleted) notes.push(`${result.deleted} deleted`);
      if (result.rejectedRows) notes.push(`${result.rejectedRows} rejected`);

      if (Array.isArray(result.skippedDeletions) && result.skippedDeletions.length > 0) {
        setFeedback({
          type: "info",
          text: `Marks saved (${notes.join(", ") || "no changes"}). ${result.skippedDeletions.join(", ")} could not be removed because the Second Examiner has already marked them.`,
        });
        // Keep them visible so the lecturer knows they still exist.
        setRemovedIndexes([]);
      } else {
        setFeedback({ type: "success", text: `Marks saved (${notes.join(", ") || "no changes"}).` });
      }
      return true;
    } catch {
      setFeedback({ type: "error", text: "Network error. Please try again." });
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [activeModule, students, removedIndexes]);

  /**
   * The bottom "Send to…" menu addresses one and the same submission — the
   * marksheet moves to SECOND_CHECKING either way — but records who it was
   * sent to, so the audit trail shows whether Faculty or the HOD was asked.
   */
  const handleSubmitForReview = (recipient: "FACULTY" | "HOD") => {
    if (!activeModule) return;

    if (errors.length > 0) {
      setIsIssuesOpen(true);
      setFeedback({
        type: "error",
        text: `The marksheet is not ready: ${errorCount} issue(s) must be fixed before it can be sent.`,
      });
      return;
    }

    const toFaculty = recipient === "FACULTY";
    const eligibleCount = students.filter(row => isRowEligible(row)).length;

    setConfirmState({
      title: toFaculty ? "Send this marksheet to Faculty?" : "Send this marksheet to the HOD?",
      tone: "primary",
      confirmLabel: toFaculty ? "Send to Faculty" : "Send to HOD",
      body: (
        <>
          <p>
            {eligibleCount} eligible student row(s) will be submitted for second checking
            {toFaculty
              ? " — the Second Examiner independently marks the final paper."
              : " — the Head of Department receives the submission for review."}
          </p>
          <p className="text-neutral-400">
            While the marksheet is under second checking your ledger becomes read-only. You can recall it later if
            the Examiner has not finalised yet.
          </p>
        </>
      ),
      action: async () => {
        setIsSubmitting(true);
        try {
          // Flush any pending edits first so the recipient audits the latest values.
          if (isDirty) {
            const saved = await saveMarks();
            if (!saved) return;
          }

          const res = await fetch("/api/lecturer/modules", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              moduleCode: activeModule.code,
              marksheetStatus: "SECOND_CHECKING",
              submittedTo: recipient,
            }),
          });
          const result = await res.json();

          if (!res.ok) {
            setFeedback({ type: "error", text: result.error ?? "Failed to submit for review." });
            return;
          }

          const nextStats = result.stats;
          setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: nextStats } : m));
          setActiveModule(prev => prev ? { ...prev, stats: nextStats } : null);
          setFeedback({
            type: "success",
            text: toFaculty
              ? "Marksheet sent to Faculty for second checking by the Examiner."
              : "Marksheet sent to the HOD for review.",
          });
        } catch {
          setFeedback({ type: "error", text: "Network error. Please try again." });
        } finally {
          setIsSubmitting(false);
        }
      },
    });
  };

  const handleRecallSubmission = () => {
    if (!activeModule) return;
    setConfirmState({
      title: "Recall this submission?",
      tone: "warning",
      confirmLabel: "Recall to marking",
      body: (
        <>
          <p>The marksheet returns to <strong>Marking</strong> so you can correct it.</p>
          <p className="text-neutral-400">
            Only do this before the Examiner finalises — any marking they have already entered is preserved.
          </p>
        </>
      ),
      action: async () => {
        setIsSubmitting(true);
        try {
          const res = await fetch("/api/lecturer/modules", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ moduleCode: activeModule.code, marksheetStatus: "MARKING" }),
          });
          const result = await res.json();
          if (!res.ok) {
            setFeedback({ type: "error", text: result.error ?? "Failed to recall the submission." });
            return;
          }
          setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: result.stats } : m));
          setActiveModule(prev => prev ? { ...prev, stats: result.stats } : null);
          setFeedback({ type: "success", text: "Submission recalled. The marksheet is editable again." });
        } catch {
          setFeedback({ type: "error", text: "Network error. Please try again." });
        } finally {
          setIsSubmitting(false);
        }
      },
    });
  };

  const handleApproveReconciliation = () => {
    if (!activeModule) return;
    setConfirmState({
      title: "Approve the Examiner's assessment?",
      tone: "warning",
      confirmLabel: "Approve marksheet",
      body: (
        <>
          <p>
            You are confirming that after comparing both sets of marks you accept the Second Examiner&apos;s
            assessment for <strong>{activeModule.code}</strong>.
          </p>
          <p className="text-neutral-400">This unlocks the Examiner&apos;s final reconciliation step.</p>
        </>
      ),
      action: async () => {
        setIsApprovingReconciliation(true);
        try {
          const res = await fetch("/api/lecturer/marks/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ moduleCode: activeModule.code }),
          });
          const result = await res.json();
          if (!res.ok) {
            setFeedback({ type: "error", text: result.error ?? "Failed to approve marksheet." });
            return;
          }
          const newStats = result.stats ?? {
            ...statsOf(activeModule),
            lecturerApproved: true,
            lecturerApprovedAt: result.lecturerApprovedAt,
          };
          setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: newStats } : m));
          setActiveModule(prev => prev ? { ...prev, stats: newStats } : null);
          setFeedback({
            type: "success",
            text: "Marksheet approved. The Examiner can now finalise the reconciliation.",
          });
        } catch {
          setFeedback({ type: "error", text: "Network error. Please try again." });
        } finally {
          setIsApprovingReconciliation(false);
        }
      },
    });
  };

  const handleExportCsv = () => {
    if (!activeModule) return;
    const csv = buildMarksheetCsv(activeModule.code, visibleStudents.map(entry => entry.row), caComponents, finalBlueprint);
    downloadCsv(`${activeModule.code}_marksheet${searchTerm ? "_filtered" : ""}.csv`, csv);
    const eligible = visibleStudents.filter(entry => isRowEligible(entry.row)).length;
    setFeedback({ type: "info", text: `${eligible} eligible row(s) exported to CSV.` });
  };

  /** Print-to-PDF export of the grouped CA register (browser print dialog). */
  const handleExportPdf = () => {
    if (!activeModule) return;
    const opened = openCaGridPrintWindow({
      moduleCode: activeModule.code,
      moduleName: activeModule.name,
      components: caComponents,
      rows: visibleStudents.map(entry => entry.row),
      printedBy: user?.fullName,
    });
    if (!opened) {
      setFeedback({ type: "error", text: "The browser blocked the print window — allow pop-ups and try again." });
    }
  };

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (isAuthLoading || (isModulesLoading && !!user?.email)) {
    return (
      <div className="min-h-screen bg-cream-canvas flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
        <p className="text-xs font-bold text-neutral-400 tracking-widest uppercase">Initializing Lecturer Workspace…</p>
      </div>
    );
  }

  // ── Locked-down view for pure examiners (non-isActiveLec) ─────────────────
  if (!isActiveLec) {
    return (
      <div className="w-full min-h-screen bg-cream-canvas text-[#1a1a1a]">
        <div className="sticky top-0 z-40 bg-white border-b border-neutral-200/80 px-6 py-3">
          <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/wusl-logo.png" alt="Wayamba University" className="w-10 h-10 object-contain" />
              <div>
                <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Student Exam &amp; Results Management</p>
                <h1 className="text-sm font-black text-[#1a1a1a] leading-none">Lecturer Workspace</h1>
              </div>
            </div>
            <button onClick={logout} className="text-xs font-semibold text-rose-600 hover:underline cursor-pointer">
              Sign Out
            </button>
          </div>
        </div>
        <div className="max-w-screen-2xl mx-auto p-6 flex flex-col items-center justify-center min-h-[60vh] gap-6">
          <div className="bg-white rounded-2xl premium-border p-10 max-w-md text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-neutral-100 flex items-center justify-center">
              <ShieldOff className="h-8 w-8 text-neutral-400" />
            </div>
            <h2 className="text-lg font-black text-[#1a1a1a]">Restricted Access</h2>
            <p className="text-sm text-neutral-500 leading-relaxed">
              This workspace is for <strong>Active Lecturers</strong> only. You are assigned as a
              <strong> Second Examiner</strong> and do not have access to module blueprints, CA marks, or
              the active lecturer&apos;s final marks ledger.
            </p>
            <div className="pt-2">
              <button
                onClick={() => router.push("/dashboard/examiner")}
                className="flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition-all cursor-pointer"
              >
                <Flame className="h-3.5 w-3.5" />
                Go to Examiner Hub
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const finalQs = finalBlueprint.enabled ? questionKeys(finalBlueprint.totalQuestions) : [];
  const pendingReconciliationCount = modules.filter(
    m => statsOf(m).marksheetStatus === "RECONCILIATION_NEEDED" && !statsOf(m).lecturerApproved
  ).length;

  return (
    <div className="w-full min-h-screen bg-cream-canvas text-[#1a1a1a]">

      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 bg-white border-b border-neutral-200/80 px-6 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/wusl-logo.png" alt="Wayamba University" className="w-10 h-10 object-contain" />
            <div>
              <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Student Exam &amp; Results Management</p>
              <h1 className="text-sm font-black text-[#1a1a1a] leading-none">Lecturer Workspace</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isDirty && (
              <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                Unsaved changes
              </span>
            )}
            <span className="hidden sm:block text-xs text-neutral-500 font-medium">
              {user?.fullName ?? user?.email}
            </span>

            {/* Role switcher dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsRoleMenuOpen(!isRoleMenuOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-bold hover:bg-neutral-100 transition-all cursor-pointer"
              >
                <Sliders className="h-3.5 w-3.5 text-indigo-600" />
                <span>Lecturer Desk</span>
                <ChevronDown className={`h-3 w-3 text-neutral-400 transition-transform ${isRoleMenuOpen ? "rotate-180" : ""}`} />
              </button>
              {isRoleMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsRoleMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-neutral-200 rounded-xl shadow-xl p-1.5 z-20 space-y-0.5 text-xs">
                    <div className="px-3 py-2 border-b border-neutral-100 mb-1">
                      <span className="font-black text-[#1a1a1a]">{user?.fullName}</span>
                      <span className="block text-[10px] text-neutral-400 mt-0.5">{user?.email}</span>
                    </div>
                    <button onClick={() => setIsRoleMenuOpen(false)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 font-bold cursor-pointer">
                      <Sliders className="h-3.5 w-3.5" /><span>Lecturer Workstation</span>
                    </button>
                    {userCapabilities.isHOD && (
                      <button onClick={() => handleWorkspaceSwitch("HOD")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-neutral-50 text-neutral-700 font-semibold cursor-pointer">
                        <Key className="h-3.5 w-3.5 text-neutral-400" /><span>HOD Console</span>
                      </button>
                    )}
                    {userCapabilities.isExamLec && (
                      <button onClick={() => handleWorkspaceSwitch("EXAMINER")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-neutral-50 text-neutral-700 font-semibold cursor-pointer">
                        <Flame className="h-3.5 w-3.5 text-neutral-400" /><span>Examiner Hub</span>
                      </button>
                    )}
                    <div className="border-t border-neutral-100 pt-1 mt-1">
                      <button onClick={() => { setIsRoleMenuOpen(false); setIsProfileOpen(true); }} className="w-full flex items-center gap-2.5 text-left px-3 py-2 text-neutral-700 font-semibold rounded-lg hover:bg-neutral-50 cursor-pointer">
                        <User className="h-3.5 w-3.5" /><span>Profile Settings</span>
                      </button>
                      <button onClick={logout} className="w-full flex items-center gap-2.5 text-left px-3 py-2 text-rose-600 font-semibold rounded-lg hover:bg-rose-50 cursor-pointer">
                        <LogOut className="h-3.5 w-3.5" /><span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <ProfileSettingsDrawer isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />

      {/* ── Main Layout ─────────────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto p-4 sm:p-6 flex gap-5 items-start">

        {/* ── Panel A: Module Sidebar ────────────────────────────────────────── */}
        <aside className="w-64 shrink-0 bg-white rounded-2xl premium-border overflow-hidden sticky top-20">
          <div className="p-4 bg-neutral-50 border-b border-neutral-200/70 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-neutral-500" />
            <h2 className="font-bold text-xs uppercase tracking-wider text-neutral-600">Assigned Modules</h2>
            <span className="ml-auto text-[10px] font-bold text-neutral-400">{modules.length}</span>
          </div>
          <div className="divide-y divide-neutral-100 max-h-[70vh] overflow-y-auto">
            {modules.length === 0 && (
              <div className="p-6 text-center text-xs text-neutral-400 italic">
                No modules assigned to your account.
              </div>
            )}
            {modules.map(mod => {
              const selected = activeModule?.code === mod.code;
              const modStats = statsOf(mod);
              const modStatus = modStats.marksheetStatus;
              const needsReview = modStatus === "RECONCILIATION_NEEDED";
              return (
                <button
                  key={mod.id}
                  onClick={() => selectModule(mod)}
                  className={`w-full text-left p-4 transition-all flex justify-between items-center cursor-pointer ${selected ? "bg-indigo-50/60 border-r-4 border-indigo-600" : "hover:bg-neutral-50/50"}`}
                >
                  <div className="min-w-0">
                    <p className={`font-bold text-sm ${selected ? "text-indigo-700" : "text-[#1a1a1a]"}`}>{mod.code}</p>
                    <p className="text-[11px] text-neutral-400 mt-0.5 leading-tight">{mod.name}</p>
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      {mod.roleInModule === "EXAMINER" && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wide">Examiner</span>
                      )}
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${statusBadgeClass(modStatus)}`}>
                        {statusLabel(modStatus)}
                      </span>
                      {needsReview && !modStats.lecturerApproved && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 uppercase tracking-wide animate-pulse">
                          <Bell className="h-2.5 w-2.5" />Review
                        </span>
                      )}
                    </div>
                  </div>
                  {mod.isFrozen && <Lock className="h-3.5 w-3.5 text-neutral-400 shrink-0 ml-1" />}
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Right Panel ─────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">
          {!activeModule ? (
            <div className="bg-white rounded-2xl premium-border p-16 text-center text-sm text-neutral-400 italic">
              Select a module from the sidebar to begin.
            </div>
          ) : (
            <>
              {/* Page-level reconciliation notification banner */}
              {pendingReconciliationCount > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-center gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg shrink-0">
                    <Bell className="h-4 w-4 text-orange-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-orange-800">{pendingReconciliationCount} module(s) require your review and approval</p>
                    <p className="text-[11px] text-orange-600 mt-0.5">The Second Examiner has flagged a variance in the marks. Review the comparison below and approve before they can finalise.</p>
                  </div>
                  <GitMerge className="h-5 w-5 text-orange-400 shrink-0" />
                </div>
              )}

              {/* Module header badge */}
              <div className="bg-white rounded-2xl premium-border p-5 space-y-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full">{activeModule.code}</span>
                      {isFrozen && <span className="text-xs font-bold bg-red-100 text-red-700 px-2.5 py-1 rounded-full flex items-center gap-1"><Lock className="h-3 w-3" />FROZEN</span>}
                      {activeModule.roleInModule === "EXAMINER" && <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full flex items-center gap-1"><Shield className="h-3 w-3" />Examiner View</span>}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBadgeClass(activeStatus)}`}>
                        {statusLabel(activeStatus)}
                      </span>
                      {isLockedByStatus && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-neutral-800 text-white flex items-center gap-1">
                          <Lock className="h-2.5 w-2.5" />Read-only
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-black mt-1.5">{activeModule.name}</h2>
                    <p className="text-xs text-neutral-400 mt-0.5">{activeModule.credits} Credits</p>
                  </div>
                  <div className="text-right text-xs space-y-1">
                    {activeModule.assignedActiveLec && <p className="text-neutral-500">Active Lec: <span className="font-bold text-neutral-800">{activeModule.assignedActiveLec.fullName}</span></p>}
                    {activeModule.assignedExamLec && <p className="text-neutral-500">Examiner: <span className="font-bold text-neutral-800">{activeModule.assignedExamLec.fullName}</span></p>}
                  </div>
                </div>

                {/* Desk statistics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 border-t border-neutral-100">
                  {[
                    { label: "Students", value: `${students.length}`, tone: "text-[#1a1a1a]" },
                    {
                      label: "Cells captured",
                      value: students.length === 0 ? "—" : `${Math.round(summaryRows.reduce((s, r) => s + r.progress, 0) / Math.max(1, summaryRows.length))}%`,
                      tone: "text-indigo-600",
                    },
                    { label: "Issues", value: `${errorCount}`, tone: errorCount > 0 ? "text-rose-600" : "text-emerald-600" },
                    {
                      label: "Variance flags",
                      value: showComparison ? `${summaryRows.filter(r => r.varianceFlagged).length}` : "—",
                      tone: "text-orange-600",
                    },
                  ].map(stat => (
                    <div key={stat.label} className="pt-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{stat.label}</p>
                      <p className={`text-lg font-black leading-tight ${stat.tone}`}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Frozen overlay notice */}
              {isFrozen && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2.5 text-xs font-semibold text-red-700">
                  <Lock className="h-4 w-4 shrink-0" />
                  This module is frozen by the HOD. All inputs are read-only and saving is disabled.
                </div>
              )}

              {/* Closed-marksheet notice */}
              {isLockedByStatus && (
                <div className="bg-neutral-800 text-white rounded-xl p-3.5 flex items-start gap-2.5 text-xs">
                  <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">This marksheet is closed ({statusLabel(activeStatus)}).</p>
                    <p className="text-neutral-300 mt-0.5 leading-relaxed">
                      The Second Examiner has taken ownership of the marks
                      {activeStatus === "RECONCILIATION_NEEDED" && " and flagged a variance for joint review"}.
                      Your ledger is read-only so the marks you already submitted cannot drift from what is being moderated.
                    </p>
                  </div>
                </div>
              )}

              {/* Awaiting second checking notice + recall */}
              {isSecondChecking && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 text-xs">
                  <div className="flex items-start gap-2.5 flex-1">
                    <Send className="h-4 w-4 shrink-0 mt-0.5 text-indigo-600" />
                    <div>
                      <p className="font-bold text-indigo-800">Submitted for second checking.</p>
                      <p className="text-indigo-600 mt-0.5 leading-relaxed">
                        The Examiner is independently marking the final paper. Marks remain editable, but recall the
                        submission if you need to correct something significant.
                      </p>
                    </div>
                  </div>
                  {!isFrozen && (
                    <button
                      onClick={handleRecallSubmission}
                      disabled={isSubmitting}
                      className="shrink-0 flex items-center gap-2 h-9 px-4 text-xs font-bold bg-white border border-indigo-200 text-indigo-700 rounded-xl hover:bg-indigo-100 disabled:opacity-40 transition-all cursor-pointer"
                    >
                      {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                      Recall Submission
                    </button>
                  )}
                </div>
              )}

              {/* Feedback message */}
              {feedback && (
                <div className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs font-semibold ${
                  feedback.type === "success"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : feedback.type === "info"
                      ? "bg-indigo-50 border-indigo-200 text-indigo-800"
                      : "bg-rose-50 border-rose-200 text-rose-800"
                }`}>
                  {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                    : feedback.type === "info" ? <Info className="h-4 w-4 shrink-0" />
                    : <AlertCircle className="h-4 w-4 shrink-0" />}
                  <span className="flex-1">{feedback.text}</span>
                  <button onClick={() => setFeedback(null)} aria-label="Dismiss message" className="shrink-0 text-current/60 hover:text-current cursor-pointer">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Composition audit */}
              {(errorCount > 0 || warningCount > 0) && (
                <div className={`rounded-2xl premium-border overflow-hidden ${errorCount > 0 ? "bg-rose-50/60 border-rose-200" : "bg-amber-50/50 border-amber-200"}`}>
                  <button
                    onClick={() => setIsIssuesOpen(open => !open)}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-left cursor-pointer"
                  >
                    <TriangleAlert className={`h-4 w-4 shrink-0 ${errorCount > 0 ? "text-rose-600" : "text-amber-600"}`} />
                    <span className={`text-xs font-bold ${errorCount > 0 ? "text-rose-800" : "text-amber-800"}`}>
                      Marksheet audit — {errorCount} blocking issue{errorCount === 1 ? "" : "s"}
                      {warningCount > 0 && `, ${warningCount} warning${warningCount === 1 ? "" : "s"}`}
                    </span>
                    <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                      {isIssuesOpen ? "Hide" : "Review"}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 text-neutral-400 transition-transform ${isIssuesOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isIssuesOpen && (
                    <div className="px-4 pb-4 space-y-3">
                      {moduleIssues.length > 0 && (
                        <ul className="space-y-1.5">
                          {moduleIssues.slice(0, 6).map((issue, index) => (
                            <li key={`module-${index}`} className="flex items-start gap-2 text-[11px] font-semibold">
                              {issue.level === "error"
                                ? <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px text-rose-600" />
                                : <Info className="h-3.5 w-3.5 shrink-0 mt-px text-amber-600" />}
                              <span className={issue.level === "error" ? "text-rose-700" : "text-amber-700"}>{issue.message}</span>
                            </li>
                          ))}
                          {moduleIssues.length > 6 && (
                            <li className="text-[11px] text-neutral-500 font-semibold pl-5.5">+{moduleIssues.length - 6} more module issue(s)</li>
                          )}
                        </ul>
                      )}

                      {studentIssueGroups.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                            Student rows needing attention ({studentIssueGroups.length})
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {studentIssueGroups.slice(0, 12).map(([index, list]) => (
                              <button
                                key={index}
                                onClick={() => {
                                  setSearchTerm(index);
                                  setIsIssuesOpen(false);
                                }}
                                title={list.map(item => item.message).join("\n")}
                                className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg border cursor-pointer transition-colors ${
                                  list.some(item => item.level === "error")
                                    ? "bg-rose-100 border-rose-200 text-rose-700 hover:bg-rose-200"
                                    : "bg-amber-100 border-amber-200 text-amber-700 hover:bg-amber-200"
                                }`}
                              >
                                {index}
                                <span className="opacity-70">×{list.length}</span>
                              </button>
                            ))}
                            {studentIssueGroups.length > 12 && (
                              <span className="text-[10px] font-bold text-neutral-500 self-center">
                                +{studentIssueGroups.length - 12} more
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-neutral-500">
                            Click a student to filter the ledger to that row.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Main tab bar ─────────────────────────────────────────────── */}
              <div className="flex gap-2">
                {([
                  { id: "blueprint" as MainTab, label: "Blueprint Setup", icon: <Settings className="h-3.5 w-3.5" /> },
                  { id: "marks" as MainTab, label: "Marks Ledger", icon: <ClipboardList className="h-3.5 w-3.5" />, badge: students.length },
                ] as const).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => { setMainTab(tab.id); setFeedback(null); }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${mainTab === tab.id ? "bg-[#1a1a1a] text-white border-[#1a1a1a]" : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"}`}
                  >
                    {tab.icon}{tab.label}
                    {"badge" in tab && tab.badge !== undefined && tab.badge > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 rounded-full ${mainTab === tab.id ? "bg-white/20" : "bg-neutral-100 text-neutral-500"}`}>
                        {tab.badge}
                      </span>
                    )}
                  </button>
                ))}
                {isDirty && (
                  <span className="ml-auto self-center text-[11px] font-bold text-amber-600 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                    You have unsaved edits
                  </span>
                )}
              </div>

              {/* ══════════════════════════════════════════════════════════════════
                  PANEL B — BLUEPRINT BUILDER
              ══════════════════════════════════════════════════════════════════ */}
              {mainTab === "blueprint" && (
                <div className={`bg-white rounded-2xl premium-border overflow-hidden ${isReadOnly ? "opacity-60 pointer-events-none" : ""}`}>
                  {/* Blueprint sub-tabs */}
                  <div className="border-b border-neutral-200 bg-neutral-50/60 px-5 py-3 flex flex-wrap gap-2">
                    <button onClick={() => setBpTab("ca")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${bpTab === "ca" ? "bg-indigo-600 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
                      <Sliders className="h-3.5 w-3.5" />CA Components
                    </button>
                    <button onClick={() => setBpTab("final")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${bpTab === "final" ? "bg-indigo-600 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
                      <FileText className="h-3.5 w-3.5" />Final Exam
                    </button>
                    <div className="ml-auto flex items-center gap-3 text-xs">
                      <span className={`font-extrabold ${grandWeightTotal === 100 ? "text-emerald-600" : "text-rose-600"}`}>
                        Total Weight: {grandWeightTotal}% / 100%
                      </span>
                    </div>
                  </div>

                  <div className="p-6 space-y-6">

                    {/* ── CA Setup Tab ─────────────────────────────────────── */}
                    {bpTab === "ca" && (
                      <div className="space-y-4">
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                          <div>
                            <h3 className="font-bold text-sm">Continuous Assessment Components</h3>
                            <p className="text-xs text-neutral-400 mt-0.5 max-w-2xl">
                              Two blueprint designs. <strong className="text-violet-600">Group A</strong> scores practical work with
                              one overall mark ({GROUP_A_PREVIEW.map(caTypeLabel).join(", ")}). <strong className="text-sky-600">Group B</strong> scores
                              written work with a weightage for every question ({GROUP_B_PREVIEW.map(caTypeLabel).join(", ")}).
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 shrink-0">
                            <button
                              onClick={() => addCA("A")}
                              className="flex items-center gap-1.5 h-8 px-3 text-xs font-bold bg-violet-50 text-violet-700 border border-violet-100 rounded-lg hover:bg-violet-100 transition-colors cursor-pointer"
                            >
                              <Plus className="h-3.5 w-3.5" />Group A component
                            </button>
                            <button
                              onClick={() => addCA("B")}
                              className="flex items-center gap-1.5 h-8 px-3 text-xs font-bold bg-sky-50 text-sky-700 border border-sky-100 rounded-lg hover:bg-sky-100 transition-colors cursor-pointer"
                            >
                              <Plus className="h-3.5 w-3.5" />Group B component
                            </button>
                          </div>
                        </div>

                        {caComponents.length === 0 && (
                          <div className="border-2 border-dashed border-neutral-200 rounded-xl p-8 text-center space-y-2">
                            <p className="text-sm text-neutral-500 font-semibold">No CA components yet.</p>
                            <p className="text-xs text-neutral-400">
                              Add a <strong className="text-violet-600">Group A</strong> component for projects, presentations and lab reports,
                              or a <strong className="text-sky-600">Group B</strong> component for quizzes, assignments, midterms and tutorials.
                            </p>
                          </div>
                        )}

                        {caComponents.map((comp, idx) => {
                          const group: CaGroup = comp.group ?? caGroupOf(comp.type);
                          const meta = CA_GROUP_META[group];
                          const questionCount = componentQuestionCount(comp);
                          const questionMarks = comp.questionMarks ?? [];
                          const rawTotal = componentRawTotal(comp);

                          return (
                          <div key={comp.id} className="border border-neutral-200 rounded-xl p-4 space-y-4 bg-neutral-50/30">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-black text-indigo-600 uppercase tracking-wider">Component {idx + 1}</span>
                                <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${meta.badge}`}>
                                  Group {group} · {meta.short}
                                </span>
                              </div>
                              <button
                                onClick={() => removeCA(comp.id)}
                                aria-label={`Remove component ${idx + 1}`}
                                className="p-1.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {/* ── Shared fields ─────────────────────────────── */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              <div>
                                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Type</label>
                                <select
                                  value={comp.type}
                                  onChange={e => changeCaType(comp.id, e.target.value)}
                                  className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:border-indigo-500"
                                >
                                  <optgroup label="Group A — Practical & performance">
                                    {CA_GROUP_A_TYPES.map(t => <option key={t} value={t}>{caTypeLabel(t)}</option>)}
                                  </optgroup>
                                  <optgroup label="Group B — Written assessments">
                                    {CA_GROUP_B_TYPES.map(t => <option key={t} value={t}>{caTypeLabel(t)}</option>)}
                                  </optgroup>
                                </select>
                              </div>

                              <div className="sm:col-span-2">
                                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Name</label>
                                <input
                                  type="text"
                                  value={comp.name}
                                  onChange={e => updateCA(comp.id, "name", e.target.value)}
                                  placeholder={group === "A" ? "e.g. Group Project Deliverable" : "e.g. Mid-Semester Quiz"}
                                  className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-indigo-500"
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Weightage (%)</label>
                                <input
                                  type="number" min="0" max="100"
                                  value={comp.weightage || ""}
                                  onChange={e => updateCA(comp.id, "weightage", Number(e.target.value))}
                                  className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:border-indigo-500 text-right"
                                />
                              </div>

                              {group === "A" ? (
                                /* ── Group A: one overall mark ─────────────── */
                                <div>
                                  <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Total Marks</label>
                                  <input
                                    type="number" min="1" max="1000"
                                    value={comp.totalMarks ?? ""}
                                    onChange={e => updateCaTotalMarks(comp.id, e.target.value)}
                                    placeholder="100"
                                    className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:border-violet-500 text-right"
                                  />
                                </div>
                              ) : (
                                /* ── Group B: question count ───────────────── */
                                <div>
                                  <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Total Questions</label>
                                  <input
                                    type="number" min="1" max="50"
                                    value={comp.totalQuestions ?? ""}
                                    onChange={e => updateCaTotalQuestions(comp.id, e.target.value)}
                                    placeholder="6"
                                    className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:border-sky-500 text-right"
                                  />
                                </div>
                              )}
                            </div>

                            {group === "B" && (
                              /* ── Group B: a weightage row per question ──── */
                              <div className="border border-neutral-200 rounded-xl bg-white overflow-hidden">
                                <div className="px-3 py-2 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center gap-2">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                                    Weightage per question
                                  </span>
                                  <span className="text-[10px] text-neutral-400">
                                    {questionCount} question{questionCount === 1 ? "" : "s"} · {rawTotal} marks in total
                                  </span>
                                  {questionCount > 1 && (
                                    <button
                                      onClick={() => fillCaQuestionMarks(comp.id)}
                                      title="Copy Q1's weightage to every question"
                                      className="ml-auto flex items-center gap-1 h-6 px-2 text-[10px] font-bold bg-white border border-neutral-200 text-neutral-600 rounded-md hover:bg-neutral-50 cursor-pointer"
                                    >
                                      <ArrowDownToLine className="h-3 w-3" />Fill from Q1
                                    </button>
                                  )}
                                </div>
                                <div className="divide-y divide-neutral-100 max-h-72 overflow-y-auto">
                                  {questionKeys(questionCount).map((q, questionIndex) => {
                                    const value = Number(questionMarks[questionIndex]) || 0;
                                    const share = rawTotal > 0 ? Math.round((value / rawTotal) * 100) : 0;
                                    return (
                                      <div key={q} className="flex items-center gap-3 px-3 py-1.5">
                                        <span className="w-10 text-[11px] font-black text-neutral-500">{q}</span>
                                        <input
                                          type="number" min="0" max="1000"
                                          value={questionMarks[questionIndex] ?? ""}
                                          onChange={e => updateCaQuestionMark(comp.id, questionIndex, e.target.value)}
                                          aria-label={`Weightage for ${q}`}
                                          placeholder="10"
                                          className="w-24 bg-white border border-neutral-200 rounded-lg px-2.5 py-1 text-xs font-bold text-right focus:outline-none focus:border-sky-500"
                                        />
                                        <span className="text-[10px] text-neutral-400 font-semibold">marks</span>
                                        <span className="ml-auto text-[10px] font-bold text-neutral-400 tabular-nums">
                                          {share}% of component
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* ── Score mode (both groups) ──────────────────── */}
                            <div>
                              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Score Mode</label>
                              <div className="flex gap-2 sm:max-w-md">
                                {SCORE_MODES.map(m => (
                                  <button
                                    key={m.value}
                                    onClick={() => updateCA(comp.id, "scoreMode", m.value)}
                                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${comp.scoreMode === m.value ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"}`}
                                  >
                                    {m.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* ── Component summary ─────────────────────────── */}
                            <div className={`rounded-lg px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold ${group === "A" ? "bg-violet-50/50 text-violet-700" : "bg-sky-50/50 text-sky-700"}`}>
                              {group === "A" ? (
                                <>
                                  <span>One mark per student</span>
                                  <span>Scored out of: {rawTotal}</span>
                                </>
                              ) : (
                                <>
                                  <span>Marks per question: {questionMarks.join(" + ") || "—"}</span>
                                  <span>Raw total: {rawTotal}</span>
                                </>
                              )}
                              <span>Contributes: {comp.weightage || 0}%</span>
                              <span>Mode: {comp.scoreMode}</span>
                            </div>
                          </div>
                          );
                        })}

                        {/* CA Weight Summary */}
                        <div className="flex flex-wrap justify-between items-center gap-3 p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs font-bold">
                          <span className="text-neutral-600">CA Total Weightage:</span>
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-[11px] font-semibold text-violet-600">
                              Group A: {groupWeightTotal("A")}%
                            </span>
                            <span className="text-[11px] font-semibold text-sky-600">
                              Group B: {groupWeightTotal("B")}%
                            </span>
                            <span className={grandWeightTotal === 100 ? "text-emerald-600" : "text-rose-600"}>{caWeightTotal}%</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Final Exam Tab ────────────────────────────────────── */}
                    {bpTab === "final" && (
                      <div className="space-y-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-bold text-sm">Final Examination Blueprint</h3>
                            <p className="text-xs text-neutral-400 mt-0.5">Configure the written end-of-semester examination structure.</p>
                          </div>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <span className="text-xs font-bold text-neutral-600">Enabled</span>
                            <div
                              role="switch"
                              aria-checked={finalBlueprint.enabled}
                              tabIndex={0}
                              onClick={() => setFinalBlueprint(f => ({ ...f, enabled: !f.enabled }))}
                              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFinalBlueprint(f => ({ ...f, enabled: !f.enabled })); } }}
                              className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${finalBlueprint.enabled ? "bg-indigo-600" : "bg-neutral-300"}`}
                            >
                              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${finalBlueprint.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
                            </div>
                          </label>
                        </div>

                        {finalBlueprint.enabled && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Weightage (%)</label>
                              <input type="number" min="0" max="100" value={finalBlueprint.weightage || ""} onChange={e => setFinalBlueprint(f => ({ ...f, weightage: Number(e.target.value) }))} className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-indigo-500 text-right" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Total Questions</label>
                              <input type="number" min="1" max="30" value={finalBlueprint.totalQuestions} onChange={e => { const n = Number(e.target.value); setFinalBlueprint(f => ({ ...f, totalQuestions: n, questionsToAnswer: Math.min(f.questionsToAnswer, n) })); }} className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-indigo-500 text-right" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Marks / Question</label>
                              <input type="number" min="1" value={finalBlueprint.marksPerQuestion} onChange={e => setFinalBlueprint(f => ({ ...f, marksPerQuestion: Number(e.target.value) }))} className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-indigo-500 text-right" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Questions to Answer</label>
                              <input type="number" min="1" max={finalBlueprint.totalQuestions} value={finalBlueprint.questionsToAnswer} onChange={e => setFinalBlueprint(f => ({ ...f, questionsToAnswer: Math.min(f.totalQuestions, Number(e.target.value)) }))} className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-indigo-500 text-right" />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Score Mode</label>
                              <div className="flex gap-2">
                                {SCORE_MODES.map(m => (
                                  <button key={m.value} onClick={() => setFinalBlueprint(f => ({ ...f, scoreMode: m.value }))} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${finalBlueprint.scoreMode === m.value ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"}`}>
                                    {m.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Auto-generated template preview */}
                        {finalBlueprint.enabled && finalBlueprint.totalQuestions > 0 && (
                          <div className="bg-amber-50/40 border border-amber-200/60 rounded-xl p-4">
                            <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-2">Auto-Generated Question Template</p>
                            <div className="flex flex-wrap gap-2">
                              {questionKeys(finalBlueprint.totalQuestions).map(q => (
                                <span key={q} className="bg-white border border-amber-200 text-amber-800 font-bold text-xs px-2.5 py-1 rounded-lg">
                                  {q} / {finalBlueprint.marksPerQuestion}
                                </span>
                              ))}
                            </div>
                            <p className="text-xs text-amber-600 font-semibold mt-2">
                              Max Score: {finalBlueprint.totalQuestions * finalBlueprint.marksPerQuestion} · Answer: {finalBlueprint.questionsToAnswer} of {finalBlueprint.totalQuestions} · Mode: {finalBlueprint.scoreMode}
                            </p>
                          </div>
                        )}

                        {!finalBlueprint.enabled && (
                          <div className="border-2 border-dashed border-neutral-200 rounded-xl p-8 text-center text-sm text-neutral-400">
                            Enable the final exam toggle above to configure the blueprint.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Structural-change warning */}
                    {isBlueprintDirty && students.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5 text-[11px] font-semibold text-amber-800">
                        <TriangleAlert className="h-4 w-4 shrink-0 mt-px text-amber-600" />
                        <span>
                          Changing the scoring structure of a module that already has marks recorded can discard or
                          re-scale captured marks. Review the ledger after saving.
                        </span>
                      </div>
                    )}

                    {/* Save Blueprint */}
                    {!isReadOnly && (
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-4 border-t border-neutral-100">
                        <p className="text-[11px] text-neutral-400">
                          {blueprintError
                            ? <span className="text-rose-600 font-bold">{blueprintError}</span>
                            : isBlueprintDirty
                              ? "Weights total 100% — ready to save."
                              : "No blueprint changes to save."}
                        </p>
                        <button
                          onClick={handleSaveBlueprint}
                          disabled={isSaving || !!blueprintError || !isBlueprintDirty}
                          title={blueprintError ?? (!isBlueprintDirty ? "No changes to save" : "")}
                          className="flex items-center gap-2 h-10 px-5 text-xs font-bold bg-[#1a1a1a] text-white rounded-xl hover:bg-neutral-800 disabled:opacity-40 transition-all cursor-pointer"
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save Blueprint
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════════════════════════════
                  PANEL C — MARKSHEET LEDGER
              ══════════════════════════════════════════════════════════════════ */}
              {mainTab === "marks" && (
                <div className={`bg-white rounded-2xl premium-border overflow-hidden ${isFrozen ? "opacity-60 pointer-events-none" : ""}`}>
                  {/* Marks toolbar */}
                  <div className="border-b border-neutral-200 bg-neutral-50/60 px-5 py-3 space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                      <div className="flex gap-2">
                        <button onClick={() => setMarksTab("ca_marks")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${marksTab === "ca_marks" ? "bg-orange-500 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
                          <BarChart2 className="h-3.5 w-3.5" />CA Evaluation Grid
                        </button>
                        <button onClick={() => setMarksTab("final_marks")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${marksTab === "final_marks" ? "bg-orange-500 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
                          <FileText className="h-3.5 w-3.5" />Final Paper Grid
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                        {/* Search */}
                        <div className="relative">
                          <Search className="h-3.5 w-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            placeholder="Find student…"
                            aria-label="Search students"
                            className="h-8 pl-8 pr-7 bg-white border border-neutral-200 rounded-lg text-xs font-semibold focus:outline-none focus:border-indigo-500 w-40"
                          />
                          {searchTerm && (
                            <button onClick={() => setSearchTerm("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 cursor-pointer">
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>

                        <button
                          onClick={() => setIsSummaryOpen(open => !open)}
                          className={`flex items-center gap-1.5 h-8 px-3 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${isSummaryOpen ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50"}`}
                        >
                          <Table2 className="h-3.5 w-3.5" />Summary
                        </button>

                        <button
                          onClick={handleExportCsv}
                          disabled={students.length === 0}
                          className="flex items-center gap-1.5 h-8 px-3 text-xs font-bold bg-white border border-neutral-200 text-neutral-700 rounded-lg hover:bg-neutral-50 disabled:opacity-40 transition-colors cursor-pointer"
                        >
                          <Download className="h-3.5 w-3.5" />CSV
                        </button>

                        {!isReadOnly && (
                          <button
                            onClick={() => setIsBulkOpen(open => !open)}
                            className={`flex items-center gap-1.5 h-8 px-3 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${isBulkOpen ? "bg-[#1a1a1a] text-white border-[#1a1a1a]" : "bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50"}`}
                          >
                            <ClipboardPaste className="h-3.5 w-3.5" />Bulk add
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Bulk roster paste */}
                    {isBulkOpen && !isReadOnly && (
                      <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-bold text-neutral-600 uppercase tracking-wider">Paste a class roster</p>
                          <button onClick={() => setIsBulkOpen(false)} aria-label="Close bulk add" className="text-neutral-400 hover:text-neutral-700 cursor-pointer">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <textarea
                          value={bulkText}
                          onChange={e => setBulkText(e.target.value)}
                          rows={4}
                          placeholder={"23001\n23002\n23003\n…one index per line, or separated by commas"}
                          className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-semibold tracking-wide focus:outline-none focus:border-indigo-500"
                        />
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[10px] text-neutral-400">
                            Duplicates and invalid entries are skipped automatically.
                          </p>
                          <button
                            onClick={handleBulkAdd}
                            className="flex items-center gap-1.5 h-8 px-3 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
                          >
                            <UserPlus className="h-3.5 w-3.5" />Add roster
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Add single student */}
                    {!isReadOnly && (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          placeholder="Student Index (e.g. 23001)"
                          value={newIndexInput}
                          onChange={e => setNewIndexInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && addStudent()}
                          aria-label="Student index"
                          className="h-8 px-3 bg-white border border-neutral-200 rounded-lg text-xs font-bold uppercase tracking-wider focus:outline-none focus:border-indigo-500 w-52"
                        />
                        <button onClick={() => addStudent()} className="h-8 px-3 bg-indigo-600 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 hover:bg-indigo-700 transition-colors cursor-pointer">
                          <UserPlus className="h-3.5 w-3.5" />Add
                        </button>
                        <span className="text-[11px] text-neutral-400">
                          {students.length} on the roster
                          {searchTerm && ` · ${visibleStudents.length} shown`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Pending removals */}
                  {removedIndexes.length > 0 && (
                    <div className="px-5 py-2.5 bg-rose-50/70 border-b border-rose-200 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">
                        Pending removal ({removedIndexes.length})
                      </span>
                      {removedIndexes.map(index => (
                        <span key={index} className="inline-flex items-center gap-1.5 bg-white border border-rose-200 text-rose-700 text-[10px] font-bold px-2 py-1 rounded-lg">
                          {index}
                          <button
                            onClick={() => restoreIndex(index)}
                            title={`Keep ${index}`}
                            aria-label={`Restore ${index}`}
                            className="text-rose-400 hover:text-rose-700 cursor-pointer"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      <span className="text-[10px] text-rose-500">Deleted from the database when you save.</span>
                    </div>
                  )}

                  {/* Summary panel */}
                  {isSummaryOpen && (
                    <div className="p-4 sm:p-5 pb-0">
                      <MarksheetSummary
                        rows={summaryRows}
                        moduleName={activeModule.name}
                        showComparison={showComparison}
                        onExport={handleExportCsv}
                        onClose={() => setIsSummaryOpen(false)}
                        excludedCount={ineligibleCount}
                      />
                    </div>
                  )}

                  <div className="p-5">
                    {/* ── CA Marks Grid ─────────────────────────────────────── */}
                    {marksTab === "ca_marks" && (
                      <div className="space-y-4">
                        {caComponents.length === 0 && (
                          <p className="text-sm text-neutral-400 italic text-center py-8">No CA components defined. Set up the blueprint first.</p>
                        )}
                        {students.length === 0 && caComponents.length > 0 && (
                          <div className="border-2 border-dashed border-neutral-200 rounded-xl p-8 text-center space-y-2">
                            <p className="text-sm text-neutral-500 font-semibold">No students on this marksheet yet.</p>
                            <p className="text-xs text-neutral-400">Add them one by one, or paste the whole class roster with “Bulk add”.</p>
                          </div>
                        )}

                        {caComponents.length > 0 && (() => {
                          const groupOf = (comp: CaComponent) => comp.group ?? caGroupOf(comp.type);
                          // One component occupies: its question columns + Tot + AB.
                          const spanOf = (comp: CaComponent) => componentQuestionKeys(comp).length + 2;
                          const spanA = caComponents.filter(c => groupOf(c) === "A").reduce((sum, c) => sum + spanOf(c), 0);
                          const spanB = caComponents.filter(c => groupOf(c) === "B").reduce((sum, c) => sum + spanOf(c), 0);

                          return (
                            <div className="border border-neutral-200 rounded-xl overflow-auto">
                              <table className="w-full text-xs text-left border-collapse">
                                <thead>
                                  {/* Level 1 — the two scoring groups */}
                                  <tr className="text-[10px] font-black uppercase tracking-wider border-b border-neutral-200">
                                    <th rowSpan={3} className="px-4 py-2.5 bg-neutral-50 text-neutral-500 w-44">Student No</th>
                                    {spanA > 0 && (
                                      <th colSpan={spanA} className="px-3 py-1.5 text-center bg-violet-100/80 text-violet-700">
                                        Group A · practical / performance · {groupWeightTotal("A")}%
                                      </th>
                                    )}
                                    {spanB > 0 && (
                                      <th colSpan={spanB} className="px-3 py-1.5 text-center bg-orange-100/80 text-orange-700">
                                        Group B · written / discrete · {groupWeightTotal("B")}%
                                      </th>
                                    )}
                                    <th rowSpan={3} className="px-3 py-2.5 text-center bg-indigo-50 text-indigo-700 border-l border-indigo-100 w-20">
                                      CA Total
                                      <span className="block text-[9px] font-normal normal-case tracking-normal">out of {caWeightTotal}</span>
                                    </th>
                                    <th rowSpan={3} className="px-2 py-2.5 text-center bg-neutral-50 text-neutral-500 w-16">Eligible</th>
                                    <th rowSpan={3} className="px-2 py-2.5 text-center bg-neutral-50 text-neutral-500 w-20">Edit</th>
                                  </tr>
                                  {/* Level 2 — components; clicking opens the drill-down */}
                                  <tr className="text-[10px] font-bold border-b border-neutral-200">
                                    {caComponents.map((comp, compIndex) => {
                                      const isGroupA = groupOf(comp) === "A";
                                      return (
                                        <th
                                          key={comp.id}
                                          colSpan={spanOf(comp)}
                                          className={`px-2 py-1.5 text-center ${isGroupA ? "bg-violet-50 text-violet-700" : "bg-orange-50 text-orange-700"}`}
                                        >
                                          <button
                                            onClick={() => setPopupCompId(comp.id)}
                                            title={`Open the ${comp.name || caTypeLabel(comp.type)} blueprint & per-question entry grid`}
                                            className="inline-flex items-center gap-1.5 hover:underline underline-offset-2 cursor-pointer"
                                          >
                                            <Maximize2 className="h-2.5 w-2.5" />
                                            {comp.name || `${caTypeLabel(comp.type)} component ${compIndex + 1}`}
                                          </button>
                                        </th>
                                      );
                                    })}
                                  </tr>
                                  {/* Level 3 — questions, component total, absent */}
                                  <tr className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-200">
                                    {caComponents.map(comp => {
                                      const isGroupA = groupOf(comp) === "A";
                                      return (
                                        <React.Fragment key={comp.id}>
                                          {componentQuestionKeys(comp).map(q => (
                                            <th key={q} className={`px-1 py-1.5 text-center w-14 ${isGroupA ? "bg-violet-50/60" : "bg-orange-50/50"}`}>
                                              {isGroupA ? "Mark" : q}
                                              <span className="block text-[8px] font-normal">/{componentQuestionMax(comp, q)}</span>
                                            </th>
                                          ))}
                                          <th className={`px-1 py-1.5 text-center w-14 ${isGroupA ? "bg-violet-50/60" : "bg-orange-50/50"}`}>Tot</th>
                                          <th className="px-1 py-1.5 text-center w-10 bg-neutral-50">AB</th>
                                        </React.Fragment>
                                      );
                                    })}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                  {visibleStudents.map(({ row, index }) => {
                                    const eligible = isRowEligible(row);
                                    const editable = !isReadOnly && editingRows.has(row.studentIndex);
                                    const weighted = computeWeightedScores(row, caComponents, finalBlueprint);
                                    const flagged = eligible && problemIndexes.has(row.studentIndex);

                                    return (
                                      <tr
                                        key={row.studentIndex}
                                        className={`transition-colors ${
                                          !eligible
                                            ? "bg-neutral-100/70 text-neutral-400"
                                            : editable
                                              ? "bg-indigo-50/40"
                                              : "hover:bg-neutral-50/40"
                                        }`}
                                      >
                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                          <span className="text-neutral-400 font-bold mr-1.5">{index + 1}</span>
                                          <span className="font-bold tracking-wider uppercase">{row.studentIndex}</span>
                                          {flagged && (
                                            <span title="This row still has marksheet issues" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
                                          )}
                                          {!eligible && (
                                            <span className="ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-neutral-200 text-neutral-500">
                                              Ineligible
                                            </span>
                                          )}
                                        </td>

                                        {caComponents.map(comp => {
                                          const isGroupA = groupOf(comp) === "A";
                                          const keys = componentQuestionKeys(comp);
                                          const isAbsent = !!row.isAbsentCa[comp.id];
                                          const compMarks = row.caQuestionsMarks[comp.id] ?? {};
                                          const required = componentRequiredAnswers(comp);
                                          const total = computeRowTotal(compMarks, required, comp.scoreMode);
                                          const answered = enteredMarks(compMarks).length;
                                          const short = eligible && !isAbsent && answered < required;

                                          return (
                                            <React.Fragment key={comp.id}>
                                              {keys.map(q => (
                                                <td key={q} className={`px-1 py-1.5 text-center ${short && compMarks[q] === undefined ? "bg-amber-50/60" : ""}`}>
                                                  {isAbsent ? (
                                                    <span className="text-neutral-400 font-bold text-[11px]">AB</span>
                                                  ) : editable ? (
                                                    <input
                                                      type="number" min="0" max={componentQuestionMax(comp, q)}
                                                      value={compMarks[q] ?? ""}
                                                      placeholder="0"
                                                      data-grid={`ca-${comp.id}`}
                                                      data-col={q}
                                                      data-row={index}
                                                      aria-label={`${row.studentIndex} ${q}`}
                                                      onChange={e => updateCAMark(row.studentIndex, comp.id, q, Number(e.target.value), componentQuestionMax(comp, q))}
                                                      onKeyDown={e => handleCellKeyDown(e, `ca-${comp.id}`, q, index)}
                                                      onPaste={e => handleCaPaste(e, comp, index, q)}
                                                      className={`w-12 bg-white border rounded py-1 text-center font-bold focus:outline-none ${isGroupA ? "focus:border-violet-400" : "focus:border-orange-400"} ${short && compMarks[q] === undefined ? "border-amber-300" : "border-neutral-200"}`}
                                                    />
                                                  ) : (
                                                    <span className="font-bold tabular-nums">
                                                      {compMarks[q] ?? <span className="text-neutral-300 font-normal">—</span>}
                                                    </span>
                                                  )}
                                                </td>
                                              ))}
                                              <td className="px-1 py-1.5 text-center font-extrabold text-indigo-600">
                                                {isAbsent
                                                  ? "AB"
                                                  : answered === 0
                                                    ? <span className="text-neutral-300 font-normal">—</span>
                                                    : total.toFixed(1)}
                                              </td>
                                              <td className="px-1 py-1.5 text-center">
                                                <button
                                                  disabled={isReadOnly}
                                                  onClick={() => toggleAbsentCA(row.studentIndex, comp.id)}
                                                  title={isAbsent ? "Mark present" : "Mark absent"}
                                                  className={`px-1.5 py-0.5 text-[9px] font-extrabold rounded cursor-pointer disabled:opacity-40 ${isAbsent ? "bg-rose-600 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-rose-50 hover:text-rose-600"}`}
                                                >
                                                  AB
                                                </button>
                                              </td>
                                            </React.Fragment>
                                          );
                                        })}

                                        <td className="px-3 py-2.5 text-center font-extrabold text-indigo-700 bg-indigo-50/40 border-l border-indigo-100 tabular-nums">
                                          {!eligible ? <span className="text-neutral-300">—</span> : weighted.ca.toFixed(1)}
                                        </td>
                                        <td className="px-2 py-2.5 text-center">
                                          <input
                                            type="checkbox"
                                            checked={eligible}
                                            disabled={isReadOnly}
                                            onChange={() => toggleEligible(row.studentIndex)}
                                            aria-label={`${row.studentIndex} eligible for this module`}
                                            title={eligible ? "Eligible — counts towards totals and submission" : "Ineligible — excluded from totals, CSV and PDF"}
                                            className="h-3.5 w-3.5 accent-emerald-600 cursor-pointer disabled:opacity-40"
                                          />
                                        </td>
                                        <td className="px-2 py-2.5 text-center">
                                          {!isReadOnly ? (
                                            <div className="flex items-center justify-center gap-1">
                                              <button
                                                onClick={() => toggleRowEdit(row.studentIndex)}
                                                title={editable ? `Done editing ${row.studentIndex}` : `Unlock ${row.studentIndex} for editing`}
                                                className={`h-6 w-6 rounded flex items-center justify-center cursor-pointer transition-colors ${editable ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-neutral-100 text-neutral-500 hover:bg-indigo-100 hover:text-indigo-700"}`}
                                              >
                                                {editable ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                                              </button>
                                              <button
                                                onClick={() => requestRemoveStudent(row)}
                                                aria-label={`Remove ${row.studentIndex}`}
                                                className="h-6 w-6 rounded flex items-center justify-center text-neutral-400 hover:text-rose-600 cursor-pointer"
                                              >
                                                <Trash2 className="h-3 w-3" />
                                              </button>
                                            </div>
                                          ) : (
                                            <span className="text-neutral-300">—</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  {visibleStudents.length === 0 && (
                                    <tr>
                                      <td colSpan={spanA + spanB + 4} className="px-4 py-8 text-center text-neutral-400 italic">
                                        {searchTerm ? `No student matches “${searchTerm}”.` : "No students added yet."}
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}

                        {!isReadOnly && caComponents.length > 0 && (
                          <p className="text-[10px] text-neutral-400">
                            The register reads like a register: rows stay view-only until you click the pencil on a row, and
                            the header button of a component opens its blueprint with the full per-question entry grid.
                            Group A takes one overall mark per student; Group B caps every question at its own weightage.
                            Untick <strong className="text-neutral-500">Eligible</strong> for students outside the cohort the HOD authorised —
                            they drop out of totals, the audit, CSV and PDF.
                          </p>
                        )}
                      </div>
                    )}

                    {/* ── Final Paper Grid ─────────────────────────────────── */}
                    {marksTab === "final_marks" && (
                      <div>
                        {!finalBlueprint.enabled ? (
                          <p className="text-sm text-neutral-400 italic text-center py-8">Final exam blueprint is not enabled. Enable it in the Blueprint Setup tab.</p>
                        ) : (
                          <div>
                            {/* Reconciliation / variance banner */}
                            {showComparison && (
                              <div className={`flex flex-wrap items-center gap-4 mb-4 p-3 rounded-xl border ${isReconciliationNeeded ? "bg-orange-50 border-orange-200" : "bg-amber-50 border-amber-200"}`}>
                                <div className="flex items-center gap-2">
                                  {isReconciliationNeeded
                                    ? <GitMerge className="h-4 w-4 text-orange-600" />
                                    : <ArrowLeftRight className="h-4 w-4 text-amber-600" />
                                  }
                                  <span className={`text-xs font-bold ${isReconciliationNeeded ? "text-orange-800" : "text-amber-800"}`}>
                                    {isReconciliationNeeded ? "Joint Reconciliation Review" : "Variance Analysis Mode"}
                                  </span>
                                  {isReconciliationNeeded && (
                                    <span className="text-[10px] text-orange-600">
                                      — Variance &gt; {VARIANCE_THRESHOLD} detected. Review and approve the Examiner&apos;s marks.
                                    </span>
                                  )}
                                </div>
                                {isReconciliationNeeded && !lecturerApproved && (
                                  <button
                                    onClick={handleApproveReconciliation}
                                    disabled={isApprovingReconciliation}
                                    className="ml-auto shrink-0 flex items-center gap-2 h-9 px-4 text-xs font-bold bg-orange-600 text-white rounded-xl hover:bg-orange-700 disabled:opacity-40 transition-all cursor-pointer"
                                  >
                                    {isApprovingReconciliation
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <CheckCircle2 className="h-3.5 w-3.5" />
                                    }
                                    Approve Examiner&apos;s Assessment
                                  </button>
                                )}
                                {isReconciliationNeeded && lecturerApproved && (
                                  <div className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Approved — Awaiting Examiner finalisation
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="flex items-center gap-3 mb-3 flex-wrap">
                              <div className="h-1 w-1 rounded-full bg-emerald-500" />
                              <h4 className="font-bold text-sm">Final Written Examination</h4>
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                {finalBlueprint.weightage}% · {finalBlueprint.questionsToAnswer}/{finalBlueprint.totalQuestions} Qs · {finalBlueprint.scoreMode} · max {finalBlueprint.questionsToAnswer * finalBlueprint.marksPerQuestion}
                              </span>
                            </div>

                            <div className="border border-neutral-200 rounded-xl overflow-auto">
                              <table className="w-full text-xs text-left border-collapse">
                                <thead>
                                  <tr className="bg-neutral-50 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-200">
                                    <th className="px-4 py-3 w-10">#</th>
                                    <th className="px-4 py-3 w-32">Student ID</th>
                                    {finalQs.map(q => (
                                      <th key={`lec-${q}`} className="px-2 py-3 text-center bg-emerald-50/40 w-14">
                                        {showComparison && <span className="block text-[8px] font-normal text-emerald-500 leading-none mb-0.5">Lec</span>}
                                        {q}<span className="block text-[9px] text-neutral-400 font-normal">/{finalBlueprint.marksPerQuestion}</span>
                                      </th>
                                    ))}
                                    <th className="px-4 py-3 text-center bg-emerald-100/60 text-emerald-700 w-16">
                                      {showComparison && <span className="block text-[8px] font-normal text-emerald-500 leading-none mb-0.5">Lec</span>}
                                      Total
                                    </th>
                                    <th className="px-4 py-3 text-center w-14">AB</th>
                                    {!isReadOnly && <th className="px-3 py-3 w-10" />}
                                    {showComparison && (
                                      <>
                                        <th className="px-2 py-3 w-8 bg-neutral-100">
                                          <ArrowLeftRight className="h-3 w-3 mx-auto text-neutral-400" />
                                        </th>
                                        {finalQs.map(q => (
                                          <th key={`exam-${q}`} className="px-2 py-3 text-center bg-amber-50/70 text-amber-800 w-14">
                                            <span className="block text-[8px] font-normal text-amber-500 leading-none mb-0.5">2nd</span>
                                            {q}<span className="block text-[9px] text-neutral-400 font-normal">/{finalBlueprint.marksPerQuestion}</span>
                                          </th>
                                        ))}
                                        <th className="px-4 py-3 text-center bg-amber-100/60 text-amber-700 font-extrabold w-16">
                                          <span className="block text-[8px] font-normal text-amber-500 leading-none mb-0.5">2nd</span>
                                          Total
                                        </th>
                                        <th className="px-4 py-3 text-center w-16 bg-rose-50/50 text-rose-700">Δ Var</th>
                                      </>
                                    )}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                  {visibleStudents.map(({ row, index }) => {
                                    const isAbsent = row.isAbsentFinal;
                                    const fm = row.finalExamQuestionsMarks ?? {};
                                    const sm = row.secondExamMarks ?? {};
                                    const lecTotal = computeRowTotal(fm, finalBlueprint.questionsToAnswer, finalBlueprint.scoreMode);
                                    const examTotal = computeRowTotal(sm, finalBlueprint.questionsToAnswer, finalBlueprint.scoreMode);
                                    const hasExamMarks = enteredMarks(sm).length > 0;
                                    const answered = enteredMarks(fm).length;
                                    const short = !isAbsent && answered < finalBlueprint.questionsToAnswer;
                                    const variance = showComparison && !isAbsent && hasExamMarks
                                      ? Math.abs(lecTotal - examTotal)
                                      : null;
                                    const flagged = variance !== null && variance > VARIANCE_THRESHOLD;

                                    return (
                                      <tr
                                        key={row.studentIndex}
                                        className={`transition-colors ${isAbsent ? "bg-neutral-100/60 text-neutral-400 line-through" : flagged ? "bg-rose-50/30" : short ? "bg-amber-50/40" : "hover:bg-neutral-50/40"}`}
                                      >
                                        <td className="px-4 py-3 font-bold text-neutral-400">
                                          {index + 1}
                                          {!isAbsent && problemIndexes.has(row.studentIndex) && (
                                            <span title="This row still has marksheet issues" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
                                          )}
                                        </td>
                                        <td className="px-4 py-3 font-bold tracking-wider uppercase">{row.studentIndex}</td>
                                        {finalQs.map(q => (
                                          <td key={`lec-${q}`} className="px-1.5 py-2 bg-emerald-50/10 text-center">
                                            {isAbsent ? (
                                              <span className="text-neutral-400 font-bold text-[11px]">AB</span>
                                            ) : (
                                              <input
                                                type="number" min="0" max={finalBlueprint.marksPerQuestion}
                                                value={fm[q] ?? ""}
                                                placeholder="0"
                                                disabled={isReadOnly || isAbsent}
                                                data-grid="final"
                                                data-col={q}
                                                data-row={index}
                                                aria-label={`${row.studentIndex} final ${q}`}
                                                onChange={e => updateFinalMark(row.studentIndex, q, Number(e.target.value))}
                                                onKeyDown={e => handleCellKeyDown(e, "final", q, index)}
                                                onPaste={e => handleFinalPaste(e, index, q)}
                                                className={`w-12 bg-white border rounded py-1 text-center font-bold focus:outline-none focus:border-emerald-400 disabled:opacity-40 ${short && !fm[q] ? "border-amber-300" : "border-neutral-200"}`}
                                              />
                                            )}
                                          </td>
                                        ))}
                                        <td className="px-4 py-3 text-center font-extrabold text-emerald-700">
                                          {isAbsent
                                            ? "AB"
                                            : answered === 0
                                              ? <span className="text-neutral-300">—</span>
                                              : lecTotal.toFixed(1)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                          <button
                                            disabled={isReadOnly}
                                            onClick={() => toggleAbsentFinal(row.studentIndex)}
                                            title={isAbsent ? "Mark present" : "Mark absent"}
                                            className={`px-2 py-1 text-[10px] font-extrabold rounded cursor-pointer disabled:opacity-40 ${isAbsent ? "bg-rose-600 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-rose-50 hover:text-rose-600"}`}
                                          >AB</button>
                                        </td>
                                        {!isReadOnly && (
                                          <td className="px-3 py-3 text-center">
                                            <button
                                              onClick={() => requestRemoveStudent(row)}
                                              aria-label={`Remove ${row.studentIndex}`}
                                              className="text-neutral-400 hover:text-rose-600 cursor-pointer"
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                          </td>
                                        )}
                                        {/* 2nd Examiner read-only cells */}
                                        {showComparison && (
                                          <>
                                            <td className="px-1 py-3 bg-neutral-100/80" />
                                            {finalQs.map(q => (
                                              <td key={`exam-${q}`} className="px-2 py-3 bg-amber-50/20 text-center">
                                                {isAbsent ? (
                                                  <span className="text-neutral-400 font-bold text-[11px]">AB</span>
                                                ) : (
                                                  <span className="inline-block w-10 py-1 text-center text-xs font-bold text-amber-700 bg-amber-50 rounded border border-amber-100">
                                                    {hasExamMarks ? (sm[q] ?? "—") : <span className="text-neutral-300 text-[10px]">—</span>}
                                                  </span>
                                                )}
                                              </td>
                                            ))}
                                            <td className="px-4 py-3 text-center font-extrabold text-amber-700 bg-amber-50/20">
                                              {isAbsent ? "AB" : (hasExamMarks ? examTotal.toFixed(1) : <span className="text-neutral-300 font-normal text-xs">—</span>)}
                                            </td>
                                            <td className="px-4 py-3 text-center bg-rose-50/20">
                                              {isAbsent || variance === null ? (
                                                <span className="text-neutral-300 text-xs">—</span>
                                              ) : flagged ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full">
                                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse inline-block" />
                                                  {variance.toFixed(1)}
                                                </span>
                                              ) : (
                                                <span className="text-[10px] font-bold text-emerald-600">{variance.toFixed(1)}</span>
                                              )}
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    );
                                  })}
                                  {visibleStudents.length === 0 && (
                                    <tr>
                                      <td colSpan={finalQs.length + (showComparison ? finalQs.length + 4 : 4) + (isReadOnly ? 0 : 1)} className="px-4 py-8 text-center text-neutral-400 italic">
                                        {searchTerm ? `No student matches “${searchTerm}”.` : "No students added yet."}
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Ledger action bar */}
                    {!isReadOnly && students.length > 0 && (
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-5 border-t border-neutral-100 mt-5">
                        <div className="text-[11px] text-neutral-400 max-w-md">
          <strong>Save Marks</strong> stores your ledger.
          {isSecondChecking
            ? " The marksheet is with the Examiner — recall it before making corrections."
            : " When every eligible row is complete, use "}
          {!isSecondChecking && <strong>Send to…</strong>}
          {!isSecondChecking && " to submit it to Faculty or the HOD."}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => saveMarks()}
                            disabled={isSaving || (!isDirty && removedIndexes.length === 0)}
                            title={!isDirty && removedIndexes.length === 0 ? "Everything is already saved" : ""}
                            className="flex items-center gap-2 h-10 px-5 text-xs font-bold bg-[#1a1a1a] text-white rounded-xl hover:bg-neutral-800 disabled:opacity-40 transition-all cursor-pointer"
                          >
                            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save Marks
                          </button>
                          {!isSecondChecking && (
                            <div className="relative">
                              <button
                                onClick={() => setIsSendMenuOpen(open => !open)}
                                disabled={isSubmitting || isSaving}
                                title={
                                  errorCount > 0
                                    ? `${errorCount} issue(s) must be fixed before sending`
                                    : "Choose who receives this submission"
                                }
                                className="flex items-center gap-2 h-10 px-5 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-all cursor-pointer"
                              >
                                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                Send to…
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isSendMenuOpen ? "rotate-180" : ""}`} />
                              </button>

                              {isSendMenuOpen && (
                                <>
                                  <div className="fixed inset-0 z-20" onClick={() => setIsSendMenuOpen(false)} aria-hidden="true" />
                                  <div className="absolute right-0 bottom-full mb-2 w-80 bg-white border border-neutral-200 rounded-xl shadow-xl z-30 p-1.5 space-y-1">
                                    <p className="px-3 pt-1.5 pb-1 text-[9px] font-black uppercase tracking-wider text-neutral-400">
                                      Submit this marksheet to
                                    </p>
                                    <button
                                      onClick={() => { setIsSendMenuOpen(false); handleSubmitForReview("FACULTY"); }}
                                      className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg hover:bg-indigo-50 text-left cursor-pointer transition-colors"
                                    >
                                      <GraduationCap className="h-4 w-4 mt-0.5 text-indigo-600 shrink-0" />
                                      <span>
                                        <span className="block text-xs font-bold text-neutral-800">Send to Faculty</span>
                                        <span className="block text-[10px] text-neutral-500 mt-0.5">
                                          The Second Examiner independently marks the final paper.
                                        </span>
                                      </span>
                                    </button>
                                    <button
                                      onClick={() => { setIsSendMenuOpen(false); handleSubmitForReview("HOD"); }}
                                      className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg hover:bg-indigo-50 text-left cursor-pointer transition-colors"
                                    >
                                      <Building2 className="h-4 w-4 mt-0.5 text-indigo-600 shrink-0" />
                                      <span>
                                        <span className="block text-xs font-bold text-neutral-800">Send to HOD</span>
                                        <span className="block text-[10px] text-neutral-500 mt-0.5">
                                          The Head of Department receives the submission for review.
                                        </span>
                                      </span>
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                          <button
                            onClick={handleExportPdf}
                            disabled={students.length === 0}
                            title="Print the grouped CA register to PDF"
                            className="flex items-center gap-2 h-10 px-5 text-xs font-bold bg-white border border-neutral-200 text-neutral-700 rounded-xl hover:bg-neutral-50 disabled:opacity-40 transition-all cursor-pointer"
                          >
                            <Printer className="h-3.5 w-3.5" />Export PDF
                          </button>
                          {isSecondChecking && (
                            <button
                              onClick={handleRecallSubmission}
                              disabled={isSubmitting}
                              className="flex items-center gap-2 h-10 px-5 text-xs font-bold bg-white border border-indigo-200 text-indigo-700 rounded-xl hover:bg-indigo-50 disabled:opacity-40 transition-all cursor-pointer"
                            >
                              {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                              Recall Submission
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {isReadOnly && students.length > 0 && (
                      <div className="flex items-center gap-2 pt-5 border-t border-neutral-100 mt-5 text-[11px] font-semibold text-neutral-500">
                        <ArrowDownToLine className="h-3.5 w-3.5" />
                        Read-only view — export this marksheet to CSV if you need a copy for moderation.
                        <button
                          onClick={handleExportCsv}
                          className="ml-auto flex items-center gap-1.5 h-8 px-3 text-xs font-bold bg-white border border-neutral-200 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors cursor-pointer"
                        >
                          <Download className="h-3.5 w-3.5" />Export CSV
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Component drill-down: blueprint + full per-question entry grid ──── */}
      {popupComponent && (
        <ComponentMarksDialog
          comp={popupComponent}
          rows={visibleStudents}
          isReadOnly={isReadOnly}
          onMark={updateCAMark}
          onToggleAbsent={toggleAbsentCA}
          onClose={() => setPopupCompId(null)}
        />
      )}

      {/* ── Confirmation dialog ─────────────────────────────────────────────── */}
      <ConfirmDialog
        isOpen={confirmState !== null}
        title={confirmState?.title ?? ""}
        body={confirmState?.body ?? null}
        confirmLabel={confirmState?.confirmLabel}
        tone={confirmState?.tone ?? "primary"}
        isBusy={isConfirmBusy}
        onCancel={() => setConfirmState(null)}
        onConfirm={async () => {
          if (!confirmState) return;
          setIsConfirmBusy(true);
          try {
            await confirmState.action();
          } finally {
            setIsConfirmBusy(false);
            setConfirmState(null);
          }
        }}
      />
    </div>
  );
}
