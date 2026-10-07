import type { CaComponent, CaGroup } from "@/types/hod";
import {
  caGroupOf,
  caTypeLabel,
  componentQuestionKeys,
  componentQuestionMax,
  componentRequiredAnswers,
  computeRowTotal,
  computeWeightedScores,
  isRowEligible,
  type MarkRowLike,
} from "@/lib/lecturer-marks";

/**
 * Print-to-PDF export for the CA Evaluation Grid.
 *
 * Renders the same grouped A/B register the Lecturer Desk shows on screen into
 * a throwaway window and hands it to the browser's print dialog, so the saved
 * PDF keeps the exact multi-level header without adding a PDF dependency.
 * Ineligible students are omitted — the printout is the official cohort sheet.
 *
 * Column layout per component: [Q1…Qn] [Tot] [AB], mirroring the on-screen grid.
 */

export interface CaPrintOptions {
  moduleCode: string;
  moduleName: string;
  components: CaComponent[];
  rows: MarkRowLike[];
  printedBy?: string;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function groupOf(comp: CaComponent): CaGroup {
  return comp.group ?? caGroupOf(comp.type);
}

/** Columns one component occupies: its questions + total + absent. */
function spanOf(comp: CaComponent): number {
  return componentQuestionKeys(comp).length + 2;
}

export function buildCaPrintHtml({
  moduleCode,
  moduleName,
  components,
  rows,
  printedBy,
}: CaPrintOptions): string {
  const comps = components ?? [];
  const groupA = comps.filter(comp => groupOf(comp) === "A");
  const groupB = comps.filter(comp => groupOf(comp) === "B");
  const eligibleRows = rows.filter(isRowEligible);
  const excluded = rows.length - eligibleRows.length;

  const spanA = groupA.reduce((sum, comp) => sum + spanOf(comp), 0);
  const spanB = groupB.reduce((sum, comp) => sum + spanOf(comp), 0);

  const headLevel1 = [
    `<th rowspan="3" class="left">Student No</th>`,
    spanA > 0 ? `<th colspan="${spanA}" class="grp a">Group A — practical / performance</th>` : "",
    spanB > 0 ? `<th colspan="${spanB}" class="grp b">Group B — written / discrete</th>` : "",
    `<th rowspan="3">CA Total</th>`,
    `<th rowspan="3">Eligible</th>`,
  ].join("");

  const headLevel2 = comps
    .map(comp => {
      const group = groupOf(comp);
      return (
        `<th colspan="${spanOf(comp)}" class="comp ${group === "A" ? "a" : "b"}">` +
        `${esc(comp.name?.trim() || caTypeLabel(comp.type))}` +
        `<span class="sub">${Number(comp.weightage) || 0}% · ${esc(comp.scoreMode)}</span></th>`
      );
    })
    .join("");

  const headLevel3 = comps
    .map(comp => {
      const qCells = componentQuestionKeys(comp)
        .map(
          q =>
            `<th class="q">${groupOf(comp) === "A" ? "Mark" : esc(q)}` +
            `<span class="sub">/${componentQuestionMax(comp, q)}</span></th>`
        )
        .join("");
      return `${qCells}<th class="q">Tot</th><th class="q ab">AB</th>`;
    })
    .join("");

  const body = eligibleRows
    .map((row, rowIndex) => {
      const compCells = comps
        .map(comp => {
          const absent = row.isAbsentCa?.[comp.id] === true;
          const marks = (row.caQuestionsMarks?.[comp.id] ?? {}) as Record<string, unknown>;
          const keys = componentQuestionKeys(comp);

          const qCells = keys
            .map(q => {
              const raw = marks[q];
              const value = absent ? "AB" : (typeof raw === "number" ? raw : "");
              return `<td class="${absent ? "ab-cell" : ""}">${esc(value)}</td>`;
            })
            .join("");

          const total = absent
            ? "AB"
            : computeRowTotal(marks, componentRequiredAnswers(comp), comp.scoreMode).toFixed(1);

          return `${qCells}<td class="tot">${esc(total)}</td><td class="ab-col">${absent ? "AB" : ""}</td>`;
        })
        .join("");

      const weighted = computeWeightedScores(row, comps, null);
      return (
        `<tr>` +
        `<td class="left idx">${rowIndex + 1}. <strong>${esc(row.studentIndex)}</strong></td>` +
        compCells +
        `<td class="grand">${weighted.ca.toFixed(1)}</td>` +
        `<td>&#10003;</td>` +
        `</tr>`
      );
    })
    .join("");

  const emptyRow =
    eligibleRows.length === 0
      ? `<tr><td colspan="${spanA + spanB + 3}" class="empty">No eligible students on this marksheet.</td></tr>`
      : "";

  const caWeight = comps.reduce((sum, comp) => sum + (Number(comp.weightage) || 0), 0);
  const generatedAt = new Date().toLocaleString();

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(moduleCode)} — CA Evaluation Grid</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #171717; margin: 24px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .meta { font-size: 10px; color: #666; margin-bottom: 14px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: center; }
  th { background: #f4f4f4; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
  th.left, td.left { text-align: left; }
  th.grp.a { background: #f3eefe; }
  th.grp.b { background: #fef3e8; }
  th.comp.a { background: #f8f4ff; }
  th.comp.b { background: #fff8f1; }
  th .sub { display: block; font-weight: 400; text-transform: none; letter-spacing: 0; color: #777; }
  th.q { font-size: 9px; }
  th.ab, td.ab-col { background: #fafafa; width: 26px; }
  td.ab-cell { color: #b91c1c; font-weight: 700; }
  td.tot { font-weight: 700; }
  td.grand { font-weight: 800; background: #eef2ff; }
  td.empty { padding: 18px; color: #888; font-style: italic; }
  .note { margin-top: 10px; font-size: 9px; color: #777; }
  @page { size: landscape; margin: 12mm; }
</style>
</head>
<body>
  <h1>${esc(moduleCode)} — ${esc(moduleName)}</h1>
  <div class="meta">
    CA Evaluation Grid · CA weightage ${caWeight}% · ${eligibleRows.length} eligible student(s)${
      excluded > 0 ? ` · ${excluded} ineligible row(s) excluded` : ""
    }<br />
    Printed ${esc(generatedAt)}${printedBy ? ` by ${esc(printedBy)}` : ""}
  </div>
  <table>
    <thead>
      <tr>${headLevel1}</tr>
      <tr>${headLevel2}</tr>
      <tr>${headLevel3}</tr>
    </thead>
    <tbody>${body}${emptyRow}</tbody>
  </table>
  <p class="note">
    Group A components carry one overall mark per student; Group B components are scored question by
    question, each capped at that question's own weightage. AB = absent (no marks awarded).
  </p>
</body>
</html>`;
}

/** Opens the print dialog for the CA grid. Returns false if the popup was blocked. */
export function openCaGridPrintWindow(options: CaPrintOptions): boolean {
  if (typeof window === "undefined") return false;
  const win = window.open("", "_blank", "width=1150,height=800");
  if (!win) return false;
  win.document.open();
  win.document.write(buildCaPrintHtml(options));
  win.document.close();
  win.focus();
  // Give the popup a beat to lay out before the dialog opens.
  window.setTimeout(() => win.print(), 300);
  return true;
}
