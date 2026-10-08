"use client";

import React, { useState } from "react";
import { CheckCircle2, ClipboardList, Pencil, Save, X } from "lucide-react";
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

const SECTION_META: Record<FinalSectionKey, { label: string; parent: "theory" | "practical"; tone: string }> = {
  mcq: { label: "Theory · MCQ", parent: "theory", tone: "sky" },
  essay: { label: "Theory · Essay", parent: "theory", tone: "violet" },
  practical: { label: "Practical", parent: "practical", tone: "amber" },
};

function sectionMarks(sectionKey: FinalSectionKey, marks: FinalPaperMarks | null | undefined): Record<string, number> {
  return getFinalSectionMarks(marks, sectionKey) as Record<string, number>;
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
  const questions = section.questions;
  const requiredCount = finalSectionRequiredCount(section);
  const maxScore = finalSectionMaxScore(section);
  const lecturerMarks = sectionMarks(sectionKey, row.finalExamQuestionsMarks);
  const examinerSectionMarks = sectionMarks(sectionKey, secondMarks);
  const [isEditing, setIsEditing] = useState(false);
  const [draftMarks, setDraftMarks] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(questions.map(question => [question.id, lecturerMarks[question.id] ?? null]))
  );

  const entered = questions.filter(question => {
    const value = draftMarks[question.id];
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  }).length;
  const requiredEntered = questions.slice(0, requiredCount).filter(question => {
    const value = draftMarks[question.id];
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  }).length;
  const total = computeFinalSectionTotal(draftMarks, section);
  const isComplete = isAbsent || requiredEntered >= requiredCount;

  const changeMark = (questionId: string, raw: string, max: number) => {
    if (raw.trim() === "") {
      setDraftMarks(current => ({ ...current, [questionId]: null }));
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setDraftMarks(current => ({
      ...current,
      [questionId]: Math.min(max, Math.max(0, value)),
    }));
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

  const badgeTone = {
    sky: "border-sky-200 bg-sky-50 text-sky-800",
    violet: "border-violet-200 bg-violet-50 text-violet-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
  }[meta.tone];

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-900/55 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${row.studentIndex} ${meta.label} marks`}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        <header className="shrink-0 px-5 py-4 border-b border-neutral-200 bg-neutral-50/70 flex items-start gap-3">
          <span className="mt-0.5 h-9 w-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-600 text-white">
            <ClipboardList className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-black text-base text-neutral-900">{row.studentIndex}</h2>
              <span className="text-neutral-400">/</span>
              <h3 className="font-black text-base text-neutral-900">{meta.label}</h3>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${badgeTone}`}>
                {meta.parent.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-neutral-600 mt-1">
              Enter marks question by question. Marks are lecturer-entered and are not automatically graded.
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

        <div className="shrink-0 px-5 py-3 border-b border-neutral-100 flex flex-wrap items-center gap-2 text-[11px] font-bold text-neutral-600">
          <span className={`px-2.5 py-1.5 rounded-lg border ${badgeTone}`}>{questions.length} question{questions.length === 1 ? "" : "s"}</span>
          <span className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50">Required {requiredCount}</span>
          <span className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50">Section max {maxScore}</span>
          <span className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50">Final weight share {finalSectionWeightage(blueprint, sectionKey).toFixed(1)}%</span>
          {showExaminerMarks && (
            <span className="px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">Second-examiner marks shown for comparison</span>
          )}
        </div>

        {isAbsent && (
          <div className="shrink-0 mx-5 mt-4 px-3 py-2.5 rounded-lg border border-rose-300 bg-rose-50 text-xs font-semibold text-rose-800">
            The student is absent for {meta.parent === "theory" ? "Theory" : "Practical"}. Existing marks are preserved, but this parent section currently contributes zero. Change absence using the parent-level AB control on the register.
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
          {questions.length === 0 ? (
            <p className="py-10 text-center text-sm italic text-neutral-500">No questions are configured for this section.</p>
          ) : (
            <div className="space-y-2">
              <div className={`hidden sm:grid ${showExaminerMarks ? "grid-cols-[minmax(0,1fr)_8rem_8rem]" : "grid-cols-[minmax(0,1fr)_8rem]"} gap-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500`}>
                <span>Question</span>
                <span className="text-right">Lecturer mark</span>
                {showExaminerMarks && <span className="text-right text-amber-700">2nd examiner</span>}
              </div>
              {questions.map((question, index) => {
                const value = draftMarks[question.id];
                const counted = index < requiredCount;
                return (
                  <div
                    key={question.id}
                    className={`grid ${showExaminerMarks ? "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]" : "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_8rem]"} items-center gap-2 sm:gap-3 rounded-xl border px-3 py-2.5 ${counted ? "border-neutral-200 bg-white" : "border-neutral-100 bg-neutral-50/70"}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-7 min-w-7 px-1 rounded-lg bg-neutral-100 text-neutral-700 flex items-center justify-center text-[10px] font-black">{question.id}</span>
                      <span className="text-[11px] font-semibold text-neutral-700">Maximum {question.maxMarks}</span>
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
                      <span className="sm:hidden text-[10px] font-bold uppercase text-neutral-500">Lecturer</span>
                      {isEditing && !isAbsent ? (
                        <input
                          type="number"
                          min="0"
                          max={question.maxMarks}
                          step="any"
                          value={value ?? ""}
                          placeholder="—"
                          aria-label={`${row.studentIndex} ${meta.label} ${question.id} out of ${question.maxMarks}`}
                          onChange={event => changeMark(question.id, event.target.value, question.maxMarks)}
                          className="h-9 w-28 rounded-lg border border-emerald-200 bg-white px-2 text-right text-sm font-black tabular-nums focus:border-emerald-500 focus:outline-none"
                        />
                      ) : (
                        <span className={`inline-flex min-w-20 justify-end rounded-lg px-2 py-1 text-sm font-black tabular-nums ${isAbsent ? "bg-rose-50 text-rose-600" : "bg-neutral-50 text-neutral-800"}`}>
                          {isAbsent ? "AB" : value === null || value === undefined ? "—" : Number(value).toFixed(1)}
                          {!isAbsent && <span className="ml-1 text-[10px] font-semibold text-neutral-400">/{question.maxMarks}</span>}
                        </span>
                      )}
                    </div>
                    {showExaminerMarks && (
                      <div className="flex items-center justify-between sm:justify-end gap-2 text-sm font-bold text-amber-700 tabular-nums">
                        <span className="sm:hidden text-[10px] uppercase text-amber-600">2nd examiner</span>
                        {isAbsent ? "AB" : examinerSectionMarks[question.id] === undefined ? "—" : `${Number(examinerSectionMarks[question.id]).toFixed(1)} / ${question.maxMarks}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-neutral-200 bg-neutral-50 px-5 py-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 text-xs font-bold text-neutral-700">
            <span className="mr-2">{row.studentIndex}</span>
            <span className={`rounded-full px-2 py-0.5 ${isComplete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {isAbsent ? "Absent" : isComplete ? "Complete" : `${requiredEntered}/${requiredCount} required marks entered`}
            </span>
            {entered > 0 && !isAbsent && <span className="ml-2 text-neutral-600">Section total {total.toFixed(1)} / {maxScore}</span>}
            {!isReadOnly && !isAbsent && <span className="hidden lg:inline ml-2 font-medium text-neutral-500">Save the marksheet on the register to persist this draft.</span>}
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
                  {isComplete && !isAbsent ? <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" /> : null}
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
