"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
  ShieldCheck, BookOpen, Save, Loader2, AlertCircle, CheckCircle2,
  Lock, Users, Sliders, AlertTriangle, ChevronDown, Key, Flame,
  Eye, EyeOff, ArrowLeftRight, GitMerge, Clock
} from "lucide-react";
import type { StudentMarkRecord, ModuleStats } from "@/types/hod";

interface ExamModule {
  id: number;
  code: string;
  name: string;
  credits: number;
  isFrozen: boolean;
  stats: ModuleStats;
  assignedActiveLec?: { id: number; fullName: string } | null;
}

export default function ExaminerConsolePage() {
  const router = useRouter();
  const { user } = useRequireAuth();
  const { logout } = useAuth();

  const [modules, setModules] = useState<ExamModule[]>([]);
  const [activeModule, setActiveModule] = useState<ExamModule | null>(null);
  const [students, setStudents] = useState<StudentMarkRecord[]>([]);

  const [isPageLoading, setIsPageLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFinalisingReconciled, setIsFinalisingReconciled] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const [showActiveLecMarks, setShowActiveLecMarks] = useState(true);
  // Fixed variance threshold — no slider needed
  const VARIANCE_THRESHOLD = 1;

  const userCapabilities = user?.capabilities ?? { isHOD: false, isActiveLec: false, isExamLec: true };

  const handleWorkspaceSwitch = (ws: "LECTURER" | "HOD") => {
    setIsRoleMenuOpen(false);
    if (ws === "LECTURER") router.push("/dashboard/lecturer");
    if (ws === "HOD") router.push("/dashboard/hod");
  };

  // ── Load modules assigned to this examiner ────────────────────────────────
  useEffect(() => {
    if (!user || !user.email) {
      setIsPageLoading(false);
      return;
    }

    async function load() {
      setIsPageLoading(true);
      try {
        const res = await fetch(`/api/examiner/marks?email=${encodeURIComponent(user!.email)}`);
        if (res.ok) {
          const data: ExamModule[] = await res.json();
          setModules(data);
          if (data.length > 0) await selectModule(data[0]);
        }
      } catch (err) {
        console.error("Error loading examiner modules:", err);
      } finally {
        setIsPageLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const selectModule = useCallback(async (mod: ExamModule) => {
    setActiveModule(mod);
    setFeedback(null);
    setStudents([]);
    try {
      const res = await fetch(`/api/examiner/marks?moduleCode=${encodeURIComponent(mod.code)}`);
      if (res.ok) setStudents(await res.json());
    } catch (err) {
      console.error("Error loading marks:", err);
    }
  }, []);

  // ── Blueprint helpers ──────────────────────────────────────────────────────
  const finalBp = (activeModule?.stats as any)?.finalBlueprint;
  const questionCount = finalBp?.totalQuestions ?? 8;
  const marksPerQ = finalBp?.marksPerQuestion ?? 10;
  const scoreMode: "SUM" | "AVG" = finalBp?.scoreMode ?? "SUM";
  const questionsToAnswer: number = finalBp?.questionsToAnswer ?? questionCount;
  const questionsList = Array.from({ length: questionCount }, (_, i) => `Q${i + 1}`);

  const calcTotal = (marks: Record<string, number>): number => {
    const vals = Object.values(marks).slice(0, questionsToAnswer).map(v => Number(v) || 0);
    const sum = vals.reduce((a, b) => a + b, 0);
    return scoreMode === "AVG" && questionsToAnswer > 0 ? sum / questionsToAnswer : sum;
  };

  // ── Update SECOND EXAM marks (examiner's own entry) ────────────────────────
  const updateSecondMark = (studentIndex: string, q: string, val: number) => {
    setStudents(prev => prev.map(s => {
      if (s.studentIndex !== studentIndex) return s;
      const sm = { ...(s.secondExamMarks ?? {}), [q]: Math.min(marksPerQ, Math.max(0, val)) };
      return { ...s, secondExamMarks: sm };
    }));
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const absentCount = students.filter(s => s.isAbsentFinal).length;

  const flaggedStudents = students.filter(s => {
    if (s.isAbsentFinal) return false;
    const activeLecTotal = calcTotal(s.finalExamQuestionsMarks ?? {});
    const examTotal = calcTotal(s.secondExamMarks ?? {});
    const hasExamMarks = Object.keys(s.secondExamMarks ?? {}).length > 0;
    return hasExamMarks && Math.abs(activeLecTotal - examTotal) > VARIANCE_THRESHOLD;
  });

  const moduleStatus = (activeModule?.stats as any)?.marksheetStatus as string | undefined;
  const isFinalized = moduleStatus === "FINALIZED";
  const isReconciliationNeeded = moduleStatus === "RECONCILIATION_NEEDED";
  const isReconciled = moduleStatus === "RECONCILED";
  const isLecturerApproved = (activeModule?.stats as any)?.lecturerApproved === true;

  const handleSave = async (finalize = false) => {
    if (!activeModule) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/examiner/marks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleCode: activeModule.code,
          finalize,
          students: students.map(s => ({
            studentIndex: s.studentIndex,
            secondExamMarks: s.secondExamMarks ?? {},
            isAbsentFinal: s.isAbsentFinal,
          })),
        }),
      });
      const result = await res.json();
      if (res.ok) {
        if (finalize) {
          if (result.requiresReconciliation) {
            // Variance detected — needs Lecturer approval before finalising
            const msg = `${flaggedStudents.length} student(s) have a mark variance > ${VARIANCE_THRESHOLD}. The Active Lecturer has been notified and must approve before you can finalise.`;
            setFeedback({ type: "error", text: msg });
            const newStats = { ...(activeModule.stats as any), marksheetStatus: "RECONCILIATION_NEEDED", lecturerApproved: false };
            setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: newStats } : m));
            setActiveModule(prev => prev ? { ...prev, stats: newStats } : null);
          } else {
            setFeedback({ type: "success", text: "Marking finalised. The Active Lecturer can now see your marks for comparison." });
            const newStats = { ...(activeModule.stats as any), marksheetStatus: "FINALIZED" };
            setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: newStats } : m));
            setActiveModule(prev => prev ? { ...prev, stats: newStats } : null);
          }
        } else {
          setFeedback({ type: "success", text: "Second marking saved successfully." });
        }
      } else {
        setFeedback({ type: "error", text: result.error ?? "Failed to save marks." });
      }
    } catch {
      setFeedback({ type: "error", text: "Network error. Please retry." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinaliseReconciled = async () => {
    if (!activeModule) return;
    setIsFinalisingReconciled(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/examiner/marks/finalise-reconciled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleCode: activeModule.code }),
      });
      const result = await res.json();
      if (res.ok) {
        setFeedback({ type: "success", text: "Reconciliation finalised. The marksheet is now closed as RECONCILED." });
        const newStats = { ...(activeModule.stats as any), marksheetStatus: "RECONCILED" };
        setModules(prev => prev.map(m => m.code === activeModule.code ? { ...m, stats: newStats } : m));
        setActiveModule(prev => prev ? { ...prev, stats: newStats } : null);
      } else {
        setFeedback({ type: "error", text: result.error ?? "Failed to finalise reconciliation." });
      }
    } catch {
      setFeedback({ type: "error", text: "Network error. Please retry." });
    } finally {
      setIsFinalisingReconciled(false);
    }
  };

  if (isPageLoading) {
    return (
      <div className="min-h-screen bg-cream-canvas flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
        <p className="text-xs font-bold text-neutral-400 tracking-widest uppercase">Syncing Examiner Workload…</p>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-cream-canvas text-[#1a1a1a]">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 bg-white border-b border-neutral-200/80 px-6 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Wayamba Exam Portal</p>
              <h1 className="text-sm font-black text-[#1a1a1a] leading-none">Second Examiner Console</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs text-neutral-500 font-medium">{user?.fullName ?? user?.email}</span>

            <div className="relative">
              <button
                onClick={() => setIsRoleMenuOpen(!isRoleMenuOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition-all cursor-pointer"
              >
                <Flame className="h-3.5 w-3.5" />
                <span>Examiner Hub</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${isRoleMenuOpen ? "rotate-180" : ""}`} />
              </button>
              {isRoleMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsRoleMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-neutral-200 rounded-xl shadow-xl p-1.5 z-20 space-y-0.5 text-xs">
                    <div className="px-3 py-2 border-b border-neutral-100 mb-1">
                      <span className="font-black text-[#1a1a1a]">{user?.fullName}</span>
                      <span className="block text-[10px] text-neutral-400">{user?.email}</span>
                    </div>
                    {userCapabilities.isActiveLec && (
                      <button onClick={() => handleWorkspaceSwitch("LECTURER")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-neutral-50 text-neutral-700 font-semibold cursor-pointer">
                        <Sliders className="h-3.5 w-3.5 text-neutral-400" /><span>Lecturer Desk</span>
                      </button>
                    )}
                    {userCapabilities.isHOD && (
                      <button onClick={() => handleWorkspaceSwitch("HOD")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-neutral-50 text-neutral-700 font-semibold cursor-pointer">
                        <Key className="h-3.5 w-3.5 text-neutral-400" /><span>HOD Console</span>
                      </button>
                    )}
                    <button disabled className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 font-bold cursor-default">
                      <Flame className="h-3.5 w-3.5" /><span>Examiner Hub (Active)</span>
                    </button>
                    <div className="border-t border-neutral-100 pt-1 mt-1">
                      <button onClick={logout} className="w-full text-left px-3 py-2 text-rose-600 font-semibold rounded-lg hover:bg-rose-50 cursor-pointer">Sign Out</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto p-4 sm:p-6">

        {/* Role info banner */}
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <div className="p-2 bg-amber-100 rounded-lg shrink-0">
            <ShieldCheck className="h-4 w-4 text-amber-700" />
          </div>
          <div>
            <p className="text-xs font-bold text-amber-800">Second Examiner Access</p>
            <p className="text-[11px] text-amber-700 mt-0.5">
              You can enter your own independent marks for each student&apos;s final exam.
              The active lecturer&apos;s marks are shown as a <strong>guided reference</strong>.
              Your marks will only be visible to the active lecturer after you click <strong>Finalize Marking</strong>.
            </p>
          </div>
        </div>

        {/* Analytics row */}
        {activeModule && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-white rounded-xl premium-border p-4 flex items-center gap-3">
              <div className="p-2.5 bg-indigo-50 rounded-lg"><Users className="h-5 w-5 text-indigo-600" /></div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Total Students</p>
                <p className="text-xl font-black">{students.length} <span className="text-xs font-medium text-neutral-400">({absentCount} AB)</span></p>
              </div>
            </div>

            <div className="bg-white rounded-xl premium-border p-4 flex items-center gap-3">
              <div className={`p-2.5 rounded-lg ${flaggedStudents.length > 0 ? "bg-rose-50 animate-pulse" : "bg-emerald-50"}`}>
                <AlertTriangle className={`h-5 w-5 ${flaggedStudents.length > 0 ? "text-rose-600" : "text-emerald-600"}`} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Variance Flags <span className="font-normal">(threshold &gt; {VARIANCE_THRESHOLD})</span></p>
                <p className="text-xl font-black">{flaggedStudents.length}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl premium-border p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Active Lec Marks</p>
                <p className="text-xs font-semibold text-neutral-600 mt-0.5">Guided reference column</p>
              </div>
              <button
                onClick={() => setShowActiveLecMarks(v => !v)}
                className={`p-2.5 rounded-lg transition-all cursor-pointer ${showActiveLecMarks ? "bg-indigo-100 text-indigo-700" : "bg-neutral-100 text-neutral-400"}`}
                title={showActiveLecMarks ? "Hide active lecturer marks" : "Show active lecturer marks"}
              >
                {showActiveLecMarks ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 items-start">
          {/* ── Module sidebar ──────────────────────────────────────────── */}
          <aside className="bg-white rounded-2xl premium-border overflow-hidden sticky top-20">
            <div className="p-4 border-b border-neutral-200 bg-neutral-50/60 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-neutral-500" />
              <h2 className="font-bold text-xs uppercase tracking-wider text-neutral-600">Moderation Workload</h2>
            </div>
            <div className="divide-y divide-neutral-100">
              {modules.length === 0 && (
                <p className="p-6 text-center text-xs text-neutral-400 italic">No modules assigned to you as examiner.</p>
              )}
              {modules.map(mod => {
                const sel = activeModule?.code === mod.code;
                const status = (mod.stats as any)?.marksheetStatus as string | undefined;
                const statusColors: Record<string, string> = {
                  DRAFT: "text-neutral-400",
                  MARKING: "text-amber-600",
                  SECOND_CHECKING: "text-indigo-600",
                  FINALIZED: "text-emerald-600",
                };
                return (
                  <button key={mod.id} onClick={() => selectModule(mod)} className={`w-full text-left p-4 transition-all flex justify-between items-center cursor-pointer ${sel ? "bg-amber-50/60 border-r-4 border-amber-500" : "hover:bg-neutral-50/50"}`}>
                    <div>
                      <p className={`font-bold text-sm ${sel ? "text-amber-600" : ""}`}>{mod.code}</p>
                      <p className="text-[11px] text-neutral-400 mt-0.5 leading-tight">{mod.name}</p>
                      {status && (
                        <p className={`text-[10px] font-bold mt-0.5 uppercase tracking-wide ${statusColors[status] ?? "text-neutral-400"}`}>{status}</p>
                      )}
                    </div>
                    {mod.isFrozen && <Lock className="h-3.5 w-3.5 text-neutral-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </aside>

          {/* ── Second Marking Grid ─────────────────────────────────────── */}
          <div className="lg:col-span-3 bg-white rounded-2xl premium-border overflow-hidden">
            {!activeModule ? (
              <div className="p-16 text-center text-sm text-neutral-400 italic">Select a module to begin second marking.</div>
            ) : (
              <>
                <div className="p-5 border-b border-neutral-200 bg-neutral-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm">{activeModule.code} — Second Examiner Ledger</h3>
                      {isFinalized && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="h-3 w-3" />FINALIZED
                        </span>
                      )}
                      {isReconciliationNeeded && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full animate-pulse">
                          <GitMerge className="h-3 w-3" />RECONCILIATION NEEDED
                        </span>
                      )}
                      {isReconciled && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="h-3 w-3" />RECONCILED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {questionsList.length} questions · {questionsToAnswer} to answer · {marksPerQ} marks/q · {scoreMode} mode
                    </p>
                    {activeModule.assignedActiveLec && (
                      <p className="text-[11px] text-neutral-500 mt-1">Active Lec: <span className="font-bold text-neutral-700">{activeModule.assignedActiveLec.fullName}</span></p>
                    )}
                  </div>
                  {activeModule.isFrozen && (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg">
                      <Lock className="h-3.5 w-3.5" />Frozen by HOD
                    </span>
                  )}
                </div>

                <div className="p-5 space-y-4">
                  {feedback && (
                    <div className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs font-semibold ${feedback.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                      {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                      {feedback.text}
                    </div>
                  )}

                  {students.length === 0 ? (
                    <div className="border-2 border-dashed border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-400 italic">
                      No student mark records found for this module.<br />
                      <span className="text-xs">The active lecturer must save marks first.</span>
                    </div>
                  ) : (
                    <div className="border border-neutral-200 rounded-xl overflow-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-neutral-50 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-200 text-center">
                            <th className="px-4 py-3 w-10 text-left">#</th>
                            <th className="px-4 py-3 w-32 text-left">Student ID</th>

                            {/* Active Lec columns (guided reference) */}
                            {showActiveLecMarks && questionsList.map(q => (
                              <th key={`lec-${q}`} className="px-2 py-3 bg-indigo-50/60 text-indigo-700 w-14">
                                <span className="block text-[8px] font-normal text-indigo-400 leading-none mb-0.5">Lec</span>
                                {q}<span className="block text-[9px] text-neutral-400 font-normal">/{marksPerQ}</span>
                              </th>
                            ))}
                            {showActiveLecMarks && (
                              <th className="px-4 py-3 bg-indigo-100/60 text-indigo-700 font-extrabold w-16">
                                <span className="block text-[8px] font-normal text-indigo-400 leading-none mb-0.5">Lec</span>
                                Total
                              </th>
                            )}

                            {/* Divider header */}
                            {showActiveLecMarks && (
                              <th className="px-2 py-3 w-8 bg-neutral-100">
                                <ArrowLeftRight className="h-3 w-3 mx-auto text-neutral-400" />
                              </th>
                            )}

                            {/* Second Examiner columns (editable) */}
                            {questionsList.map(q => (
                              <th key={`exam-${q}`} className="px-2 py-3 bg-amber-50/70 text-amber-800 w-14">
                                <span className="block text-[8px] font-normal text-amber-500 leading-none mb-0.5">2nd</span>
                                {q}<span className="block text-[9px] text-neutral-400 font-normal">/{marksPerQ}</span>
                              </th>
                            ))}
                            <th className="px-4 py-3 bg-amber-100/60 text-amber-800 font-extrabold w-16">
                              <span className="block text-[8px] font-normal text-amber-500 leading-none mb-0.5">2nd</span>
                              Total
                            </th>

                            {/* Variance column (only shown if both sets exist) */}
                            {showActiveLecMarks && (
                              <th className="px-4 py-3 text-center w-16 bg-rose-50/50 text-rose-700">Δ Var</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                          {students.map((s, idx) => {
                            const absent = s.isAbsentFinal;
                            const lecFm = s.finalExamQuestionsMarks ?? {};
                            const examFm = s.secondExamMarks ?? {};
                            const lecTotal = absent ? null : calcTotal(lecFm);
                            const examTotal = absent ? null : calcTotal(examFm);
                            const hasExamMarks = Object.keys(examFm).length > 0;
                            const variance = lecTotal !== null && examTotal !== null && hasExamMarks
                              ? Math.abs(lecTotal - examTotal)
                              : null;
                            const flagged = variance !== null && variance > VARIANCE_THRESHOLD;

                            return (
                              <tr key={s.studentIndex} className={`transition-colors ${absent ? "bg-neutral-100/60 text-neutral-400 line-through" : flagged ? "bg-rose-50/30" : "hover:bg-neutral-50/30"}`}>
                                <td className="px-4 py-3 font-bold text-neutral-400">{idx + 1}</td>
                                <td className="px-4 py-3 font-bold tracking-wider uppercase">{s.studentIndex}</td>

                                {/* Active Lec read-only guided cells */}
                                {showActiveLecMarks && questionsList.map(q => (
                                  <td key={`lec-${q}`} className="px-2 py-3 bg-indigo-50/20 text-center">
                                    {absent ? (
                                      <span className="text-neutral-400 font-bold text-[11px]">AB</span>
                                    ) : (
                                      <span className="inline-block w-10 py-1 text-center text-xs font-bold text-indigo-700 bg-indigo-50 rounded border border-indigo-100">
                                        {lecFm[q] ?? "—"}
                                      </span>
                                    )}
                                  </td>
                                ))}
                                {showActiveLecMarks && (
                                  <td className="px-4 py-3 text-center font-extrabold text-indigo-600 bg-indigo-50/20">
                                    {absent ? "AB" : (lecTotal?.toFixed(1) ?? "—")}
                                  </td>
                                )}

                                {/* Divider */}
                                {showActiveLecMarks && (
                                  <td className="px-1 py-3 bg-neutral-100/80" />
                                )}

                                {/* Second Examiner editable cells */}
                                {questionsList.map(q => (
                                  <td key={`exam-${q}`} className="px-1.5 py-2 bg-amber-50/20 text-center">
                                    {absent ? (
                                      <span className="text-neutral-400 font-bold text-[11px]">AB</span>
                                    ) : (
                                      <input
                                        type="number" min="0" max={marksPerQ}
                                        value={examFm[q] ?? ""}
                                        placeholder="0"
                                        disabled={activeModule.isFrozen || isFinalized || isReconciliationNeeded || isReconciled}
                                        onChange={e => updateSecondMark(s.studentIndex, q, Number(e.target.value))}
                                        className="w-12 bg-white border border-amber-200 rounded py-1 text-center font-bold focus:outline-none focus:border-amber-500 disabled:opacity-40"
                                      />
                                    )}
                                  </td>
                                ))}
                                <td className="px-4 py-3 text-center font-extrabold text-amber-700 bg-amber-50/20">
                                  {absent ? "AB" : (hasExamMarks ? examTotal?.toFixed(1) : <span className="text-neutral-300 font-normal text-xs">—</span>)}
                                </td>

                                {/* Variance */}
                                {showActiveLecMarks && (
                                  <td className="px-4 py-3 text-center bg-rose-50/20">
                                    {absent || variance === null ? (
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
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* ── Action footer ─────────────────────────────────────── */}
                  {students.length > 0 && !activeModule.isFrozen && !isFinalized && !isReconciliationNeeded && !isReconciled && (
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-3 border-t border-neutral-100">
                      <p className="text-[11px] text-neutral-400 max-w-sm">
                        <strong>Save Progress</strong> to preserve your marks. Click <strong>Finalise Marking</strong> when complete —
                        the system will check for variance and notify the Lecturer if reconciliation is needed.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSave(false)}
                          disabled={isSaving}
                          className="flex items-center gap-2 h-10 px-4 text-xs font-bold bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-40 transition-all cursor-pointer"
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save Progress
                        </button>
                        <button
                          onClick={() => handleSave(true)}
                          disabled={isSaving}
                          className="flex items-center gap-2 h-10 px-4 text-xs font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-all cursor-pointer"
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          Finalise Marking
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Reconciliation state footer ───────────────────────── */}
                  {isReconciliationNeeded && students.length > 0 && (
                    <div className="pt-3 border-t border-neutral-100 space-y-3">
                      {isLecturerApproved ? (
                        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                          <div className="flex items-start gap-2.5">
                            <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-teal-700 font-semibold">
                              The Active Lecturer has reviewed and approved your marksheet. You may now finalise the reconciliation.
                            </p>
                          </div>
                          <button
                            onClick={handleFinaliseReconciled}
                            disabled={isFinalisingReconciled}
                            className="shrink-0 flex items-center gap-2 h-10 px-5 text-xs font-bold bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-40 transition-all cursor-pointer"
                          >
                            {isFinalisingReconciled ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
                            Finalise Reconciliation
                          </button>
                        </div>
                      ) : (
                        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-2.5">
                          <Clock className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[11px] font-bold text-orange-800">Awaiting Lecturer Approval</p>
                            <p className="text-[10px] text-orange-600 mt-0.5">
                              {flaggedStudents.length} student(s) have a variance &gt; {VARIANCE_THRESHOLD}. The Active Lecturer has been notified and must review and approve your marksheet before you can finalise.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {isFinalized && students.length > 0 && (
                    <div className="flex items-center gap-2.5 pt-3 border-t border-neutral-100">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <p className="text-[11px] text-emerald-700 font-semibold">
                        Second marking is finalised. The Active Lecturer can now view your marks for variance analysis.
                      </p>
                    </div>
                  )}

                  {isReconciled && students.length > 0 && (
                    <div className="flex items-center gap-2.5 pt-3 border-t border-neutral-100">
                      <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0" />
                      <p className="text-[11px] text-teal-700 font-semibold">
                        Reconciliation complete. This marksheet is closed and the Examiner&apos;s marks are the official final exam record.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}