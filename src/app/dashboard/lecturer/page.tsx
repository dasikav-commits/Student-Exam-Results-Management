"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { ProfileSettingsDrawer } from "@/components/ProfileSettingsDrawer";
import {
  BookOpen, Plus, Trash2, Save, Loader2, AlertCircle, CheckCircle2,
  Lock, Sliders, UserPlus, FileText,
  ChevronDown, Key, Flame, Shield, GraduationCap, ClipboardList,
  BarChart2, Settings, ArrowLeftRight, ShieldOff, GitMerge, Bell,
  User, LogOut
} from "lucide-react";
import type { CaComponent, FinalBlueprint, DepartmentModule, StudentMarkRecord } from "@/types/hod";

// ─── Local state types ────────────────────────────────────────────────────────
type MainTab = "blueprint" | "marks";
type BlueprintSubTab = "ca" | "final";
type MarksSubTab = "ca_marks" | "final_marks";

const SCORE_MODES: { value: "SUM" | "AVG"; label: string }[] = [
  { value: "SUM", label: "Direct Sum (Σ)" },
  { value: "AVG", label: "Average (μ)" },
];

const CA_TYPES = ["QUIZ", "ASSIGNMENT", "MIDTERM", "LAB_REPORT", "PROJECT", "PRESENTATION"];

