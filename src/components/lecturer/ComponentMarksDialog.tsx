"use client";

import React from "react";
import { ClipboardList, Hash, Percent, Sigma, Target, X } from "lucide-react";
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

/**
 * Drill-down popup for one CA component, opened from its header cell in the
 * unified CA Evaluation Grid. Shows the component's blueprint exactly as it
 * was authored (group, weightage, score mode, per-question weightages) above
 * the full per-student, per-question marks matrix for fast class-wide entry.
 */
export interface ComponentMarksDialogProps {
  comp: CaComponent;
  rows: { row: StudentMarkRecord; index: number }[];
  isReadOnly: boolean;
  onMark: (studentIndex: string, compId: string, questionKey: string, value: number, max: number) => void;
  onToggleAbsent: (studentIndex: string, compId: string) => void;
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

export function ComponentMarksDialog({
  comp,
  rows,
  isReadOnly,
  onMark,
  onToggleAbsent,
  onClose,
}: ComponentMarksDialogProps) {
  const group: CaGroup = comp.group ?? caGroupOf(comp.type);
  const isGroupA = group === "A";
  const keys = componentQuestionKeys(comp);
  const required = componentRequiredAnswers(comp);
  const maxScore = componentMaxScore(comp);
  const name = comp.name?.trim() || caTypeLabel(comp.type);

  const absentCount = rows.filter(({ row }) => row.isAbsentCa[comp.id]).length;
  const completeCount = rows.filter(({ row }) => {
    if (row.isAbsentCa[comp.id]) return true;
    return enteredMarks(row.caQuestionsMarks[comp.id] ?? {}).length >= required;
  }).length;

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-900/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} marks`}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className={`px-5 py-4 border-b border-neutral-200 flex items-start gap-3 ${isGroupA ? "bg-violet-50/60" : "bg-orange-50/60"}`}>
          <span className={`mt-0.5 h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${isGroupA ? "bg-violet-600" : "bg-orange-500"} text-white`}>
            <ClipboardList className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-black text-sm text-neutral-800">{name}</h3>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${isGroupA ? "bg-violet-100 text-violet-700 border-violet-200" : "bg-orange-100 text-orange-700 border-orange-200"}`}>
                GROUP {group}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                {caTypeLabel(comp.type)}
              </span>
            </div>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              {isGroupA
                ? "One overall mark per student, out of the component's total marks."
                : "One mark per question — every question is capped at its own weightage."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close component marks"
            className="ml-auto h-8 w-8 rounded-lg flex items-center justify-center text-neutral-400 hover:bg-white hover:text-neutral-700 transition-colors cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Blueprint strip ────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-b border-neutral-100 flex flex-wrap items-center gap-2">
          <Chip icon={Percent} label="Weightage" value={`${Number(comp.weightage) || 0}%`} tone={isGroupA ? "violet" : "orange"} />
          <Chip icon={Sigma} label="Score mode" value={comp.scoreMode} tone="neutral" />
          {isGroupA ? (
            <Chip icon={Target} label="One mark out of" value={`${componentQuestionMax(comp, "Q1")}`} tone="violet" />
          ) : (
            <Chip icon={Hash} label="Questions" value={`${keys.length}`} tone="orange" />
          )}
          <Chip icon={Target} label="Component max" value={`${maxScore}`} tone="neutral" />
          <Chip icon={ClipboardList} label="Answers counted" value={`${required}`} tone="neutral" />
          {!isGroupA && (
            <div className="flex flex-wrap items-center gap-1 ml-1">
              {keys.map(key => (
                <span
                  key={key}
                  title={`${key} weightage`}
                  className="text-[10px] font-black px-1.5 py-0.5 rounded bg-orange-100/80 text-orange-700 tabular-nums"
                >
                  {key}·{componentQuestionMax(comp, key)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Marks matrix ───────────────────────────────────────────────── */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="sticky top-0">
              <tr className={`text-[10px] font-bold text-neutral-500 uppercase tracking-wider border-b border-neutral-200 ${isGroupA ? "bg-violet-50" : "bg-orange-50"}`}>
                <th className="px-4 py-2.5 w-10">#</th>
                <th className="px-4 py-2.5 w-36">Student</th>
                {keys.map(key => (
                  <th key={key} className="px-2 py-2.5 text-center w-16">
                    {isGroupA ? "Mark" : key}
                    <span className="block text-[9px] text-neutral-400 font-normal">/{componentQuestionMax(comp, key)}</span>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center w-16 text-indigo-700">Total</th>
                <th className="px-3 py-2.5 text-center w-14">AB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map(({ row, index }) => {
                const isAbsent = !!row.isAbsentCa[comp.id];
                const marks = row.caQuestionsMarks[comp.id] ?? {};
                const total = computeRowTotal(marks, required, comp.scoreMode);
                const answered = enteredMarks(marks).length;
                const short = !isAbsent && answered < required;

                return (
                  <tr key={row.studentIndex} className={`${isAbsent ? "bg-neutral-100/70 text-neutral-400 line-through" : short ? "bg-amber-50/40" : "hover:bg-neutral-50/50"} transition-colors`}>
                    <td className="px-4 py-2 font-bold text-neutral-400">{index + 1}</td>
                    <td className="px-4 py-2 font-bold tracking-wider uppercase">{row.studentIndex}</td>
                    {keys.map(key => (
                      <td key={key} className="px-1.5 py-1.5 text-center">
                        {isAbsent ? (
                          <span className="text-neutral-400 font-bold text-[11px]">AB</span>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            max={componentQuestionMax(comp, key)}
                            value={marks[key] ?? ""}
                            placeholder="0"
                            disabled={isReadOnly}
                            aria-label={`${row.studentIndex} ${key}`}
                            onChange={event => onMark(row.studentIndex, comp.id, key, Number(event.target.value), componentQuestionMax(comp, key))}
                            className={`w-14 bg-white border rounded py-1 text-center font-bold focus:outline-none disabled:opacity-40 ${isGroupA ? "focus:border-violet-400" : "focus:border-orange-400"} ${short && marks[key] === undefined ? "border-amber-300" : "border-neutral-200"}`}
                          />
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center font-extrabold text-indigo-600">
                      {isAbsent ? "AB" : answered === 0 ? <span className="text-neutral-300">—</span> : total.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        disabled={isReadOnly}
                        onClick={() => onToggleAbsent(row.studentIndex, comp.id)}
                        title={isAbsent ? "Mark present" : "Mark absent"}
                        className={`px-2 py-1 text-[10px] font-extrabold rounded cursor-pointer disabled:opacity-40 ${isAbsent ? "bg-rose-600 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-rose-50 hover:text-rose-600"}`}
                      >
                        AB
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={keys.length + 4} className="px-4 py-8 text-center text-neutral-400 italic">
                    No students on this marksheet yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-neutral-200 bg-neutral-50/60 flex flex-wrap items-center gap-2 text-[11px] font-bold text-neutral-500">
          <span className="px-2 py-0.5 rounded-full bg-white border border-neutral-200">
            {rows.length} student{rows.length === 1 ? "" : "s"}
          </span>
          <span className={`px-2 py-0.5 rounded-full ${completeCount === rows.length ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {completeCount}/{rows.length} complete
          </span>
          {absentCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">{absentCount} absent</span>
          )}
          <span className="ml-auto text-neutral-400 font-semibold">
            Edits here write straight into the register — remember to Save Marks.
          </span>
        </div>
      </div>
    </div>
  );
}
