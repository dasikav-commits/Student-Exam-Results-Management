import type { CaComponent, FinalBlueprint, FinalSectionKey } from "@/types/hod";
import {
  caGroupOf,
  finalSectionMaxScore,
  getFinalPaperSections,
  caTypeLabel,
  componentMaxScore,
  componentRequiredAnswers,
  computeFinalPaperTotals,
  computeRowTotal,
  computeWeightedScores,
  enteredMarks,
  hasAnyMark,
  isRowEligible,
  normaliseFinalAbsence,
  type MarkRowLike,
} from "@/lib/lecturer-marks";

/**
 * Printable full Marksheet: every eligible student's CA components, Final Paper
 * sections, weighted module mark and (when present) Second Examiner raw total.
 * Rendered as HTML for the browser print dialog, where "Save as PDF" produces
 * the PDF. Ineligible rows are omitted, matching the CSV and CA PDF exports.
 */
export interface MarksheetPrintOptions {
  moduleCode: string;
  moduleName: string;
  components: CaComponent[];
  finalBlueprint: FinalBlueprint;
  rows: MarkRowLike[];
  printedBy?: string;
  /** Lecturer-facing status label, e.g. "Draft" or "Sent to HOD". */
  statusLabel?: string;
}

const FINAL_SECTION_LABELS: Record<FinalSectionKey, string> = {
  mcq: "Theory · MCQ",
  essay: "Theory · Essay",
  practical: "Practical",
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmt(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(1);
}

export function buildMarksheetPrintHtml({
  moduleCode,
  moduleName,
  components,
  finalBlueprint,
  rows,
  printedBy,
  statusLabel,
}: MarksheetPrintOptions): string {
  const caComponents = [...(components ?? [])].sort((a, b) => {
    const ga = caGroupOf(a.type) === "A" ? 0 : 1;
    const gb = caGroupOf(b.type) === "A" ? 0 : 1;
    return ga - gb;
  });
  const sections = getFinalPaperSections(finalBlueprint).filter(section => section.blueprint.questions.length > 0);
  const eligibleRows = rows.filter(isRowEligible);
  const excluded = rows.length - eligibleRows.length;
  const caWeight = caComponents.reduce((sum, comp) => sum + (Number(comp.weightage) || 0), 0);
  const finalWeight = Number(finalBlueprint.enabled ? finalBlueprint.weightage : 0) || 0;
  const hasExaminer = eligibleRows.some(row => hasAnyMark(row.secondExamMarks));

  const caHead = caComponents
    .map(comp => {
      const name = comp.name?.trim() || caTypeLabel(comp.type);
      return `<th class="comp">${esc(name)}<span class="sub">${Number(comp.weightage) || 0}% · max ${fmt(componentMaxScore(comp))}</span></th>`;
    })
    .join("");

  const finalHead = sections
    .map(section => `<th class="comp">${esc(FINAL_SECTION_LABELS[section.key])}<span class="sub">raw / ${fmt(finalSectionMaxScore(section.blueprint))}</span></th>`)
    .join("");

  const body = eligibleRows
    .map((row, index) => {
      const weighted = computeWeightedScores(row, caComponents, finalBlueprint);
      const finalTotals = computeFinalPaperTotals(row, finalBlueprint);
      const absence = normaliseFinalAbsence(row);
      const caCells = caComponents
        .map(comp => {
          if (row.isAbsentCa?.[comp.id] === true) return `<td class="absent">AB</td>`;
          const marks = row.caQuestionsMarks?.[comp.id] ?? {};
          if (enteredMarks(marks).length === 0) return `<td class="blank">—</td>`;
          const total = computeRowTotal(marks, componentRequiredAnswers(comp), comp.scoreMode);
          return `<td>${fmt(total)}<span class="out"> / ${fmt(componentMaxScore(comp))}</span></td>`;
        })
        .join("");

      const finalCells = sections
        .map(section => {
          const parentAbsent = section.key === "practical" ? absence.isAbsentPractical : absence.isAbsentTheory;
          if (parentAbsent) return `<td class="absent">AB</td>`;
          return `<td>${fmt(finalTotals.sectionRaw[section.key])}<span class="out"> / ${fmt(finalTotals.sectionMax[section.key])}</span></td>`;
        })
        .join("");

      const examinerCell = hasExaminer
        ? `<td>${hasAnyMark(row.secondExamMarks) ? fmt(computeFinalPaperTotals(row, finalBlueprint, row.secondExamMarks).rawTotal) : "—"}</td>`
        : "";

      return (
        `<tr>` +
        `<td class="left">${index + 1}. <strong>${esc(row.studentIndex)}</strong>` +
        `${absence.isAbsentTheory ? ` <span class="tag">THEORY AB</span>` : ""}` +
        `${absence.isAbsentPractical ? ` <span class="tag">PRACTICAL AB</span>` : ""}</td>` +
        caCells +
        `<td class="grand">${fmt(weighted.ca)}</td>` +
        finalCells +
        `<td class="grand">${fmt(finalTotals.weighted)}</td>` +
        examinerCell +
        `<td class="grand total">${fmt(weighted.total)}</td>` +
        `</tr>`
      );
    })
    .join("");

  const columnCount = 1 + caComponents.length + 1 + sections.length + 1 + (hasExaminer ? 1 : 0) + 1;
  const empty = eligibleRows.length === 0
    ? `<tr><td colspan="${columnCount}" class="empty">No eligible students on this marksheet.</td></tr>`
    : "";

  const generatedAt = new Date().toLocaleString();

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(moduleCode)} — Full Marksheet</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #171717; margin: 24px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 3px; }
  .meta { font-size: 11px; color: #444; margin-bottom: 14px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #999; padding: 6px 7px; text-align: center; }
  th { background: #f1f1f1; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; }
  th .sub { display: block; margin-top: 3px; font-size: 9px; font-weight: 500; text-transform: none; letter-spacing: 0; color: #444; }
  td.left, th.left { text-align: left; white-space: nowrap; }
  td .out { color: #555; font-size: 9px; font-weight: 500; }
  td.blank { color: #666; }
  td.absent { color: #b91c1c; font-weight: 800; background: #fff1f2; }
  td.grand { font-weight: 800; background: #eef2ff; }
  td.total { background: #e0e7ff; font-size: 12px; }
  .tag { font-size: 8px; font-weight: 800; color: #b91c1c; border: 1px solid #fca5a5; padding: 1px 3px; border-radius: 3px; }
  td.empty { padding: 20px; color: #555; font-style: italic; }
  .sig { display: flex; justify-content: space-between; margin-top: 36px; gap: 24px; font-size: 11px; }
  .sig div { flex: 1; border-top: 1px solid #555; padding-top: 4px; }
  .note { margin-top: 12px; font-size: 10px; color: #444; line-height: 1.5; }
  @page { size: landscape; margin: 10mm; }
</style>
</head>
<body>
  <h1>${esc(moduleCode)} — ${esc(moduleName)}</h1>
  <div class="meta">
    Full Marksheet · CA weightage ${caWeight}% · Final Paper weightage ${finalWeight}% · ${eligibleRows.length} eligible student(s)${
      excluded > 0 ? ` · ${excluded} ineligible row(s) excluded` : ""
    }${statusLabel ? ` · Status: ${esc(statusLabel)}` : ""}<br />
    Printed ${esc(generatedAt)}${printedBy ? ` by ${esc(printedBy)}` : ""}
  </div>
  <table>
    <thead>
      <tr>
        <th class="left">Student No</th>
        ${caHead}
        <th>CA weighted<span class="sub">out of ${caWeight}</span></th>
        ${finalHead}
        <th>Final weighted<span class="sub">out of ${finalWeight}</span></th>
        ${hasExaminer ? `<th>2nd Examiner raw</th>` : ""}
        <th>Module Mark<span class="sub">out of 100</span></th>
      </tr>
    </thead>
    <tbody>${body}${empty}</tbody>
  </table>
  <p class="note">
    Component cells show raw totals against each maximum; weighted columns show each block's contribution to the module mark.
    AB marks absence for that component or Final Paper parent. Absent parents contribute zero to the weighted totals.
  </p>
  <div class="sig">
    <div>Lecturer</div>
    <div>Second Examiner</div>
    <div>Head of Department</div>
  </div>
</body>
</html>`;
}

/** Opens the printable full Marksheet. Returns false if the popup was blocked. */
export function openMarksheetPrintWindow(options: MarksheetPrintOptions): boolean {
  if (typeof window === "undefined") return false;
  const win = window.open("", "_blank", "width=1200,height=820");
  if (!win) return false;
  win.document.open();
  win.document.write(buildMarksheetPrintHtml(options));
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 300);
  return true;
}
