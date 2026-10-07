import type { CaComponent, CaGroup } from "@/types/hod";
import {
  caGroupOf,
  caTypeLabel,
  componentMaxScore,
  componentRequiredAnswers,
  computeRowTotal,
  computeWeightedScores,
  enteredMarks,
  isRowEligible,
  type MarkRowLike,
} from "@/lib/lecturer-marks";

/**
 * Print-to-PDF export for the grouped CA register. It uses the browser print
 * dialog so the exported PDF keeps the same one-column-per-component layout
 * without adding a PDF dependency. Ineligible rows are omitted from the
 * official cohort sheet, matching the marksheet audit and CSV export.
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

function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "0.0";
}

function absentCount(row: MarkRowLike, components: CaComponent[]): number {
  return components.reduce((count, comp) => count + (row.isAbsentCa?.[comp.id] === true ? 1 : 0), 0);
}

function rowAbsentLabel(row: MarkRowLike, components: CaComponent[]): string {
  if (components.length === 0) return "—";
  const absent = absentCount(row, components);
  if (absent === components.length) return "AB";
  return absent > 0 ? `${absent}/${components.length}` : "—";
}

export function buildCaPrintHtml({
  moduleCode,
  moduleName,
  components,
  rows,
  printedBy,
}: CaPrintOptions): string {
  const allComponents = components ?? [];
  const groupA = allComponents.filter(comp => groupOf(comp) === "A");
  const groupB = allComponents.filter(comp => groupOf(comp) === "B");
  const orderedComponents = [...groupA, ...groupB];
  const eligibleRows = rows.filter(isRowEligible);
  const excluded = rows.length - eligibleRows.length;
  const caWeight = orderedComponents.reduce((sum, comp) => sum + (Number(comp.weightage) || 0), 0);

  const headGroups = [
    `<th rowspan="2" class="left student">Student No</th>`,
    groupA.length > 0 ? `<th colspan="${groupA.length}" class="grp a">Group A — practical / performance</th>` : "",
    groupB.length > 0 ? `<th colspan="${groupB.length}" class="grp b">Group B — written / discrete</th>` : "",
    `<th rowspan="2" class="grand-head">Total Marks<span class="sub">out of ${formatScore(caWeight)}</span></th>`,
    `<th rowspan="2">Absent</th>`,
    `<th rowspan="2">Eligible</th>`,
  ].join("");

  const componentHeaders = orderedComponents
    .map(comp => {
      const group = groupOf(comp);
      const max = componentMaxScore(comp);
      return (
        `<th class="comp ${group === "A" ? "a" : "b"}">` +
        `${esc(comp.name?.trim() || caTypeLabel(comp.type))}` +
        `<span class="sub">${group === "A" ? "Overall mark" : "Component total"} · ${Number(comp.weightage) || 0}% · max ${formatScore(max)}</span></th>`
      );
    })
    .join("");

  const body = eligibleRows
    .map((row, rowIndex) => {
      const componentCells = orderedComponents
        .map(comp => {
          const absent = row.isAbsentCa?.[comp.id] === true;
          const marks = row.caQuestionsMarks?.[comp.id] ?? {};
          if (absent) return `<td class="score absent">AB</td>`;

          const hasMark = enteredMarks(marks).length > 0;
          if (!hasMark) return `<td class="score blank">—</td>`;

          const total = computeRowTotal(marks, componentRequiredAnswers(comp), comp.scoreMode);
          return `<td class="score">${formatScore(total)}<span class="out-of"> / ${formatScore(componentMaxScore(comp))}</span></td>`;
        })
        .join("");

      const weighted = computeWeightedScores(row, orderedComponents, null);
      const absent = rowAbsentLabel(row, orderedComponents);
      return (
        `<tr>` +
        `<td class="left idx">${rowIndex + 1}. <strong>${esc(row.studentIndex)}</strong></td>` +
        componentCells +
        `<td class="grand">${formatScore(weighted.ca)}</td>` +
        `<td class="${absent === "AB" ? "absent" : absent !== "—" ? "partial-absent" : "muted"}">${esc(absent)}</td>` +
        `<td class="eligible">&#10003;</td>` +
        `</tr>`
      );
    })
    .join("");

  const columnCount = orderedComponents.length + 4;
  const emptyRow = eligibleRows.length === 0
    ? `<tr><td colspan="${columnCount}" class="empty">No eligible students on this marksheet.</td></tr>`
    : "";
  const generatedAt = new Date().toLocaleString();

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(moduleCode)} — CA Evaluation Register</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #171717; margin: 24px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .meta { font-size: 10px; color: #666; margin-bottom: 14px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: center; }
  th { background: #f4f4f4; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
  th.left, td.left { text-align: left; }
  th.student, td.idx { min-width: 120px; white-space: nowrap; }
  th.grp.a { background: #f3eefe; color: #5b21b6; }
  th.grp.b { background: #fff2e5; color: #c2410c; }
  th.comp.a { background: #faf7ff; color: #6d28d9; }
  th.comp.b { background: #fffaf5; color: #c2410c; }
  th .sub { display: block; margin-top: 3px; font-weight: 400; text-transform: none; letter-spacing: 0; color: #777; }
  th.grand-head { background: #eef2ff; color: #4338ca; min-width: 90px; }
  td.grand { font-weight: 800; background: #eef2ff; }
  td.score { font-weight: 700; white-space: nowrap; }
  td.score .out-of { color: #888; font-size: 9px; font-weight: 400; }
  td.blank, td.muted { color: #999; }
  td.absent { color: #b91c1c; font-weight: 800; background: #fff1f2; }
  td.partial-absent { color: #c2410c; font-weight: 700; }
  td.eligible { color: #047857; font-weight: 800; }
  td.empty { padding: 18px; color: #888; font-style: italic; }
  .note { margin-top: 10px; font-size: 9px; color: #777; }
  @page { size: landscape; margin: 12mm; }
</style>
</head>
<body>
  <h1>${esc(moduleCode)} — ${esc(moduleName)}</h1>
  <div class="meta">
    CA Evaluation Register · CA weightage ${caWeight}% · ${eligibleRows.length} eligible student(s)${
      excluded > 0 ? ` · ${excluded} ineligible row(s) excluded` : ""
    }<br />
    Printed ${esc(generatedAt)}${printedBy ? ` by ${esc(printedBy)}` : ""}
  </div>
  <table>
    <thead>
      <tr>${headGroups}</tr>
      <tr>${componentHeaders}</tr>
    </thead>
    <tbody>${body}${emptyRow}</tbody>
  </table>
  <p class="note">
    Group A columns show one overall mark; Group B columns show the component total. Values are shown against each component&apos;s maximum.
    Total Marks is the weighted CA contribution. AB marks a student absent across all selected CA components; a fraction marks component-level absence.
  </p>
</body>
</html>`;
}

/** Opens the print dialog for the CA register. Returns false if the popup was blocked. */
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
