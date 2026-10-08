"use client";

import React, { useState } from "react";
import { Check, ClipboardList, Hash, Percent, Pencil, Save, Sigma, Target, X } from "lucide-react";
import type {
  FinalBlueprint,
  FinalPaperMarks,
  FinalSectionBlueprint,
  FinalSectionKey,
  StudentMarkRecord,
} from "@/types/hod";
import {
  computeFinalSectionTotal,
  finalSectionMaxScore,
  finalSectionRequiredCount,
  finalSectionWeightage,
  getFinalSectionMarks,
  getFinalSectionBlueprint,
} from "@/lib/lecturer-marks";

export interface FinalSectionMarksDialogProps {
  sectionKey: FinalSectionKey;
  blueprint: FinalBlueprint;
  row: StudentMarkRecord;
  isAbsent: boolean;
  isReadOnly: boolean;
  secondMarks?: FinalPaperMarks | null;
  showExaminerMarks?: boolean;
  onSave: (studentIndex: string, section: FinalSectionKey, marks: Record<string, number | null>) => void;
  onClose: () => void;
}

const SECTION_META: Record<FinalSectionKey, { label: string; parent: "theory" | "practical"; tone: "sky" | "violet" | "amber" }> = {
  mcq: { label: "Theory · MCQ", parent: "theory", tone: "sky" },
  essay: { label: "Theory · Essay", parent: "theory", tone: "violet" },
  practical: { label: "Practical", parent: "practical", tone: "amber" },
};

const TONES = {
  sky: { header: "bg-sky-50/70", icon: "bg-sky-600", card: "border-sky-100 bg-sky-50/40", badge: "border-sky-300 bg-sky-100 text-sky-800", chip: "bg-sky-50 text-sky-700 border-sky-100" },
  violet: { header: "bg-violet-50/70", icon: "bg-violet-600", card: "border-violet-100 bg-violet-50/40", badge: "border-violet-300 bg-violet-100 text-violet-800", chip: "bg-violet-50 text-violet-700 border-violet-100" },
  amber: { header: "bg-amber-50/70", icon: "bg-amber-500", card: "border-amber-100 bg-amber-50/40", badge: "border-amber-300 bg-amber-100 text-amber-800", chip: "bg-amber-50 text-amber-700 border-amber-100" },
} as const;

function sectionMarks(sectionKey: FinalSectionKey, marks: FinalPaperMarks | null | undefined): Record<string, number> {
  return getFinalSectionMarks(marks, sectionKey) as Record<string, number>;
}

function formatMark(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : Number(value).toFixed(1);
}

function Chip({ icon: Icon, label, value, className }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  className: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold ${className}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span className="font-black">{value}</span>
    </span>
  );
}

