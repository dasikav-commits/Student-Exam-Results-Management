"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { ProfileSettingsDrawer } from "@/components/ProfileSettingsDrawer";
import {
  computeWeightedScores,
  hasAnyMark,
  normaliseCaComponents,
  normaliseFinalAbsence,
  normaliseFinalBlueprint,
  normaliseFinalMarkRow,
  type MarkRowLike,
} from "@/lib/lecturer-marks";
import type { CaComponent as SharedCaComponent, FinalBlueprint as SharedFinalBlueprint } from "@/types/hod";
import {
  Users, BookOpen, Lock, Unlock, Loader2, Layers, TrendingUp, Shield,
  Edit3, X, GraduationCap, FileCheck, ChevronDown, AlertCircle, CheckCircle,
  Clock, ClipboardList, Eye, Sliders, Flame, LogOut, RefreshCcw, User, Plus
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type MarksheetStatus = "DRAFT" | "MARKING" | "SECOND_CHECKING" | "FINALIZED" | "RECONCILIATION_NEEDED" | "RECONCILED";

interface LecturerData {
  id: number;
  fullName: string;
  email: string;
  isHod: boolean;
  isActiveLec: boolean;
  isExamLec: boolean;
  activeModules: string[];
  examModules: string[];
}

// CA blueprints are authored on the Lecturer Desk; the HOD Console reads them
// through the shared marks engine so both desks always agree on the numbers.
type HodCaComponent = SharedCaComponent;
type HodFinalBlueprint = SharedFinalBlueprint;

interface ModuleData {
  id: number;
  code: string;
  name: string;
  credits: number;
  eligibleStudents: number;
  deadline: string | null;
  isFrozen: boolean;
  assignedActiveLec?: { id: number; fullName: string } | null;
  assignedExamLec?: { id: number; fullName: string } | null;
  stats: {
    moduleComponents?: string[];
    caComponents?: HodCaComponent[];
    finalBlueprint?: HodFinalBlueprint;
    caCompletionRate?: number;
    marksheetStatus?: MarksheetStatus;
  };
}

// ─── Total Calculation Helper ─────────────────────────────────────────────────
/**
 * Weighted module mark for one student, computed by the same engine that powers
 * the Lecturer Desk grids and the CSV export — this used to be a copy of that
 * maths, which silently disagreed with the Lecturer Desk for Group A
 * components (project / presentation / lab report) and for any question whose
 * weightage differed from the component average.
 *
 * The Examiner's marks take precedence over the lecturer's for the final paper.
 */
function calcStudentTotal(
  student: any,
  caComponents: HodCaComponent[],
  finalBlueprint: HodFinalBlueprint | undefined
): { caTotal: number; examTotal: number; grandTotal: number } {
  const components = normaliseCaComponents(caComponents);
  const blueprint = normaliseFinalBlueprint(finalBlueprint);
  const normalized = normaliseFinalMarkRow(student as MarkRowLike, blueprint);
  const examSource = hasAnyMark(normalized.secondExamMarks)
    ? { ...student, ...normalized, finalExamQuestionsMarks: normalized.secondExamMarks }
    : { ...student, ...normalized, finalExamQuestionsMarks: normalized.finalExamQuestionsMarks };

  const weighted = computeWeightedScores(examSource as MarkRowLike, components, blueprint);
  return { caTotal: weighted.ca, examTotal: weighted.final, grandTotal: weighted.total };
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
const STATUS_META: Record<MarksheetStatus, { label: string; classes: string; Icon: any }> = {
  DRAFT:                  { label: "Draft",                classes: "bg-neutral-100 text-neutral-500",             Icon: ClipboardList },
  MARKING:                { label: "Marking",              classes: "bg-amber-100 text-amber-700",                 Icon: Clock },
  SECOND_CHECKING:        { label: "2nd Check",            classes: "bg-indigo-100 text-indigo-700",               Icon: Eye },
  FINALIZED:              { label: "Finalized",            classes: "bg-emerald-100 text-emerald-700",             Icon: CheckCircle },
  RECONCILIATION_NEEDED:  { label: "Reconciliation",       classes: "bg-orange-100 text-orange-700",               Icon: RefreshCcw },
  RECONCILED:             { label: "Reconciled",           classes: "bg-teal-100 text-teal-700",                   Icon: CheckCircle },
};

function StatusBadge({ status }: { status?: MarksheetStatus }) {
  const key = status ?? "DRAFT";
  const meta = STATUS_META[key];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.classes}`}>
      <meta.Icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function HodConsolePage() {
  const router = useRouter();
  const { user } = useRequireAuth();   // ← redirects to /login if no session
  const { logout } = useAuth();

  const [lecturers, setLecturers] = useState<LecturerData[]>([]);
  const [modules, setModules] = useState<ModuleData[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"modules" | "lecturers" | "results">("modules");
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAddModuleOpen, setIsAddModuleOpen] = useState(false);
  const [isSavingModule, setIsSavingModule] = useState(false);
  const [moduleFormError, setModuleFormError] = useState("");
  const [newModule, setNewModule] = useState({
    name: "",
    code: "",
    lecturerId: "",
    components: [] as string[],
    eligibleStudents: "",
    deadline: "",
  });
  const [selectedLecturer, setSelectedLecturer] = useState<LecturerData | null>(null);
  const [modalActiveCodes, setModalActiveCodes] = useState<string[]>([]);
  const [modalExamCodes, setModalExamCodes] = useState<string[]>([]);

  // Results viewer modal
  const [viewResultsModule, setViewResultsModule] = useState<ModuleData | null>(null);
  const [moduleStudents, setModuleStudents] = useState<any[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);

  const caps = user?.capabilities ?? { isHOD: true, isActiveLec: false, isExamLec: false };

  // ── Data fetch ─────────────────────────────────────────────────────────────
  async function refreshData() {
    setIsDataLoading(true);
    try {
      const [lecsRes, modsRes] = await Promise.all([
        fetch("/api/hod/lecturers"),
        fetch("/api/hod/modules"),
      ]);
      if (lecsRes.ok && modsRes.ok) {
        setLecturers(await lecsRes.json());
        setModules(await modsRes.json());
      }
    } catch (err) {
      console.error("Failed to load HOD data:", err);
    } finally {
      setIsDataLoading(false);
    }
  }

  useEffect(() => {
    refreshData();
  }, []);

  // ── Module freeze toggle ────────────────────────────────────────────────────
  const toggleFreeze = async (code: string) => {
    setUpdatingId(`freeze-${code}`);
    const mod = modules.find(m => m.code === code);
    const nextState = !mod?.isFrozen;
    try {
      const res = await fetch("/api/hod/modules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, isFrozen: nextState }),
      });
      if (res.ok) {
        setModules(prev => prev.map(m => m.code === code ? { ...m, isFrozen: nextState } : m));
      }
    } catch (err) {
      console.error("Freeze toggle failed:", err);
    } finally {
      setUpdatingId(null);
    }
  };

  // ── Lecturer assignment modal ───────────────────────────────────────────────
  const openModal = (lec: LecturerData) => {
    setSelectedLecturer(lec);
    setModalActiveCodes([...lec.activeModules]);
    setModalExamCodes([...lec.examModules]);
    setIsModalOpen(true);
  };

  const handleSaveAssignments = async () => {
    if (!selectedLecturer) return;
    setUpdatingId("modal-save");
    try {
      const res = await fetch("/api/hod/lecturers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lecturerId: selectedLecturer.id,
          activeModuleCodes: modalActiveCodes,
          examModuleCodes: modalExamCodes,
        }),
      });
      if (res.ok) {
        await refreshData();
        setIsModalOpen(false);
        setSelectedLecturer(null);
      }
    } catch (err) {
      console.error("Save assignments failed:", err);
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleCode = (
    code: string,
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setList(list.includes(code) ? list.filter(c => c !== code) : [...list, code]);
  };

  const handleCreateModule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingModule(true);
    setModuleFormError("");
    try {
      const res = await fetch("/api/hod/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newModule,
          eligibleStudents: Number(newModule.eligibleStudents),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setModuleFormError(result.error ?? "Failed to create module");
        return;
      }

      setIsAddModuleOpen(false);
      setNewModule({ name: "", code: "", lecturerId: "", components: [], eligibleStudents: "", deadline: "" });
      await refreshData();
    } catch {
      setModuleFormError("Unable to save module. Check your connection and try again.");
    } finally {
      setIsSavingModule(false);
    }
  };

  // ── Results viewer ─────────────────────────────────────────────────────────
  const viewResults = async (mod: ModuleData) => {
    setViewResultsModule(mod);
    setIsLoadingResults(true);
    try {
      const res = await fetch(`/api/lecturer/marks?moduleCode=${encodeURIComponent(mod.code)}`);
      if (res.ok) setModuleStudents(await res.json());
    } catch { }
    setIsLoadingResults(false);
  };

  // ── Stats ───────────────────────────────────────────────────────────────────
  const frozenCount = modules.filter(m => m.isFrozen).length;
  const finalizedCount = modules.filter(m => m.stats?.marksheetStatus === "FINALIZED").length;
  const markingCount = modules.filter(m => m.stats?.marksheetStatus === "MARKING" || m.stats?.marksheetStatus === "SECOND_CHECKING").length;

  if (isDataLoading) {
    return (
      <div className="min-h-screen bg-cream-canvas flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
        <p className="text-xs font-bold text-neutral-400 tracking-widest uppercase">Loading HOD Console…</p>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-cream-canvas text-[#1a1a1a]">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 bg-white border-b border-neutral-200/80 px-6 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/wusl-logo.png" alt="Wayamba University" className="w-10 h-10 object-contain" />
            <div>
              <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Student Exam &amp; Results Management</p>
              <h1 className="text-sm font-black text-[#1a1a1a] leading-none">HOD Administration Console</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs text-neutral-500 font-medium">{user?.fullName ?? user?.email}</span>

            {/* ── Workspace Switcher ── */}
            <div className="relative">
              <button
                onClick={() => setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800 transition-all cursor-pointer"
              >
                <Shield className="h-3.5 w-3.5" />
                <span>HOD Console</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${isWorkspaceMenuOpen ? "rotate-180" : ""}`} />
              </button>
              {isWorkspaceMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsWorkspaceMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-64 bg-white border border-neutral-200 rounded-xl shadow-xl p-1.5 z-20 space-y-0.5 text-xs">
                    <div className="px-3 py-2 border-b border-neutral-100 mb-1">
                      <span className="font-black text-[#1a1a1a]">{user?.fullName}</span>
                      <span className="block text-[10px] text-neutral-400">{user?.email}</span>
                    </div>
                    {/* Current: HOD Console */}
                    <button disabled className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-neutral-900 text-white font-bold cursor-default">
                      <Shield className="h-3.5 w-3.5" /><span>HOD Console (Active)</span>
                    </button>
                    {/* Switch to Lecturer Desk */}
                    {caps.isActiveLec && (
                      <button
                        onClick={() => { setIsWorkspaceMenuOpen(false); router.push("/dashboard/lecturer"); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-neutral-50 text-neutral-700 font-semibold cursor-pointer"
                      >
                        <Sliders className="h-3.5 w-3.5 text-indigo-500" />
                        <div className="text-left">
                          <span className="block font-bold">Lecturer Desk</span>
                          <span className="block text-[10px] text-neutral-400">Manage your assigned modules &amp; marks</span>
                        </div>
                      </button>
                    )}
                    {/* Switch to Examiner Hub */}
                    {caps.isExamLec && (
                      <button
                        onClick={() => { setIsWorkspaceMenuOpen(false); router.push("/dashboard/examiner"); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-neutral-50 text-neutral-700 font-semibold cursor-pointer"
                      >
                        <Flame className="h-3.5 w-3.5 text-amber-500" />
                        <div className="text-left">
                          <span className="block font-bold">Examiner Hub</span>
                          <span className="block text-[10px] text-neutral-400">Second marking &amp; verification</span>
                        </div>
                      </button>
                    )}
                    {/* Disabled locks when no capability */}
                    {!caps.isActiveLec && (
                      <div className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-neutral-50/60 text-neutral-300 cursor-not-allowed">
                        <Lock className="h-3.5 w-3.5" />
                        <span className="text-[10px]">Not assigned as Active Lecturer</span>
                      </div>
                    )}
                    {!caps.isExamLec && (
                      <div className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-neutral-50/60 text-neutral-300 cursor-not-allowed">
                        <Lock className="h-3.5 w-3.5" />
                        <span className="text-[10px]">Not assigned as Examiner</span>
                      </div>
                    )}
                    <div className="border-t border-neutral-100 pt-1 mt-1">
                      <button 
                        onClick={() => { setIsWorkspaceMenuOpen(false); setIsProfileOpen(true); }} 
                        className="w-full text-left flex items-center gap-2 px-3 py-2 text-neutral-700 font-semibold rounded-lg hover:bg-neutral-50 cursor-pointer"
                      >
                        <User className="h-3.5 w-3.5" />Profile Settings
                      </button>
                      <button onClick={logout} className="w-full text-left flex items-center gap-2 px-3 py-2 text-rose-600 font-semibold rounded-lg hover:bg-rose-50 cursor-pointer">
                        <LogOut className="h-3.5 w-3.5" />Sign Out
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

      {/* ── Main Content ────────────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto p-4 sm:p-6 space-y-5">

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Modules", value: modules.length, icon: <BookOpen className="h-5 w-5" />, color: "text-indigo-600 bg-indigo-50" },
            { label: "Frozen", value: frozenCount, icon: <Lock className="h-5 w-5" />, color: "text-rose-600 bg-rose-50" },
            { label: "In Progress", value: markingCount, icon: <Clock className="h-5 w-5" />, color: "text-amber-600 bg-amber-50" },
            { label: "Finalized", value: finalizedCount, icon: <CheckCircle className="h-5 w-5" />, color: "text-emerald-600 bg-emerald-50" },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-xl premium-border p-4 flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${card.color}`}>{card.icon}</div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{card.label}</p>
                <p className="text-2xl font-black text-[#1a1a1a]">{card.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Main tabs */}
        <div className="flex gap-2">
          {([
            { id: "modules" as const, label: "Module Blueprint Control", icon: <Layers className="h-3.5 w-3.5" /> },
            { id: "lecturers" as const, label: "Lecturer Roster & Assignments", icon: <Users className="h-3.5 w-3.5" /> },
            { id: "results" as const, label: "Result Sheets", icon: <FileCheck className="h-3.5 w-3.5" /> },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${activeTab === tab.id ? "bg-[#1a1a1a] text-white border-[#1a1a1a]" : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"}`}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
          <button onClick={refreshData} className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white border border-neutral-200 text-neutral-500 hover:bg-neutral-50 cursor-pointer">
            <RefreshCcw className="h-3.5 w-3.5" />Refresh
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 1 — MODULE BLUEPRINT CONTROL
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "modules" && (
          <div className="bg-white rounded-2xl premium-border overflow-hidden">
            <div className="p-4 border-b border-neutral-200 bg-neutral-50/60 flex items-center justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                Department Module Manifest ({modules.length} modules)
              </span>
              <button
                onClick={() => { setModuleFormError(""); setIsAddModuleOpen(true); }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1a1a] text-white text-xs font-bold hover:bg-neutral-800 cursor-pointer"
              >
                <span className="text-base leading-none">+</span>Add module
              </button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-neutral-50 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-200">
                    <th className="px-5 py-3">Module</th>
                    <th className="px-5 py-3">Active Lecturer</th>
                    <th className="px-5 py-3">Components</th>
                    <th className="px-5 py-3 text-center">Eligibility Level</th>
                    <th className="px-5 py-3">Deadline</th>
                    <th className="px-5 py-3">Examiner</th>
                    <th className="px-5 py-3 text-center">CA Components</th>
                    <th className="px-5 py-3 text-center">Exam</th>
                    <th className="px-5 py-3 text-center">Status</th>
                    <th className="px-5 py-3 text-center">Freeze</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {modules.map(mod => (
                    <tr key={mod.id} className="hover:bg-neutral-50/40 transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-bold text-sm">{mod.code}</p>
                        <p className="text-neutral-400 mt-0.5 text-[11px]">{mod.name}</p>
                        <p className="text-[10px] text-neutral-300 mt-0.5">{mod.credits} credits</p>
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {mod.assignedActiveLec?.fullName ?? <span className="text-neutral-300 italic text-[11px]">Unassigned</span>}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {(mod.stats?.moduleComponents ?? []).map(component => (
                            <span key={component} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                              {component === "CONTINUOUS_ASSESSMENT" ? "Continuous Assessment" : component === "LAB_SESSIONS" ? "Lab Sessions" : "Practical"}
                            </span>
                          ))}
                          {(mod.stats?.moduleComponents ?? []).length === 0 && <span className="text-neutral-300">—</span>}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center font-semibold tabular-nums">{mod.eligibleStudents}</td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        {mod.deadline ? new Date(mod.deadline).toLocaleDateString() : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {mod.assignedExamLec?.fullName ?? <span className="text-neutral-300 italic text-[11px]">Unassigned</span>}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className="font-bold">{(mod.stats?.caComponents ?? []).length}</span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        {mod.stats?.finalBlueprint?.enabled ? (
                          <span className="text-emerald-600 font-bold text-[11px]">✓ Yes</span>
                        ) : (
                          <span className="text-neutral-300 text-[11px]">No</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <StatusBadge status={mod.stats?.marksheetStatus} />
                      </td>
                      <td className="px-5 py-4 text-center">
                        <button
                          onClick={() => toggleFreeze(mod.code)}
                          disabled={updatingId === `freeze-${mod.code}`}
                          className={`flex items-center gap-1.5 mx-auto h-7 px-3 rounded-lg text-[10px] font-bold border transition-all cursor-pointer disabled:opacity-40 ${mod.isFrozen ? "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100" : "bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100"}`}
                        >
                          {updatingId === `freeze-${mod.code}` ? <Loader2 className="h-3 w-3 animate-spin" /> : mod.isFrozen ? <><Lock className="h-3 w-3" />Frozen</> : <><Unlock className="h-3 w-3" />Freeze</>}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {modules.length === 0 && (
                    <tr><td colSpan={10} className="px-5 py-10 text-center text-neutral-400 italic">No modules found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 2 — LECTURER ROSTER & ASSIGNMENTS
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "lecturers" && (
          <div className="bg-white rounded-2xl premium-border overflow-hidden">
            <div className="p-4 border-b border-neutral-200 bg-neutral-50/60 text-xs font-bold uppercase tracking-wider text-neutral-500">
              Faculty Lecturer Roster ({lecturers.length} lecturers)
            </div>
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-neutral-50 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-200">
                  <th className="px-5 py-3">Name / Email</th>
                  <th className="px-5 py-3">Roles</th>
                  <th className="px-5 py-3">Active Modules</th>
                  <th className="px-5 py-3">Exam Modules</th>
                  <th className="px-5 py-3 text-center">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {lecturers.map(lec => (
                  <tr key={lec.id} className="hover:bg-neutral-50/40">
                    <td className="px-5 py-4">
                      <p className="font-bold">{lec.fullName}</p>
                      <p className="text-neutral-400 text-[11px]">{lec.email}</p>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1">
                        {lec.isHod && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-neutral-900 text-white uppercase">HOD</span>}
                        {lec.isActiveLec && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase">Lec</span>}
                        {lec.isExamLec && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase">Exam</span>}
                        {!lec.isHod && !lec.isActiveLec && !lec.isExamLec && <span className="text-neutral-300 text-[11px] italic">None</span>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {lec.activeModules.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {lec.activeModules.map(c => (
                            <span key={c} className="bg-indigo-50 text-indigo-700 font-bold text-[10px] px-1.5 py-0.5 rounded">{c}</span>
                          ))}
                        </div>
                      ) : <span className="text-neutral-300 italic text-[11px]">None</span>}
                    </td>
                    <td className="px-5 py-4">
                      {lec.examModules.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {lec.examModules.map(c => (
                            <span key={c} className="bg-amber-50 text-amber-700 font-bold text-[10px] px-1.5 py-0.5 rounded">{c}</span>
                          ))}
                        </div>
                      ) : <span className="text-neutral-300 italic text-[11px]">None</span>}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <button
                        onClick={() => openModal(lec)}
                        className="flex items-center gap-1.5 mx-auto h-7 px-3 rounded-lg text-[10px] font-bold bg-neutral-50 border border-neutral-200 text-neutral-700 hover:bg-neutral-100 cursor-pointer"
                      >
                        <Edit3 className="h-3 w-3" />Manage
                      </button>
                    </td>
                  </tr>
                ))}
                {lecturers.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-neutral-400 italic">No lecturers found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 3 — RESULT SHEETS
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "results" && (
          <div className="space-y-4">
            {/* Status legend */}
            <div className="bg-white rounded-xl premium-border p-4 flex flex-wrap gap-4 text-xs">
              <span className="font-bold text-neutral-500">Marksheet Status Legend:</span>
              {(Object.entries(STATUS_META) as [MarksheetStatus, typeof STATUS_META[MarksheetStatus]][]).map(([key, meta]) => (
                <span key={key} className={`flex items-center gap-1.5 font-bold px-2 py-0.5 rounded-full ${meta.classes}`}>
                  <meta.Icon className="h-3 w-3" />{meta.label}
                </span>
              ))}
            </div>

            <div className="bg-white rounded-2xl premium-border overflow-hidden">
              <div className="p-4 border-b border-neutral-200 bg-neutral-50/60 text-xs font-bold uppercase tracking-wider text-neutral-500">
                All Module Result Status
              </div>
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-neutral-50 text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-200">
                    <th className="px-5 py-3">Module</th>
                    <th className="px-5 py-3">Active Lecturer</th>
                    <th className="px-5 py-3">Examiner</th>
                    <th className="px-5 py-3 text-center">Status</th>
                    <th className="px-5 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {modules.map(mod => (
                    <tr key={mod.id} className="hover:bg-neutral-50/40">
                      <td className="px-5 py-4">
                        <p className="font-bold">{mod.code}</p>
                        <p className="text-neutral-400 text-[11px]">{mod.name}</p>
                      </td>
                      <td className="px-5 py-4 font-semibold">{mod.assignedActiveLec?.fullName ?? "—"}</td>
                      <td className="px-5 py-4 font-semibold">{mod.assignedExamLec?.fullName ?? "—"}</td>
                      <td className="px-5 py-4 text-center">
                        <StatusBadge status={mod.stats?.marksheetStatus} />
                      </td>
                      <td className="px-5 py-4 text-center">
                        <button
                          onClick={() => viewResults(mod)}
                          className={`flex items-center gap-1.5 mx-auto h-7 px-3 rounded-lg text-[10px] font-bold border cursor-pointer transition-all ${mod.stats?.marksheetStatus === "FINALIZED" ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100" : "bg-neutral-50 border-neutral-200 text-neutral-500 hover:bg-neutral-100"}`}
                        >
                          <Eye className="h-3 w-3" />
                          {mod.stats?.marksheetStatus === "FINALIZED" ? "View Final Results" : "Preview"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {isAddModuleOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={handleCreateModule} className="bg-white w-full max-w-2xl rounded-xl shadow-2xl border border-neutral-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-neutral-100 bg-neutral-50 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm">Add Department Module</h3>
                <p className="text-xs text-neutral-400 mt-0.5">Create a module and assign its lecturer.</p>
              </div>
              <button type="button" onClick={() => setIsAddModuleOpen(false)} aria-label="Close" className="w-8 h-8 border border-neutral-200 flex items-center justify-center hover:bg-neutral-100 cursor-pointer">
                <X className="h-4 w-4 text-neutral-500" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-neutral-600">Module name</span>
                  <input required maxLength={120} value={newModule.name} onChange={event => setNewModule(current => ({ ...current, name: event.target.value }))} className="w-full h-10 px-3 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-neutral-500" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-neutral-600">Module code</span>
                  <input required maxLength={30} value={newModule.code} onChange={event => setNewModule(current => ({ ...current, code: event.target.value.toUpperCase() }))} className="w-full h-10 px-3 border border-neutral-200 rounded-lg text-sm uppercase focus:outline-none focus:border-neutral-500" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-neutral-600">Lecturer</span>
                  <select required value={newModule.lecturerId} onChange={event => setNewModule(current => ({ ...current, lecturerId: event.target.value }))} className="w-full h-10 px-3 border border-neutral-200 rounded-lg text-sm bg-white focus:outline-none focus:border-neutral-500">
                    <option value="">Select lecturer</option>
                    {lecturers.map(lecturer => <option key={lecturer.id} value={lecturer.id}>{lecturer.fullName}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-neutral-600">Eligibility Level</span>
                  <input required type="number" min="0" step="1" value={newModule.eligibleStudents} onChange={event => setNewModule(current => ({ ...current, eligibleStudents: event.target.value }))} className="w-full h-10 px-3 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-neutral-500" />
                </label>
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs font-bold text-neutral-600">Deadline</span>
                  <input required type="date" value={newModule.deadline} onChange={event => setNewModule(current => ({ ...current, deadline: event.target.value }))} className="w-full h-10 px-3 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-neutral-500" />
                </label>
              </div>

              <fieldset>
                <legend className="text-xs font-bold text-neutral-600 mb-2">Components</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { value: "CONTINUOUS_ASSESSMENT", label: "Continuous Assessments" },
                    { value: "PRACTICAL", label: "Practical" },
                    { value: "LAB_SESSIONS", label: "Lab Sessions" },
                  ].map(component => {
                    const selected = newModule.components.includes(component.value);
                    return (
                      <label key={component.value} className={`flex items-center gap-2.5 p-3 border rounded-lg text-xs font-semibold cursor-pointer ${selected ? "border-emerald-500 bg-emerald-50/60 text-emerald-800" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"}`}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setNewModule(current => ({
                            ...current,
                            components: selected
                              ? current.components.filter(value => value !== component.value)
                              : [...current.components, component.value],
                          }))}
                          className="accent-emerald-600"
                        />
                        {component.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {moduleFormError && (
                <p role="alert" className="flex items-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 shrink-0" />{moduleFormError}
                </p>
              )}
            </div>

            <div className="p-5 border-t border-neutral-100 bg-neutral-50 flex justify-end gap-3">
              <button type="button" onClick={() => setIsAddModuleOpen(false)} className="h-9 px-4 text-xs font-bold rounded-lg border border-neutral-300 text-neutral-700 bg-white hover:bg-neutral-50 cursor-pointer">Cancel</button>
              <button type="submit" disabled={isSavingModule} className="h-9 px-5 text-xs font-bold rounded-lg bg-[#1a1a1a] text-white hover:bg-neutral-800 disabled:opacity-50 cursor-pointer flex items-center gap-2">
                {isSavingModule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Save module
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Assignment Modal ──────────────────────────────────────────────────── */}
      {isModalOpen && selectedLecturer && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-neutral-100 bg-neutral-50 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm">Manage Module Assignments</h3>
                <p className="text-xs text-neutral-400 mt-0.5">Configuring workload for <strong>{selectedLecturer.fullName}</strong></p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="w-8 h-8 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-100 cursor-pointer">
                <X className="h-4 w-4 text-neutral-500" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-6 flex-1">
              <div>
                <h4 className="text-xs font-bold uppercase text-neutral-400 tracking-wider mb-3 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" />
                  Assign as Active Lecturer for:
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {modules.map(mod => (
                    <label key={`a-${mod.code}`} className={`flex items-start gap-2.5 p-3 border rounded-xl cursor-pointer transition-all ${modalActiveCodes.includes(mod.code) ? "border-indigo-500 bg-indigo-50/40" : "border-neutral-200 hover:bg-neutral-50"}`}>
                      <input type="checkbox" disabled={mod.isFrozen} checked={modalActiveCodes.includes(mod.code)} onChange={() => toggleCode(mod.code, modalActiveCodes, setModalActiveCodes)} className="mt-0.5 accent-indigo-600" />
                      <div className="text-xs">
                        <p className="font-bold">{mod.code}</p>
                        <p className="text-neutral-400 text-[11px]">{mod.name}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase text-neutral-400 tracking-wider mb-3 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
                  Assign as Examiner for:
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {modules.map(mod => (
                    <label key={`e-${mod.code}`} className={`flex items-start gap-2.5 p-3 border rounded-xl cursor-pointer transition-all ${modalExamCodes.includes(mod.code) ? "border-amber-500 bg-amber-50/40" : "border-neutral-200 hover:bg-neutral-50"}`}>
                      <input type="checkbox" disabled={mod.isFrozen} checked={modalExamCodes.includes(mod.code)} onChange={() => toggleCode(mod.code, modalExamCodes, setModalExamCodes)} className="mt-0.5 accent-amber-600" />
                      <div className="text-xs">
                        <p className="font-bold">{mod.code}</p>
                        <p className="text-neutral-400 text-[11px]">{mod.name}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-neutral-100 bg-neutral-50 flex justify-end gap-3">
              <button onClick={() => setIsModalOpen(false)} className="h-9 px-4 text-xs font-bold rounded-xl border border-neutral-300 text-neutral-700 bg-white hover:bg-neutral-50 cursor-pointer">Cancel</button>
              <button
                onClick={handleSaveAssignments}
                disabled={updatingId === "modal-save"}
                className="h-9 px-5 text-xs font-bold rounded-xl bg-[#1a1a1a] text-white hover:bg-neutral-800 disabled:opacity-40 cursor-pointer flex items-center gap-2"
              >
                {updatingId === "modal-save" && <Loader2 className="h-3 w-3 animate-spin" />}
                Save Assignment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Results Viewer Modal ──────────────────────────────────────────────── */}
      {viewResultsModule && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-neutral-100 bg-neutral-50 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm">{viewResultsModule.code} — Student Mark Summary</h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {viewResultsModule.name} · <StatusBadge status={viewResultsModule.stats?.marksheetStatus} />
                  {viewResultsModule.stats?.caComponents && viewResultsModule.stats?.finalBlueprint && (
                    <span className="ml-2 text-[10px] text-neutral-400">
                      CA {viewResultsModule.stats.caComponents.reduce((s, c) => s + c.weightage, 0)}% +
                      Exam {viewResultsModule.stats.finalBlueprint.weightage}% = 100%
                    </span>
                  )}
                </p>
              </div>
              <button onClick={() => { setViewResultsModule(null); setModuleStudents([]); }} className="w-8 h-8 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-100 cursor-pointer">
                <X className="h-4 w-4 text-neutral-500" />
              </button>
            </div>
            <div className="p-5 overflow-auto flex-1">
              {isLoadingResults ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-indigo-600" /></div>
              ) : moduleStudents.length === 0 ? (
                <p className="text-center text-neutral-400 italic py-8 text-sm">No student marks recorded yet.</p>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-neutral-50 text-[10px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
                      <th className="px-4 py-3 text-left">#</th>
                      <th className="px-4 py-3 text-left">Student Index</th>
                      <th className="px-4 py-3 text-center">Absent</th>
                      <th className="px-4 py-3 text-right">
                        CA Total
                        {viewResultsModule.stats?.caComponents && (
                          <span className="ml-1 font-normal normal-case">/ {viewResultsModule.stats.caComponents.reduce((s, c) => s + c.weightage, 0)}</span>
                        )}
                      </th>
                      <th className="px-4 py-3 text-right">
                        Exam Total
                        {viewResultsModule.stats?.finalBlueprint && (
                          <span className="ml-1 font-normal normal-case">/ {viewResultsModule.stats.finalBlueprint.weightage}</span>
                        )}
                      </th>
                      <th className="px-4 py-3 text-right bg-indigo-50 text-indigo-700 rounded-t">Grand Total / 100</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {moduleStudents.map((s: any, idx: number) => {
                      const caComponents = viewResultsModule.stats?.caComponents ?? [];
                      const finalBlueprint = viewResultsModule.stats?.finalBlueprint;
                      const { caTotal, examTotal, grandTotal } = calcStudentTotal(s, caComponents, finalBlueprint);
                      const caAbsent = Object.values(s.isAbsentCa ?? {}).some(v => v === true);
                      const finalAbsence = normaliseFinalAbsence(s);
                      const anyAbsent = caAbsent || finalAbsence.isAbsentTheory || finalAbsence.isAbsentPractical;
                      return (
                        <tr key={s.studentIndex} className={`transition-colors ${anyAbsent ? "bg-rose-50/30" : "hover:bg-neutral-50/40"}`}>
                          <td className="px-4 py-3 text-neutral-400 font-bold">{idx + 1}</td>
                          <td className="px-4 py-3 font-bold uppercase tracking-wider">{s.studentIndex}</td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex justify-center gap-1.5 flex-wrap">
                              {caAbsent && <span className="text-[9px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded">CA-AB</span>}
                              {finalAbsence.isAbsentTheory && <span className="text-[9px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded">THEORY-AB</span>}
                              {finalAbsence.isAbsentPractical && <span className="text-[9px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded">PRACTICAL-AB</span>}
                              {!anyAbsent && <span className="text-emerald-600 text-[10px] font-bold">✓</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {caAbsent ? <span className="text-rose-400 text-[10px] font-bold">ABSENT</span> : caTotal.toFixed(1)}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {finalAbsence.isAbsentFinal
                              ? <span className="text-rose-400 text-[10px] font-bold">ABSENT</span>
                              : <span>{examTotal.toFixed(1)}{(finalAbsence.isAbsentTheory || finalAbsence.isAbsentPractical) && <span className="ml-1 text-[9px] font-bold text-rose-500">partial AB</span>}</span>}
                          </td>
                          <td className={`px-4 py-3 text-right font-black tabular-nums text-sm bg-indigo-50/40 ${
                            grandTotal >= 75 ? "text-emerald-700" :
                            grandTotal >= 50 ? "text-amber-700" :
                            anyAbsent ? "text-rose-400" : "text-rose-700"
                          }`}>
                            {grandTotal.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {moduleStudents.length > 0 && (
                    <tfoot>
                      <tr className="bg-neutral-100 text-[10px] font-bold text-neutral-600 border-t-2 border-neutral-300">
                        <td colSpan={3} className="px-4 py-2">Class Average</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {(moduleStudents.reduce((sum: number, s: any) => {
                            const caComponents = viewResultsModule.stats?.caComponents ?? [];
                            const fp = viewResultsModule.stats?.finalBlueprint;
                            return sum + calcStudentTotal(s, caComponents, fp).caTotal;
                          }, 0) / moduleStudents.length).toFixed(1)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {(moduleStudents.reduce((sum: number, s: any) => {
                            const caComponents = viewResultsModule.stats?.caComponents ?? [];
                            const fp = viewResultsModule.stats?.finalBlueprint;
                            return sum + calcStudentTotal(s, caComponents, fp).examTotal;
                          }, 0) / moduleStudents.length).toFixed(1)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums bg-indigo-50/60 font-black text-indigo-800">
                          {(moduleStudents.reduce((sum: number, s: any) => {
                            const caComponents = viewResultsModule.stats?.caComponents ?? [];
                            const fp = viewResultsModule.stats?.finalBlueprint;
                            return sum + calcStudentTotal(s, caComponents, fp).grandTotal;
                          }, 0) / moduleStudents.length).toFixed(1)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}