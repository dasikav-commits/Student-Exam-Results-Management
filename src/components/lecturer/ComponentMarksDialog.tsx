"use client";

import React, { useState } from "react";
import { Check, ClipboardList, Hash, Pencil, Percent, Save, Sigma, Target, X } from "lucide-react";
import type { CaComponent, CaGroup, StudentMarkRecord } from "@/types/hod";
import {
  caGroupOf,
  caTypeLabel,
  componentMaxScore,
  componentQuestionKeys,
  componentQuestionMax,
  componentRequiredAnswers,
  computeRowTotal,
  enteredMarks,
} from "@/lib/lecturer-marks";

export interface ComponentMarksDialogProps {
  comp: CaComponent;
  row: StudentMarkRecord;
  isReadOnly: boolean;
  initiallyEditing?: boolean;
  onSave: (studentIndex: string, compId: string, marks: Record<string, number | null>) => void;
  onClose: () => void;
}

function Chip({ icon: Icon, label, value, tone }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: "violet" | "orange" | "neutral";
}) {
  const tones = {
    violet: "bg-violet-50 text-violet-700 border-violet-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
    neutral: "bg-neutral-50 text-neutral-600 border-neutral-200",
  } as const;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${tones[tone]}`}>
      <Icon className="h-3 w-3" />
      {label}
      <span className="font-black">{value}</span>
    </span>
  );
}

function formatMark(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(1);
}

export function ComponentMarksDialog({
  comp,
  row,
  isReadOnly,
  initiallyEditing = false,
  onSave,
  onClose,
}: ComponentMarksDialogProps) {
  const group: CaGroup = comp.group ?? caGroupOf(comp.type);
  const isGroupA = group === "A";
  const keys = componentQuestionKeys(comp);
  const required = componentRequiredAnswers(comp);
  const maxScore = componentMaxScore(comp);
  const name = comp.name?.trim() || caTypeLabel(comp.type);
  const isAbsent = row.isAbsentCa?.[comp.id] === true;
  const sourceMarks = row.caQuestionsMarks?.[comp.id] ?? {};

  const [isEditing, setIsEditing] = useState(initiallyEditing && !isReadOnly && !isAbsent);
  const [draftMarks, setDraftMarks] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(keys.map(key => [key, sourceMarks[key] ?? null]))
  );

  const answered = enteredMarks(draftMarks).length;
  const countedAnswers = Math.min(answered, required);
  const isComplete = isAbsent || answered >= required;
  const total = computeRowTotal(draftMarks, required, comp.scoreMode);
  const hasMark = answered > 0;
  const tone = isGroupA ? "violet" : "orange";

  const setMark = (key: string, value: number | null) => {
    const max = Math.max(0, componentQuestionMax(comp, key));
    const nextValue = value === null
      ? null
      : Math.min(max, Math.max(0, Number.isFinite(value) ? value : 0));
    setDraftMarks(current => ({ ...current, [key]: nextValue }));
  };

  const handleInput = (key: string, raw: string) => {
    if (raw.trim() === "") {
      setMark(key, null);
      return;
    }
    const value = Number(raw);
    if (Number.isFinite(value)) setMark(key, value);
  };

  const handleSave = () => {
    if (isReadOnly || isAbsent) return;
    onSave(row.studentIndex, comp.id, draftMarks);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setDraftMarks(Object.fromEntries(keys.map(key => [key, sourceMarks[key] ?? null])));
    setIsEditing(false);
  };

  const headerTone = isGroupA
    ? "bg-violet-50/70 text-violet-700"
    : "bg-orange-50/70 text-orange-700";

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-900/55 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${row.studentIndex} ${name} marks`}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        <header className={`shrink-0 px-5 py-4 border-b border-neutral-200 flex items-start gap-3 ${headerTone}`}>
          <span className={`mt-0.5 h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-white ${isGroupA ? "bg-violet-600" : "bg-orange-500"}`}>
            <ClipboardList className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-black text-sm text-neutral-800">{row.studentIndex}</h2>
              <span className="text-neutral-300">/</span>
              <h3 className="font-black text-sm text-neutral-800">{name}</h3>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${isGroupA ? "bg-violet-100 text-violet-700 border-violet-200" : "bg-orange-100 text-orange-700 border-orange-200"}`}>
                GROUP {group}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{caTypeLabel(comp.type)}</span>
            </div>
            <p className="text-[11px] text-neutral-500 mt-1">
              {isGroupA
                ? "One overall mark for this practical or performance component."
                : "Enter each question mark, or use the quick buttons for full weightage or zero."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close component marks"
            className="ml-auto h-8 w-8 rounded-lg flex items-center justify-center text-neutral-400 hover:bg-white hover:text-neutral-700 transition-colors cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="shrink-0 px-5 py-3 border-b border-neutral-100 flex flex-wrap items-center gap-2">
          <Chip icon={Percent} label="Weightage" value={`${Number(comp.weightage) || 0}%`} tone={tone} />
          <Chip icon={Sigma} label="Score mode" value={comp.scoreMode} tone="neutral" />
          <Chip icon={Hash} label={isGroupA ? "Overall mark" : "Questions"} value={isGroupA ? "1" : `${keys.length}`} tone={tone} />
          <Chip icon={Target} label="Maximum" value={`${maxScore}`} tone="neutral" />
          {!isGroupA && (
            <Chip icon={ClipboardList} label="Answers counted" value={`${required}`} tone="neutral" />
          )}
        </div>

        {isAbsent && (
          <div className="shrink-0 mx-5 mt-4 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-[11px] font-semibold text-rose-700">
            This component is marked absent. Use the register&apos;s row-level Absent control to change the student&apos;s CA attendance.
          </div>
        )}

        {isGroupA ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-8 flex items-center justify-center">
            <div className={`w-full max-w-md rounded-2xl border p-5 sm:p-6 ${isAbsent ? "border-rose-200 bg-rose-50/50" : "border-violet-200 bg-violet-50/60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Overall mark</p>
                  <p className="text-xs text-neutral-500 mt-1">Out of {componentQuestionMax(comp, "Q1")} marks</p>
                </div>
                {!isAbsent && (
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${isComplete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {isComplete ? "Entered" : "Not entered"}
                  </span>
                )}
              </div>

              {isAbsent ? (
                <div className="mt-5 text-3xl font-black text-rose-700">AB</div>
              ) : isEditing ? (
                <div className="mt-4 flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max={componentQuestionMax(comp, "Q1")}
                    step="any"
                    value={draftMarks.Q1 ?? ""}
                    placeholder="Enter mark"
                    autoFocus
                    aria-label={`${row.studentIndex} overall mark out of ${componentQuestionMax(comp, "Q1")}`}
                    onChange={event => handleInput("Q1", event.target.value)}
                    className="min-w-0 flex-1 rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-lg font-black tabular-nums focus:border-violet-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    title="Set full marks"
                    aria-label="Set full marks"
                    onClick={() => setMark("Q1", componentQuestionMax(comp, "Q1"))}
                    className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 hover:bg-emerald-200 flex items-center justify-center cursor-pointer"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Set zero"
                    aria-label="Set zero"
                    onClick={() => setMark("Q1", 0)}
                    className="h-10 w-10 rounded-xl bg-rose-100 text-rose-700 hover:bg-rose-200 flex items-center justify-center cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-4xl font-black tracking-tight text-violet-800 tabular-nums">
                  {hasMark ? formatMark(draftMarks.Q1) : "—"}
                  <span className="ml-2 text-base font-bold text-violet-400">/ {componentQuestionMax(comp, "Q1")}</span>
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="shrink-0 px-5 pt-4 pb-2 flex items-center justify-between gap-3 text-[11px] text-neutral-500">
            <span>Five questions per row · tick for full marks · cross for zero · type a partial mark.</span>
            <span className="shrink-0 font-bold tabular-nums">{countedAnswers}/{required} counted</span>
          </div>
        )}

        {!isGroupA && (
          <div className="flex-1 min-h-0 h-[min(54vh,430px)] min-h-[220px] overflow-y-auto overscroll-contain px-5 pb-4 pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2.5">
              {keys.map(key => {
                const max = componentQuestionMax(comp, key);
                const value = draftMarks[key];
                return (
                  <div
                    key={key}
                    className={`min-w-0 rounded-xl border px-2.5 py-2 ${isAbsent ? "border-rose-100 bg-rose-50/40" : "border-orange-100 bg-orange-50/40"}`}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{key}</span>
                      <span className="text-[9px] font-bold tabular-nums text-neutral-400">/{max}</span>
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
                          aria-label={`${row.studentIndex} ${key} out of ${max}`}
                          onChange={event => handleInput(key, event.target.value)}
                          className="h-8 min-w-0 w-full flex-1 rounded-md border border-neutral-200 bg-white px-1.5 text-center text-xs font-black tabular-nums focus:border-orange-400 focus:outline-none"
                        />
                        <button
                          type="button"
                          title={`${key}: full marks (${max})`}
                          aria-label={`${key}: set full marks`}
                          onClick={() => setMark(key, max)}
                          className="h-8 w-7 shrink-0 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 flex items-center justify-center cursor-pointer"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title={`${key}: zero`}
                          aria-label={`${key}: set zero`}
                          onClick={() => setMark(key, 0)}
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
                  </div>
                );
              })}
            </div>
            {keys.length === 0 && (
              <p className="py-8 text-center text-sm italic text-neutral-400">No questions are configured for this component.</p>
            )}
          </div>
        )}

        <footer className="shrink-0 border-t border-neutral-200 bg-neutral-50 px-5 py-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 text-[11px] font-bold text-neutral-500">
            <span className="mr-2">{row.studentIndex}</span>
            <span className={`rounded-full px-2 py-0.5 ${isComplete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {isAbsent ? "Absent" : isComplete ? "Complete" : `${countedAnswers}/${required} entered`}
            </span>
            {!isAbsent && hasMark && <span className="ml-2 text-neutral-400">Total {total.toFixed(1)} / {maxScore}</span>}
            {!isReadOnly && <span className="hidden lg:inline ml-2 font-medium text-neutral-400">Use Save Marks on the register to persist this draft.</span>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="h-9 px-3 rounded-lg border border-neutral-200 bg-white text-xs font-bold text-neutral-600 hover:bg-neutral-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="h-9 px-4 rounded-lg bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5" />Save
                </button>
              </>
            ) : (
              <>
                {!isReadOnly && !isAbsent && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="h-9 px-3 rounded-lg border border-indigo-200 bg-white text-xs font-bold text-indigo-700 hover:bg-indigo-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-3 rounded-lg bg-neutral-200 text-xs font-bold text-neutral-700 hover:bg-neutral-300 cursor-pointer"
                >
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
