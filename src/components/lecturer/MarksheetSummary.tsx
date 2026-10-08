"use client";

import React from "react";
import { CheckCircle2, Download, TriangleAlert, X } from "lucide-react";

export interface MarksheetSummaryRow {
  studentIndex: string;
  /** Weighted CA contribution out of the CA block total. */
  ca: number;
  /** Weighted final-exam contribution out of the final block total. */
  final: number;
  /** Weighted module mark out of 100 (when the blueprint weights total 100%). */
  total: number;
  caMax: number;
  finalMax: number;
  /** Percentage of required cells captured for this student. */
  progress: number;
  isAbsentTheory: boolean;
  isAbsentPractical: boolean;
  isAbsentFinal: boolean;
  /** Second Examiner's raw final total (only shown after second checking). */
  examTotal?: number | null;
  /** Absolute difference between the two final-paper totals. */
  variance?: number | null;
  varianceFlagged?: boolean;
  issueCount: number;
}

export interface MarksheetSummaryProps {
  rows: MarksheetSummaryRow[];
  moduleName: string;
  showComparison: boolean;
  /** Optional — when omitted the CSV control is hidden (the report page has its own). */
  onExport?: () => void;
  /** Optional — when omitted no close control is shown. */
  onClose?: () => void;
  /** Roster rows unticked as ineligible — shown for transparency, never averaged. */
  excludedCount?: number;
}

function scoreTone(total: number): string {
  if (total >= 75) return "text-emerald-700 bg-emerald-50 border-emerald-100";
  if (total >= 40) return "text-indigo-700 bg-indigo-50 border-indigo-100";
  return "text-rose-700 bg-rose-50 border-rose-100";
}

/**
 * Computed overview of the marksheet: each student's weighted CA / final / module
 * mark derived from the module's own blueprint, plus completeness and any
 * variance against the Second Examiner. No grades are assigned here — the
 * weighting is pure arithmetic on the blueprint the lecturer configured.
 */
export function MarksheetSummary({
  rows,
  moduleName,
  showComparison,
  onExport,
  onClose,
  excludedCount = 0,
}: MarksheetSummaryProps) {
  const completeCount = rows.filter(row => row.progress === 100).length;
  const flaggedCount = rows.filter(row => row.varianceFlagged).length;
  const average = rows.length > 0
    ? Math.round((rows.reduce((sum, row) => sum + row.total, 0) / rows.length) * 10) / 10
    : 0;

  return (
    <div className="bg-white rounded-2xl premium-border overflow-hidden">
      <div className="border-b border-neutral-200 bg-neutral-50/60 px-5 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-indigo-600" />
          <h3 className="text-xs font-black uppercase tracking-wider text-neutral-600">
            Marksheet Summary
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
            {rows.length} student{rows.length === 1 ? "" : "s"}
          </span>
          <span className={`px-2 py-0.5 rounded-full ${completeCount === rows.length ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {completeCount}/{rows.length} complete
          </span>
          <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
            Average {average.toFixed(1)}/100
          </span>
          {excludedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500" title="Ineligible students are excluded from these figures">
              {excludedCount} ineligible excluded
            </span>
          )}
          {showComparison && flaggedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
              {flaggedCount} variance flag{flaggedCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onExport && (
            <button
              onClick={onExport}
              className="flex items-center gap-1.5 h-8 px-3 text-[11px] font-bold bg-white border border-neutral-200 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />Export CSV
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close summary"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="overflow-auto max-h-[26rem]">
        <table className="w-full text-xs text-left border-collapse">
          <thead className="sticky top-0 bg-neutral-50">
            <tr className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-200">
              <th className="px-4 py-3 w-10">#</th>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3 text-center">Captured</th>
              <th className="px-4 py-3 text-center">CA ({rows[0]?.caMax ?? 0}%)</th>
              <th className="px-4 py-3 text-center">Final ({rows[0]?.finalMax ?? 0}%)</th>
              <th className="px-4 py-3 text-center">Module Mark</th>
              {showComparison && (
                <>
                  <th className="px-4 py-3 text-center bg-amber-50/60 text-amber-700">2nd Final raw</th>
                  <th className="px-4 py-3 text-center bg-rose-50/50 text-rose-700">Δ Weighted</th>
                </>
              )}
              <th className="px-4 py-3 text-center">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row, idx) => (
              <tr key={row.studentIndex} className={row.varianceFlagged ? "bg-rose-50/20" : "hover:bg-neutral-50/40"}>
                <td className="px-4 py-2.5 font-bold text-neutral-400">{idx + 1}</td>
                <td className="px-4 py-2.5 font-bold tracking-wider uppercase">
                  {row.studentIndex}
                  {row.isAbsentTheory && (
                    <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">THEORY AB</span>
                  )}
                  {row.isAbsentPractical && (
                    <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">PRACTICAL AB</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${row.progress === 100 ? "bg-emerald-500" : "bg-amber-400"}`}
                        style={{ width: `${row.progress}%` }}
                      />
                    </div>
                    <span className={`text-[10px] font-bold ${row.progress === 100 ? "text-emerald-600" : "text-amber-600"}`}>
                      {row.progress}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-center font-bold text-neutral-700">{row.ca.toFixed(1)}</td>
                <td className="px-4 py-2.5 text-center font-bold text-neutral-700">
                  {row.isAbsentFinal ? <span className="text-neutral-300">—</span> : (
                    <span>{row.final.toFixed(1)}{(row.isAbsentTheory || row.isAbsentPractical) && <span className="ml-1 text-[9px] font-bold text-rose-500">partial AB</span>}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`inline-block min-w-[3.25rem] px-2 py-0.5 rounded-lg border font-extrabold ${scoreTone(row.total)}`}>
                    {row.total.toFixed(1)}
                  </span>
                </td>
                {showComparison && (
                  <>
                    <td className="px-4 py-2.5 text-center font-bold text-amber-700 bg-amber-50/20">
                      {row.examTotal === null || row.examTotal === undefined
                        ? <span className="text-neutral-300">—</span>
                        : row.examTotal.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 text-center bg-rose-50/20">
                      {row.variance === null || row.variance === undefined ? (
                        <span className="text-neutral-300">—</span>
                      ) : row.varianceFlagged ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse inline-block" />
                          {row.variance.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-emerald-600">{row.variance.toFixed(1)}</span>
                      )}
                    </td>
                  </>
                )}
                <td className="px-4 py-2.5 text-center">
                  {row.issueCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                      <TriangleAlert className="h-3 w-3" />{row.issueCount}
                    </span>
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mx-auto" />
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showComparison ? 9 : 7} className="px-4 py-8 text-center text-neutral-400 italic">
                  No students in this marksheet yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-2.5 bg-neutral-50/60 border-t border-neutral-200 text-[10px] text-neutral-400 font-medium">
        Module mark = Σ (marks obtained ÷ marks obtainable × weightage) from the blueprint of <span className="font-bold text-neutral-500">{moduleName}</span>.
      </div>
    </div>
  );
}