export function FinalSectionMarksDialog({
  sectionKey,
  blueprint,
  row,
  isAbsent,
  isReadOnly,
  secondMarks,
  showExaminerMarks = false,
  onSave,
  onClose,
}: FinalSectionMarksDialogProps) {
  const section: FinalSectionBlueprint = getFinalSectionBlueprint(blueprint, sectionKey);
  const meta = SECTION_META[sectionKey];
  const tone = TONES[meta.tone];
  const questions = section.questions;
  const requiredCount = finalSectionRequiredCount(section);
  const maxScore = finalSectionMaxScore(section);
  const lecturerMarks = sectionMarks(sectionKey, row.finalExamQuestionsMarks);
  const examinerSectionMarks = sectionMarks(sectionKey, secondMarks);
  const [isEditing, setIsEditing] = useState(false);
  const [draftMarks, setDraftMarks] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(questions.map(question => [question.id, lecturerMarks[question.id] ?? null]))
  );

  const isFilled = (value: number | null | undefined) => value !== null && value !== undefined && Number.isFinite(Number(value));
  const entered = questions.filter(question => isFilled(draftMarks[question.id])).length;
  const requiredEntered = questions.slice(0, requiredCount).filter(question => isFilled(draftMarks[question.id])).length;
  const total = computeFinalSectionTotal(draftMarks, section);
  const isComplete = isAbsent || requiredEntered >= requiredCount;
  const progressPct = requiredCount > 0 ? Math.min(100, Math.round((requiredEntered / requiredCount) * 100)) : 100;

  const setMark = (questionId: string, value: number | null, max: number) => {
    const nextValue = value === null
      ? null
      : Math.min(max, Math.max(0, Number.isFinite(value) ? value : 0));
    setDraftMarks(current => ({ ...current, [questionId]: nextValue }));
  };

  const handleInput = (questionId: string, raw: string, max: number) => {
    if (raw.trim() === "") {
      setMark(questionId, null, max);
      return;
    }
    const value = Number(raw);
    if (Number.isFinite(value)) setMark(questionId, value, max);
  };

  const cancelEdit = () => {
    setDraftMarks(Object.fromEntries(questions.map(question => [question.id, lecturerMarks[question.id] ?? null])));
    setIsEditing(false);
  };

  const handleSave = () => {
    if (isReadOnly || isAbsent) return;
    onSave(row.studentIndex, sectionKey, draftMarks);
    setIsEditing(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-900/55 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${row.studentIndex} ${meta.label} marks`}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        <header className={`shrink-0 px-5 py-4 border-b border-neutral-200 flex items-start gap-3 ${tone.header}`}>
          <span className={`mt-0.5 h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-white ${tone.icon}`}>
            <ClipboardList className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-black text-base text-neutral-900">{row.studentIndex}</h2>
              <span className="text-neutral-400">/</span>
              <h3 className="font-black text-base text-neutral-900">{meta.label}</h3>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${tone.badge}`}>
                {meta.parent.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-neutral-700 mt-1">
              Enter marks question by question, or use the quick buttons for full marks or zero. Marks are lecturer-entered and are not automatically graded.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close section marks"
            className="ml-auto h-8 w-8 rounded-lg flex items-center justify-center text-neutral-400 hover:bg-white hover:text-neutral-700 transition-colors cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="shrink-0 px-5 py-3 border-b border-neutral-100 flex flex-wrap items-center gap-2">
          <Chip icon={Hash} label="Questions" value={`${questions.length}`} className={tone.chip} />
          <Chip icon={ClipboardList} label="Answers counted" value={`${requiredCount}`} className="bg-neutral-50 text-neutral-600 border-neutral-200" />
          <Chip icon={Target} label="Maximum" value={`${maxScore}`} className="bg-neutral-50 text-neutral-600 border-neutral-200" />
          <Chip icon={Percent} label="Final weight" value={`${finalSectionWeightage(blueprint, sectionKey).toFixed(1)}%`} className={tone.chip} />
          <Chip icon={Sigma} label="Parent" value={meta.parent === "theory" ? "Theory" : "Practical"} className="bg-neutral-50 text-neutral-600 border-neutral-200" />
          {showExaminerMarks && (
            <span className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-xs font-bold text-amber-800">Second-examiner marks shown for comparison</span>
          )}
        </div>

        {isAbsent && (
          <div className="shrink-0 mx-5 mt-4 px-3 py-2.5 rounded-lg border border-rose-300 bg-rose-50 text-sm font-semibold text-rose-800">
            The student is absent for {meta.parent === "theory" ? "Theory" : "Practical"}. Existing marks are preserved, but this parent section currently contributes zero. Change absence using the parent-level AB control on the register.
          </div>
        )}

        <div className="shrink-0 px-5 pt-4 pb-2 flex items-center justify-between gap-3 text-xs text-neutral-700">
          <span>{questions.length} question(s) · {isEditing ? "type a mark, or use the full / zero buttons." : "press Edit to change marks."}</span>
          <span className="shrink-0 font-bold tabular-nums">{Math.min(requiredEntered, requiredCount)}/{requiredCount} counted</span>
        </div>

        <div className="flex-1 min-h-0 h-[min(54vh,430px)] min-h-[220px] overflow-y-auto overscroll-contain px-5 pb-4 pt-2">
          {questions.length === 0 ? (
            <p className="py-10 text-center text-sm italic text-neutral-500">No questions are configured for this section.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2.5">
              {questions.map((question, index) => {
                const max = question.maxMarks;
                const value = draftMarks[question.id];
                const counted = index < requiredCount;
                return (
                  <div
                    key={question.id}
                    className={`min-w-0 rounded-xl border px-2.5 py-2 ${isAbsent ? "border-rose-100 bg-rose-50/40" : counted ? tone.card : "border-neutral-100 bg-neutral-50/70"}`}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-1">
                      <span className="text-xs font-black uppercase tracking-wider text-neutral-700">{question.id}</span>
                      <span className="text-[11px] font-bold tabular-nums text-neutral-600">/{max}</span>
                    </div>
                    {isAbsent ? (
                      <div className="h-8 flex items-center text-sm font-black text-rose-600">AB</div>
                    ) : isEditing ? (
                      <div className="flex min-w-0 items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max={max}
                          step="any"
                          value={value ?? ""}
                          placeholder="—"
                          aria-label={`${row.studentIndex} ${meta.label} ${question.id} out of ${max}`}
                          onChange={event => handleInput(question.id, event.target.value, max)}
                          className="h-8 min-w-0 w-full flex-1 rounded-md border border-neutral-200 bg-white px-1.5 text-center text-sm font-black tabular-nums focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          title={`${question.id}: full marks (${max})`}
                          aria-label={`${question.id}: set full marks`}
                          onClick={() => setMark(question.id, max, max)}
                          className="h-8 w-7 shrink-0 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 flex items-center justify-center cursor-pointer"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title={`${question.id}: zero`}
                          aria-label={`${question.id}: set zero`}
                          onClick={() => setMark(question.id, 0, max)}
                          className="h-8 w-7 shrink-0 rounded-md bg-rose-100 text-rose-700 hover:bg-rose-200 flex items-center justify-center cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="h-8 flex items-center justify-center text-base font-black tabular-nums text-neutral-800">
                        {formatMark(value)}
                      </div>
                    )}
                    {showExaminerMarks && (
                      <div className="mt-1.5 flex items-center justify-between gap-1 text-[11px] font-bold tabular-nums text-amber-700">
                        <span className="uppercase text-[9px] text-amber-600">2nd examiner</span>
                        <span>{isAbsent ? "AB" : examinerSectionMarks[question.id] === undefined ? "—" : `${Number(examinerSectionMarks[question.id]).toFixed(1)} / ${max}`}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-neutral-200 bg-neutral-50 px-5 py-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex flex-wrap items-center gap-2 text-xs font-bold text-neutral-700">
            <span className="mr-1">{row.studentIndex}</span>
            <span className={`rounded-full px-2 py-0.5 ${isComplete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {isAbsent ? "Absent" : isComplete ? "Complete" : `${requiredEntered}/${requiredCount} required marks entered`}
            </span>
            {!isAbsent && (
              <span className="inline-flex items-center gap-1.5 text-neutral-600">
                <span className="h-1.5 w-20 rounded-full bg-neutral-200 overflow-hidden">
                  <span className={`block h-full rounded-full ${progressPct === 100 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${progressPct}%` }} />
                </span>
                {progressPct}%
              </span>
            )}
            {entered > 0 && !isAbsent && <span className="text-neutral-600">Section total {total.toFixed(1)} / {maxScore}</span>}
            {!isReadOnly && !isAbsent && <span className="hidden lg:inline font-medium text-neutral-500">Save Marks on the Ledger to persist this draft.</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {isEditing ? (
              <>
                <button type="button" onClick={cancelEdit} className="h-9 px-3 rounded-lg border border-neutral-200 bg-white text-xs font-bold text-neutral-700 hover:bg-neutral-100 cursor-pointer">Cancel</button>
                <button type="button" onClick={handleSave} className="h-9 px-4 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700 flex items-center gap-1.5 cursor-pointer">
                  <Save className="h-3.5 w-3.5" />Save
                </button>
              </>
            ) : (
              <>
                {!isReadOnly && !isAbsent && (
                  <button type="button" onClick={() => setIsEditing(true)} className="h-9 px-3 rounded-lg border border-emerald-200 bg-white text-xs font-bold text-emerald-700 hover:bg-emerald-50 flex items-center gap-1.5 cursor-pointer">
                    <Pencil className="h-3.5 w-3.5" />Edit marks
                  </button>
                )}
                <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg bg-neutral-200 text-xs font-bold text-neutral-800 hover:bg-neutral-300 cursor-pointer">
                  Close
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