function calcRowTotal(
  marks: Record<string, number>,
  questionsToAnswer: number,
  scoreMode: "SUM" | "AVG"
): number {
  const vals = Object.values(marks).slice(0, questionsToAnswer);
  const sum = vals.reduce((a, b) => a + (b || 0), 0);
  if (scoreMode === "AVG") return questionsToAnswer > 0 ? sum / questionsToAnswer : 0;
  return sum;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function LecturerConsolePage() {
  const router = useRouter();
  const { user } = useRequireAuth();   // ← redirects to /login if no session
  const { logout } = useAuth();

  // Modules
  const [modules, setModules] = useState<DepartmentModule[]>([]);
  const [activeModule, setActiveModule] = useState<DepartmentModule | null>(null);

  // Blueprint state
  const [caComponents, setCaComponents] = useState<CaComponent[]>([]);
  const [finalBlueprint, setFinalBlueprint] = useState<FinalBlueprint>({
    enabled: false, weightage: 0, totalQuestions: 5,
    marksPerQuestion: 20, questionsToAnswer: 5, scoreMode: "SUM",
  });

  // Marks state
  const [students, setStudents] = useState<StudentMarkRecord[]>([]);
  const [newIndexInput, setNewIndexInput] = useState("");

  // UI state
  const [mainTab, setMainTab] = useState<MainTab>("blueprint");
  const [bpTab, setBpTab] = useState<BlueprintSubTab>("ca");
  const [marksTab, setMarksTab] = useState<MarksSubTab>("ca_marks");
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isApprovingReconciliation, setIsApprovingReconciliation] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // Variance threshold is fixed at 1 — no slider
  const VARIANCE_THRESHOLD = 1;

  const userCapabilities = user?.capabilities ?? { isHOD: false, isActiveLec: true, isExamLec: false };
  // isActiveLec gate — pure examiners who land here see a locked-down view
  const isActiveLec = userCapabilities.isActiveLec;
  const isFrozen = activeModule?.isFrozen ?? false;

  // ── Auth-guarded module fetch ───────────────────────────────────────────────
  useEffect(() => {
    // Not authenticated or dev fallback — don't fetch, just stop loading
    if (!user || !user.email) {
      setIsPageLoading(false);
      return;
    }

    async function loadModules() {
      setIsPageLoading(true);
      try {
        const res = await fetch(`/api/lecturer/modules?email=${encodeURIComponent(user!.email)}`);
        if (res.ok) {
          const data: DepartmentModule[] = await res.json();
          setModules(data);
          if (data.length > 0) selectModule(data[0]);
        }
      } catch (err) {
        console.error("Error loading modules:", err);
      } finally {
        setIsPageLoading(false);
      }
    }
    loadModules();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const selectModule = useCallback(async (mod: DepartmentModule) => {
    setActiveModule(mod);
    setFeedback(null);
    setStudents([]);

    const stats = (mod.stats as any) ?? {};
    setCaComponents(stats.caComponents ?? []);
    setFinalBlueprint(stats.finalBlueprint ?? {
      enabled: false, weightage: 0, totalQuestions: 5,
      marksPerQuestion: 20, questionsToAnswer: 5, scoreMode: "SUM",
    });

    try {
      const r = await fetch(`/api/lecturer/marks?moduleCode=${encodeURIComponent(mod.code)}`);
      if (r.ok) setStudents(await r.json());
    } catch {}
  }, []);

  const handleWorkspaceSwitch = (desk: "LECTURER" | "HOD" | "EXAMINER") => {
    setIsRoleMenuOpen(false);
    if (desk === "HOD") router.push("/dashboard/hod");
    if (desk === "EXAMINER") router.push("/dashboard/examiner");
  };

  // ── CA Component handlers ──────────────────────────────────────────────────
  const addCA = () =>
    setCaComponents([...caComponents, {
      id: crypto.randomUUID(), type: "ASSIGNMENT", name: "",
      weightage: 0, totalQuestions: 3, marksPerQuestion: 10,
      questionsToAnswer: 3, scoreMode: "SUM",
    }]);

  const removeCA = (id: string) => setCaComponents(caComponents.filter(c => c.id !== id));

  const updateCA = (id: string, field: keyof CaComponent, value: any) =>
    setCaComponents(caComponents.map(c => {
      if (c.id !== id) return c;
      const updated = { ...c, [field]: value };
      // questionsToAnswer cannot exceed totalQuestions
      if (field === "totalQuestions" && updated.questionsToAnswer > updated.totalQuestions)
        updated.questionsToAnswer = updated.totalQuestions;
      return updated;
    }));

  const caWeightTotal = caComponents.reduce((s, c) => s + (Number(c.weightage) || 0), 0);
  const grandWeightTotal = caWeightTotal + (Number(finalBlueprint.weightage) || 0);

  // ── Blueprint Save ─────────────────────────────────────────────────────────
  const handleSaveBlueprint = async () => {
    if (!activeModule) return;
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
        setFeedback({ type: "success", text: "Blueprint saved successfully." });
        setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: result.stats } : m));
        setActiveModule(prev => prev ? { ...prev, stats: result.stats } : null);
      } else {
        setFeedback({ type: "error", text: result.error ?? "Failed to save blueprint." });
      }
    } catch {
      setFeedback({ type: "error", text: "Network error. Please try again." });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Student mark helpers ───────────────────────────────────────────────────
  const addStudent = () => {
    const idx = newIndexInput.trim().toUpperCase();
    if (!idx) return;
    if (students.some(s => s.studentIndex === idx)) {
      alert("Student index already exists."); return;
    }
    setStudents([...students, {
      id: 0, moduleCode: activeModule?.code ?? "",
      studentIndex: idx,
      caQuestionsMarks: {}, finalExamQuestionsMarks: {},
      secondExamMarks: {},
      isAbsentCa: {}, isAbsentFinal: false,
    }]);
    setNewIndexInput("");
  };

  const removeStudent = (idx: string) => setStudents(s => s.filter(r => r.studentIndex !== idx));

  const updateCAMark = (studentIdx: string, compId: string, q: string, val: number, maxMarks: number) =>
    setStudents(prev => prev.map(s => {
      if (s.studentIndex !== studentIdx) return s;
      const compMarks = { ...(s.caQuestionsMarks[compId] ?? {}) };
      compMarks[q] = Math.min(maxMarks, Math.max(0, val));
      return { ...s, caQuestionsMarks: { ...s.caQuestionsMarks, [compId]: compMarks } };
    }));

  const updateFinalMark = (studentIdx: string, q: string, val: number) =>
    setStudents(prev => prev.map(s => {
      if (s.studentIndex !== studentIdx) return s;
      const fm = { ...s.finalExamQuestionsMarks };
      fm[q] = Math.min(finalBlueprint.marksPerQuestion, Math.max(0, val));
      return { ...s, finalExamQuestionsMarks: fm };
    }));

  const toggleAbsentCA = (studentIdx: string, compId: string) =>
    setStudents(prev => prev.map(s => {
      if (s.studentIndex !== studentIdx) return s;
      const absent = !s.isAbsentCa[compId];
      const newIsAbsent = { ...s.isAbsentCa, [compId]: absent };
      const newCAMarks = { ...s.caQuestionsMarks };
      if (absent) newCAMarks[compId] = {};
      return { ...s, isAbsentCa: newIsAbsent, caQuestionsMarks: newCAMarks };
    }));

  const toggleAbsentFinal = (studentIdx: string) =>
    setStudents(prev => prev.map(s => {
      if (s.studentIndex !== studentIdx) return s;
      const absent = !s.isAbsentFinal;
      return { ...s, isAbsentFinal: absent, finalExamQuestionsMarks: absent ? {} : s.finalExamQuestionsMarks };
    }));

  const handleSaveMarks = async () => {
    if (!activeModule) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/lecturer/marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleCode: activeModule.code, students }),
      });
      const result = await res.json();
      if (res.ok) {
        setFeedback({ type: "success", text: "Marks saved. Students: " + students.length + "." });
        // Refresh the module to get updated status
        setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: { ...((m.stats as any) ?? {}), marksheetStatus: "MARKING" } } : m));
      } else {
        setFeedback({ type: "error", text: result.error ?? "Failed to save marks." });
      }
    } catch {
      setFeedback({ type: "error", text: "Network error. Please try again." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (!activeModule) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/lecturer/modules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleCode: activeModule.code, marksheetStatus: "SECOND_CHECKING" }),
      });
      const result = await res.json();
      if (res.ok) {
        setFeedback({ type: "success", text: "Marksheet submitted for second checking by the Examiner." });
        setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: { ...((m.stats as any) ?? {}), marksheetStatus: "SECOND_CHECKING" } } : m));
        setActiveModule(prev => prev ? { ...prev, stats: { ...((prev.stats as any) ?? {}), marksheetStatus: "SECOND_CHECKING" } } : null);
      } else {
        setFeedback({ type: "error", text: result.error ?? "Failed to submit for review." });
      }
    } catch {
      setFeedback({ type: "error", text: "Network error. Please try again." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleApproveReconciliation = async () => {
    if (!activeModule) return;
    setIsApprovingReconciliation(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/lecturer/marks/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleCode: activeModule.code }),
      });
      const result = await res.json();
      if (res.ok) {
        setFeedback({ type: "success", text: "Marksheet approved. The Examiner can now finalise the reconciliation." });
        const newStats = { ...((activeModule.stats as any) ?? {}), lecturerApproved: true };
        setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: newStats } : m));
        setActiveModule(prev => prev ? { ...prev, stats: newStats } : null);
      } else {
        setFeedback({ type: "error", text: result.error ?? "Failed to approve marksheet." });
      }
    } catch {
      setFeedback({ type: "error", text: "Network error. Please try again." });
    } finally {
      setIsApprovingReconciliation(false);
    }
  };

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (isPageLoading) {
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

  const questions = (n: number) => Array.from({ length: n }, (_, i) => `Q${i + 1}`);
  const finalQs = finalBlueprint.enabled ? questions(finalBlueprint.totalQuestions) : [];

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
          </div>
          <div className="divide-y divide-neutral-100">
            {modules.length === 0 && (
              <div className="p-6 text-center text-xs text-neutral-400 italic">
                No modules assigned to your account.
              </div>
            )}
            {modules.map(mod => {
              const selected = activeModule?.code === mod.code;
              const modStatus = (mod.stats as any)?.marksheetStatus as string | undefined;
              const needsReview = modStatus === "RECONCILIATION_NEEDED";
              return (
                <button
                  key={mod.id}
                  onClick={() => selectModule(mod)}
                  className={`w-full text-left p-4 transition-all flex justify-between items-center cursor-pointer ${selected ? "bg-indigo-50/60 border-r-4 border-indigo-600" : "hover:bg-neutral-50/50"}`}
                >
                  <div>
                    <p className={`font-bold text-sm ${selected ? "text-indigo-700" : "text-[#1a1a1a]"}`}>{mod.code}</p>
                    <p className="text-[11px] text-neutral-400 mt-0.5 leading-tight">{mod.name}</p>
                    {mod.roleInModule === "EXAMINER" && (
                      <span className="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wide">Examiner</span>
                    )}
                    {needsReview && (
                      <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 uppercase tracking-wide animate-pulse">
                        <Bell className="h-2.5 w-2.5" />Review Needed
                      </span>
                    )}
                  </div>
                  {mod.isFrozen && <Lock className="h-3.5 w-3.5 text-neutral-400 shrink-0" />}
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
              {(() => {
                const pendingCount = modules.filter(m => (m.stats as any)?.marksheetStatus === "RECONCILIATION_NEEDED" && !((m.stats as any)?.lecturerApproved)).length;
                return pendingCount > 0 ? (
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-center gap-3">
                    <div className="p-2 bg-orange-100 rounded-lg shrink-0">
                      <Bell className="h-4 w-4 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-orange-800">{pendingCount} module(s) require your review and approval</p>
                      <p className="text-[11px] text-orange-600 mt-0.5">The Second Examiner has flagged a variance in the marks. Review the comparison below and approve before they can finalise.</p>
                    </div>
                    <GitMerge className="h-5 w-5 text-orange-400 shrink-0" />
                  </div>
                ) : null;
              })()}
              {/* Module header badge */}
              <div className="bg-white rounded-2xl premium-border p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full">{activeModule.code}</span>
                    {isFrozen && <span className="text-xs font-bold bg-red-100 text-red-700 px-2.5 py-1 rounded-full flex items-center gap-1"><Lock className="h-3 w-3" />FROZEN</span>}
                    {activeModule.roleInModule === "EXAMINER" && <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full flex items-center gap-1"><Shield className="h-3 w-3" />Examiner View</span>}
                    {/* Marksheet status badge */}
                    {(() => {
                      const status = (activeModule.stats as any)?.marksheetStatus as string | undefined;
                      const colors: Record<string, string> = {
                        DRAFT: "bg-neutral-100 text-neutral-500",
                        MARKING: "bg-amber-100 text-amber-700",
                        SECOND_CHECKING: "bg-indigo-100 text-indigo-700",
                        FINALIZED: "bg-emerald-100 text-emerald-700",
                        RECONCILIATION_NEEDED: "bg-orange-100 text-orange-700 animate-pulse",
                        RECONCILED: "bg-teal-100 text-teal-700",
                      };
                      const labels: Record<string, string> = {
                        DRAFT: "Draft", MARKING: "Marking", SECOND_CHECKING: "2nd Check",
                        FINALIZED: "Finalized", RECONCILIATION_NEEDED: "Reconciliation Needed", RECONCILED: "Reconciled",
                      };
                      const key = status ?? "DRAFT";
                      return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${colors[key] ?? colors.DRAFT}`}>{labels[key] ?? key}</span>;
                    })()}
                  </div>
                  <h2 className="text-lg font-black mt-1">{activeModule.name}</h2>
                  <p className="text-xs text-neutral-400 mt-0.5">{activeModule.credits} Credits</p>
                </div>
                <div className="text-right text-xs space-y-1">
                  {activeModule.assignedActiveLec && <p className="text-neutral-500">Active Lec: <span className="font-bold text-neutral-800">{activeModule.assignedActiveLec.fullName}</span></p>}
                  {activeModule.assignedExamLec && <p className="text-neutral-500">Examiner: <span className="font-bold text-neutral-800">{activeModule.assignedExamLec.fullName}</span></p>}
                </div>
              </div>

              {/* Frozen overlay notice */}
              {isFrozen && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2.5 text-xs font-semibold text-red-700">
                  <Lock className="h-4 w-4 shrink-0" />
                  This module is frozen by the HOD. All inputs are read-only and saving is disabled.
                </div>
              )}

              {/* Feedback message */}
              {feedback && (
                <div className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs font-semibold ${feedback.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                  {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                  {feedback.text}
                </div>
              )}

              {/* ── Main tab bar ─────────────────────────────────────────────── */}
              <div className="flex gap-2">
                {([
                  { id: "blueprint" as MainTab, label: "Blueprint Setup", icon: <Settings className="h-3.5 w-3.5" /> },
                  { id: "marks" as MainTab, label: "Marks Ledger", icon: <ClipboardList className="h-3.5 w-3.5" /> },
                ] as const).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => { setMainTab(tab.id); setFeedback(null); }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${mainTab === tab.id ? "bg-[#1a1a1a] text-white border-[#1a1a1a]" : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"}`}
                  >
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>

              {/* ══════════════════════════════════════════════════════════════════
                  PANEL B — BLUEPRINT BUILDER
              ══════════════════════════════════════════════════════════════════ */}
              {mainTab === "blueprint" && (
                <div className={`bg-white rounded-2xl premium-border overflow-hidden ${isFrozen ? "opacity-60 pointer-events-none" : ""}`}>
                  {/* Blueprint sub-tabs */}
                  <div className="border-b border-neutral-200 bg-neutral-50/60 px-5 py-3 flex gap-2">
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
                        <div className="flex justify-between items-center">
                          <div>
                            <h3 className="font-bold text-sm">Continuous Assessment Components</h3>
                            <p className="text-xs text-neutral-400 mt-0.5">Define each CA component with its scoring structure.</p>
                          </div>
                          <button onClick={addCA} className="flex items-center gap-1.5 h-8 px-3 text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer">
                            <Plus className="h-3.5 w-3.5" />Add Component
                          </button>
                        </div>

                        {caComponents.length === 0 && (
                          <div className="border-2 border-dashed border-neutral-200 rounded-xl p-8 text-center text-sm text-neutral-400">
                            No CA components yet. Click "Add Component" to start.
                          </div>
                        )}

                        {caComponents.map((comp, idx) => (
                          <div key={comp.id} className="border border-neutral-200 rounded-xl p-4 space-y-3 bg-neutral-50/30">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-black text-indigo-600 uppercase tracking-wider">Component {idx + 1}</span>
                              <button onClick={() => removeCA(comp.id)} className="p-1.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              {/* Type */}
                              <div>
                                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Type</label>
                                <select value={comp.type} onChange={e => updateCA(comp.id, "type", e.target.value)} className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:border-indigo-500">
                                  {CA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>

                              {/* Name */}
                              <div className="sm:col-span-2">
                                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Name</label>
                                <input type="text" value={comp.name} onChange={e => updateCA(comp.id, "name", e.target.value)} placeholder="e.g. Mid-Semester Quiz" className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-indigo-500" />
                              </div>

                              {/* Weightage */}
                              <div>
                                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Weightage (%)</label>
                                <input type="number" min="0" max="100" value={comp.weightage || ""} onChange={e => updateCA(comp.id, "weightage", Number(e.target.value))} className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:border-indigo-500 text-right" />
                              </div>

                              {/* Total Questions */}
                              <div>
                                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Total Qs</label>
                                <input type="number" min="1" max="50" value={comp.totalQuestions} onChange={e => updateCA(comp.id, "totalQuestions", Number(e.target.value))} className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:border-indigo-500 text-right" />
                              </div>

                              {/* Marks Per Q */}
                              <div>
                                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Marks/Q</label>
                                <input type="number" min="1" value={comp.marksPerQuestion} onChange={e => updateCA(comp.id, "marksPerQuestion", Number(e.target.value))} className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:border-indigo-500 text-right" />
                              </div>

                              {/* Questions to Answer */}
                              <div>
                                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Qs to Answer</label>
                                <input type="number" min="1" max={comp.totalQuestions} value={comp.questionsToAnswer} onChange={e => updateCA(comp.id, "questionsToAnswer", Math.min(comp.totalQuestions, Number(e.target.value)))} className="w-full bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:border-indigo-500 text-right" />
                              </div>

                              {/* Score Mode */}
                              <div className="sm:col-span-2">
                                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Score Mode</label>
                                <div className="flex gap-2">
                                  {SCORE_MODES.map(m => (
                                    <button key={m.value} onClick={() => updateCA(comp.id, "scoreMode", m.value)} className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${comp.scoreMode === m.value ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"}`}>
                                      {m.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Component summary */}
                            <div className="bg-indigo-50/40 rounded-lg px-3 py-2 flex gap-4 text-[11px] font-semibold text-indigo-700">
                              <span>Max raw: {comp.totalQuestions * comp.marksPerQuestion}</span>
                              <span>Answer: {comp.questionsToAnswer} of {comp.totalQuestions}</span>
                              <span>Mode: {comp.scoreMode}</span>
                            </div>
                          </div>
                        ))}

                        {/* CA Weight Summary */}
                        <div className="flex justify-between items-center p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs font-bold">
                          <span className="text-neutral-600">CA Total Weightage:</span>
                          <span className={caWeightTotal + Number(finalBlueprint.weightage) === 100 ? "text-emerald-600" : "text-rose-600"}>{caWeightTotal}%</span>
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
                              onClick={() => setFinalBlueprint(f => ({ ...f, enabled: !f.enabled }))}
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
                              {questions(finalBlueprint.totalQuestions).map(q => (
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

                    {/* Save Blueprint */}
                    {!isFrozen && (
                      <div className="flex justify-end pt-4 border-t border-neutral-100">
                        <button
                          onClick={handleSaveBlueprint}
                          disabled={isSaving || grandWeightTotal !== 100}
                          title={grandWeightTotal !== 100 ? `Weights must total 100% (currently ${grandWeightTotal}%)` : ""}
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
                  {/* Marks sub-tabs */}
                  <div className="border-b border-neutral-200 bg-neutral-50/60 px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex gap-2">
                      <button onClick={() => setMarksTab("ca_marks")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${marksTab === "ca_marks" ? "bg-orange-500 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
                        <BarChart2 className="h-3.5 w-3.5" />CA Evaluation Grid
                      </button>
                      <button onClick={() => setMarksTab("final_marks")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${marksTab === "final_marks" ? "bg-orange-500 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
                        <FileText className="h-3.5 w-3.5" />Final Paper Grid
                      </button>
                    </div>

                    {/* Add student row */}
                    {!isFrozen && (
                      <div className="flex gap-2 sm:ml-auto">
                        <input
                          type="text"
                          placeholder="Student Index (e.g. 23001)"
                          value={newIndexInput}
                          onChange={e => setNewIndexInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && addStudent()}
                          className="h-8 px-3 bg-white border border-neutral-200 rounded-lg text-xs font-bold uppercase tracking-wider focus:outline-none focus:border-indigo-500 w-52"
                        />
                        <button onClick={addStudent} className="h-8 px-3 bg-indigo-600 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 hover:bg-indigo-700 transition-colors cursor-pointer">
                          <UserPlus className="h-3.5 w-3.5" />Add
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-5">
                    {/* ── CA Marks Grid ─────────────────────────────────────── */}
                    {marksTab === "ca_marks" && (
                      <div className="space-y-8">
                        {caComponents.length === 0 && (
                          <p className="text-sm text-neutral-400 italic text-center py-8">No CA components defined. Set up the blueprint first.</p>
                        )}
                        {caComponents.map(comp => {
                          const compQs = questions(comp.totalQuestions);
                          return (
                            <div key={comp.id}>
                              <div className="flex items-center gap-3 mb-3">
                                <div className="h-1 w-1 rounded-full bg-orange-500" />
                                <h4 className="font-bold text-sm">{comp.name || `Component (${comp.type})`}</h4>
                                <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full border border-orange-100">{comp.weightage}% · {comp.questionsToAnswer}/{comp.totalQuestions} Qs · {comp.scoreMode}</span>
                              </div>
                              <div className="border border-neutral-200 rounded-xl overflow-auto">
                                <table className="w-full text-xs text-left border-collapse">
                                  <thead>
                                    <tr className="bg-neutral-50 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-200">
                                      <th className="px-4 py-3 w-10">#</th>
                                      <th className="px-4 py-3 w-32">Student ID</th>
                                      {compQs.map(q => (
                                        <th key={q} className="px-2 py-3 text-center bg-orange-50/50 w-14">{q}<span className="block text-[9px] text-neutral-400 font-normal">/{comp.marksPerQuestion}</span></th>
                                      ))}
                                      <th className="px-4 py-3 text-center bg-indigo-50/60 text-indigo-700 w-16">Total</th>
                                      <th className="px-4 py-3 text-center w-14">AB</th>
                                      {!isFrozen && <th className="px-3 py-3 w-10" />}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-neutral-100">
                                    {students.map((s, idx) => {
                                      const isAbsent = !!s.isAbsentCa[comp.id];
                                      const compMarks = s.caQuestionsMarks[comp.id] ?? {};
                                      const total = isAbsent ? null : calcRowTotal(compMarks, comp.questionsToAnswer, comp.scoreMode);
                                      return (
                                        <tr key={s.studentIndex} className={`transition-colors ${isAbsent ? "bg-neutral-100/60 text-neutral-400 line-through" : "hover:bg-neutral-50/40"}`}>
                                          <td className="px-4 py-3 font-bold text-neutral-400">{idx + 1}</td>
                                          <td className="px-4 py-3 font-bold tracking-wider uppercase">{s.studentIndex}</td>
                                          {compQs.map(q => (
                                            <td key={q} className="px-1.5 py-2 bg-orange-50/10 text-center">
                                              {isAbsent ? (
                                                <span className="text-neutral-400 font-bold text-[11px]">AB</span>
                                              ) : (
                                                <input
                                                  type="number" min="0" max={comp.marksPerQuestion}
                                                  value={compMarks[q] ?? ""}
                                                  placeholder="0"
                                                  disabled={isFrozen || isAbsent}
                                                  onChange={e => updateCAMark(s.studentIndex, comp.id, q, Number(e.target.value), comp.marksPerQuestion)}
                                                  className="w-12 bg-white border border-neutral-200 rounded py-1 text-center font-bold focus:outline-none focus:border-orange-400 disabled:opacity-40"
                                                />
                                              )}
                                            </td>
                                          ))}
                                          <td className="px-4 py-3 text-center font-extrabold text-indigo-600">
                                            {isAbsent ? "AB" : total?.toFixed(1)}
                                          </td>
                                          <td className="px-4 py-3 text-center">
                                            <button
                                              disabled={isFrozen}
                                              onClick={() => toggleAbsentCA(s.studentIndex, comp.id)}
                                              className={`px-2 py-1 text-[10px] font-extrabold rounded cursor-pointer disabled:opacity-40 ${isAbsent ? "bg-rose-600 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-rose-50 hover:text-rose-600"}`}
                                            >AB</button>
                                          </td>
                                          {!isFrozen && (
                                            <td className="px-3 py-3 text-center">
                                              <button onClick={() => removeStudent(s.studentIndex)} className="text-neutral-400 hover:text-rose-600 cursor-pointer">
                                                <Trash2 className="h-3.5 w-3.5" />
                                              </button>
                                            </td>
                                          )}
                                        </tr>
                                      );
                                    })}
                                    {students.length === 0 && (
                                      <tr><td colSpan={compQs.length + 5} className="px-4 py-8 text-center text-neutral-400 italic">No students added yet.</td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ── Final Paper Grid ─────────────────────────────────── */}
                    {marksTab === "final_marks" && (
                      <div>
                        {!finalBlueprint.enabled ? (
                          <p className="text-sm text-neutral-400 italic text-center py-8">Final exam blueprint is not enabled. Enable it in the Blueprint Setup tab.</p>
                        ) : (
                          <div>
                            {/* Header row with variance analysis (if finalized or reconciliation) */}
                            {(() => {
                              const activeStatus = (activeModule?.stats as any)?.marksheetStatus as string | undefined;
                              const showComparison = activeStatus === "FINALIZED" || activeStatus === "RECONCILIATION_NEEDED" || activeStatus === "RECONCILED";
                              const isReconciliationNeeded = activeStatus === "RECONCILIATION_NEEDED";
                              const lecturerAlreadyApproved = (activeModule?.stats as any)?.lecturerApproved === true;
                              return showComparison ? (
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
                                  {isReconciliationNeeded && !lecturerAlreadyApproved && (
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
                                  {isReconciliationNeeded && lecturerAlreadyApproved && (
                                    <div className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg">
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Approved — Awaiting Examiner finalisation
                                    </div>
                                  )}
                                </div>
                              ) : null;
                            })()}

                            <div className="flex items-center gap-3 mb-3">
                              <div className="h-1 w-1 rounded-full bg-emerald-500" />
                              <h4 className="font-bold text-sm">Final Written Examination</h4>
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">{finalBlueprint.weightage}% · {finalBlueprint.questionsToAnswer}/{finalBlueprint.totalQuestions} Qs · {finalBlueprint.scoreMode}</span>
                            </div>
                            {(() => {
                              const activeStatus = (activeModule?.stats as any)?.marksheetStatus as string | undefined;
                              const showComparison = activeStatus === "FINALIZED" || activeStatus === "RECONCILIATION_NEEDED" || activeStatus === "RECONCILED";
                              return (
                                <div className="border border-neutral-200 rounded-xl overflow-auto">
                                  <table className="w-full text-xs text-left border-collapse">
                                    <thead>
                                      <tr className="bg-neutral-50 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-200">
                                        <th className="px-4 py-3 w-10">#</th>
                                        <th className="px-4 py-3 w-32">Student ID</th>
                                        {/* Active Lec (own) columns */}
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
                                        {!isFrozen && <th className="px-3 py-3 w-10" />}
                                        {/* 2nd Examiner comparison columns — only after showComparison */}
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
                                      {students.map((s, idx) => {
                                        const isAbsent = s.isAbsentFinal;
                                        const fm = s.finalExamQuestionsMarks ?? {};
                                        const sm = s.secondExamMarks ?? {};
                                        const lecTotal = isAbsent ? null : calcRowTotal(fm, finalBlueprint.questionsToAnswer, finalBlueprint.scoreMode);
                                        const examTotal = isAbsent ? null : calcRowTotal(sm, finalBlueprint.questionsToAnswer, finalBlueprint.scoreMode);
                                        const hasExamMarks = Object.keys(sm).length > 0;
                                        const variance = showComparison && lecTotal !== null && examTotal !== null && hasExamMarks
                                          ? Math.abs(lecTotal - examTotal)
                                          : null;
                                        const flagged = variance !== null && variance > VARIANCE_THRESHOLD;
                                        return (
                                          <tr key={s.studentIndex} className={`transition-colors ${isAbsent ? "bg-neutral-100/60 text-neutral-400 line-through" : flagged ? "bg-rose-50/30" : "hover:bg-neutral-50/40"}`}>
                                            <td className="px-4 py-3 font-bold text-neutral-400">{idx + 1}</td>
                                            <td className="px-4 py-3 font-bold tracking-wider uppercase">{s.studentIndex}</td>
                                            {/* Active Lec editable cells */}
                                            {finalQs.map(q => (
                                              <td key={`lec-${q}`} className="px-1.5 py-2 bg-emerald-50/10 text-center">
                                                {isAbsent ? (
                                                  <span className="text-neutral-400 font-bold text-[11px]">AB</span>
                                                ) : (
                                                  <input
                                                    type="number" min="0" max={finalBlueprint.marksPerQuestion}
                                                    value={fm[q] ?? ""}
                                                    placeholder="0"
                                                    disabled={isFrozen || isAbsent}
                                                    onChange={e => updateFinalMark(s.studentIndex, q, Number(e.target.value))}
                                                    className="w-12 bg-white border border-neutral-200 rounded py-1 text-center font-bold focus:outline-none focus:border-emerald-400 disabled:opacity-40"
                                                  />
                                                )}
                                              </td>
                                            ))}
                                            <td className="px-4 py-3 text-center font-extrabold text-emerald-700">
                                              {isAbsent ? "AB" : lecTotal?.toFixed(1)}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                              <button
                                                disabled={isFrozen}
                                                onClick={() => toggleAbsentFinal(s.studentIndex)}
                                                className={`px-2 py-1 text-[10px] font-extrabold rounded cursor-pointer disabled:opacity-40 ${isAbsent ? "bg-rose-600 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-rose-50 hover:text-rose-600"}`}
                                              >AB</button>
                                            </td>
                                            {!isFrozen && (
                                              <td className="px-3 py-3 text-center">
                                                <button onClick={() => removeStudent(s.studentIndex)} className="text-neutral-400 hover:text-rose-600 cursor-pointer">
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
                                                  {isAbsent ? "AB" : (hasExamMarks ? examTotal?.toFixed(1) : <span className="text-neutral-300 font-normal text-xs">—</span>)}
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
                                      {students.length === 0 && (
                                        <tr><td colSpan={finalQs.length + (showComparison ? finalQs.length + 4 : 4) + (!isFrozen ? 1 : 0)} className="px-4 py-8 text-center text-neutral-400 italic">No students added yet.</td></tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Save Marks + Submit for Review */}
                    {!isFrozen && students.length > 0 && (
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-5 border-t border-neutral-100 mt-5">
                        <div className="text-[11px] text-neutral-400 max-w-md">
                          <strong>Save Marks</strong> stores data. When all marks are finalized,
                          click <strong>Submit for Review</strong> to notify the Examiner.
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveMarks}
                            disabled={isSaving}
                            className="flex items-center gap-2 h-10 px-5 text-xs font-bold bg-[#1a1a1a] text-white rounded-xl hover:bg-neutral-800 disabled:opacity-40 transition-all cursor-pointer"
                          >
                            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save Marks
                          </button>
                          {(activeModule.stats as any)?.finalBlueprint?.enabled && (
                            <button
                              onClick={handleSubmitForReview}
                              disabled={isSaving
                                || (activeModule.stats as any)?.marksheetStatus === "SECOND_CHECKING"
                                || (activeModule.stats as any)?.marksheetStatus === "FINALIZED"
                                || (activeModule.stats as any)?.marksheetStatus === "RECONCILIATION_NEEDED"
                                || (activeModule.stats as any)?.marksheetStatus === "RECONCILED"
                              }
                              title={
                                (activeModule.stats as any)?.marksheetStatus === "SECOND_CHECKING" ? "Already submitted" :
                                (activeModule.stats as any)?.marksheetStatus === "RECONCILIATION_NEEDED" ? "Reconciliation in progress" :
                                "Submit to Examiner for second marking"
                              }
                              className="flex items-center gap-2 h-10 px-5 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-all cursor-pointer"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Submit for Review
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}