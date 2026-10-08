import type {
  CaComponent,
  FinalBlueprint,
  FinalPaperMarks,
  FinalSectionKey,
  StudentMarkRecord,
} from "@/types/hod";
import {
  caTypeLabel,
  componentQuestionKeys,
  componentQuestionMax,
  getFinalPaperSections,
  normaliseFinalBlueprint,
} from "@/lib/lecturer-marks";

export type MarksExcelKind = "CA" | "FINAL";

/** Sparse changes from one spreadsheet row. Missing keys are deliberately untouched. */
export interface MarksExcelPatch {
  caQuestionsMarks?: Record<string, Record<string, number>>;
  isAbsentCa?: Record<string, boolean>;
  finalExamQuestionsMarks?: {
    theory?: Partial<Record<"mcq" | "essay", Record<string, number>>>;
    practical?: Record<string, number>;
  };
  isAbsentTheory?: boolean;
  isAbsentPractical?: boolean;
}

export interface MarksExcelRowUpdate {
  studentIndex: string;
  kind: MarksExcelKind;
  patch: MarksExcelPatch;
}

export interface MarksExcelImportResult {
  updates: MarksExcelRowUpdate[];
  warnings: string[];
  filesRead: number;
  rowsRead: number;
  duplicateRowsMerged: number;
}

export interface MarksExcelTemplateOptions {
  kind: MarksExcelKind;
  moduleCode: string;
  caComponents: CaComponent[];
  finalBlueprint: FinalBlueprint;
  students: Pick<StudentMarkRecord, "studentIndex">[];
}

export interface MarksExcelFile {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}

interface TemplateColumn {
  key: string;
  label: string;
  maxMarks?: number;
  type: "index" | "ca-mark" | "ca-absence" | "final-mark" | "final-absence";
  kind: MarksExcelKind;
  componentId?: string;
  questionId?: string;
  section?: FinalSectionKey;
  parent?: "theory" | "practical";
}

const STUDENT_INDEX_PATTERN = /^[A-Z0-9/\-]{3,20}$/;
const ABSENT_TOKENS = new Set(["YES", "Y", "1", "TRUE", "AB"]);
const PRESENT_TOKENS = new Set(["NO", "N", "0", "FALSE"]);

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function decodePart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function caColumns(components: CaComponent[]): TemplateColumn[] {
  const columns: TemplateColumn[] = [];
  for (const component of components) {
    const label = component.name?.trim() || caTypeLabel(component.type);
    for (const questionId of componentQuestionKeys(component)) {
      const maxMarks = componentQuestionMax(component, questionId);
      columns.push({
        key: `ca:${encodePart(component.id)}:${encodePart(questionId)}`,
        label: `${label} · ${questionId} (max ${maxMarks})`,
        maxMarks,
        type: "ca-mark",
        kind: "CA",
        componentId: component.id,
        questionId,
      });
    }
    columns.push({
      key: `caAbsent:${encodePart(component.id)}`,
      label: `${label} absent (YES/NO)`,
      type: "ca-absence",
      kind: "CA",
      componentId: component.id,
    });
  }
  return columns;
}

function finalColumns(blueprintInput: FinalBlueprint): TemplateColumn[] {
  const blueprint = normaliseFinalBlueprint(blueprintInput);
  if (!blueprint.enabled) return [];

  const sections = getFinalPaperSections(blueprint).filter(section => section.blueprint.questions.length > 0);
  const columns: TemplateColumn[] = [];
  const hasTheory = sections.some(section => section.parent === "theory");
  const hasPractical = sections.some(section => section.parent === "practical");

  for (const section of sections) {
    for (const question of section.blueprint.questions) {
      columns.push({
        key: `final:${section.key}:${encodePart(question.id)}`,
        label: `${section.label} · ${question.id} (max ${question.maxMarks})`,
        maxMarks: question.maxMarks,
        type: "final-mark",
        kind: "FINAL",
        section: section.key,
        questionId: question.id,
        parent: section.parent,
      });
    }
  }
  if (hasTheory) {
    columns.push({
      key: "finalAbsent:theory",
      label: "Theory absent (YES/NO)",
      type: "final-absence",
      kind: "FINAL",
      parent: "theory",
    });
  }
  if (hasPractical) {
    columns.push({
      key: "finalAbsent:practical",
      label: "Practical absent (YES/NO)",
      type: "final-absence",
      kind: "FINAL",
      parent: "practical",
    });
  }
  return columns;
}

function columnsForKind(
  kind: MarksExcelKind,
  caComponents: CaComponent[],
  finalBlueprint: FinalBlueprint
): TemplateColumn[] {
  return [
    {
      key: "studentIndex",
      label: "Student Index",
      type: "index",
      kind,
    },
    ...(kind === "CA" ? caColumns(caComponents) : finalColumns(finalBlueprint)),
  ];
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Build a blank, roster-prefilled .xlsx template. xlsx is loaded only on demand. */
export async function createMarksTemplateBlob(options: MarksExcelTemplateOptions): Promise<Blob> {
  const XLSX = await import("xlsx");
  const columns = columnsForKind(options.kind, options.caComponents, options.finalBlueprint);
  const rows: unknown[][] = [
    columns.map(column => column.label),
    columns.map(column => column.key),
    ...options.students.map(student => [student.studentIndex, ...columns.slice(1).map(() => "")]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = columns.map((column, index) => ({
    wch: index === 0 ? 20 : Math.min(40, Math.max(18, column.label.length + 2)),
  }));
  worksheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: Math.max(1, rows.length - 1), c: Math.max(0, columns.length - 1) } }),
  };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, options.kind === "CA" ? "CA Marks" : "Final Marks");
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new Blob([output as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Create and download a blank CA or Final marks template. */
export async function downloadMarksTemplate(options: MarksExcelTemplateOptions): Promise<void> {
  const blob = await createMarksTemplateBlob(options);
  const kind = options.kind === "CA" ? "CA" : "Final";
  triggerDownload(blob, `${options.moduleCode}_${kind}_marks_template.xlsx`);
}

function asCellString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normaliseHeader(value: unknown): string {
  return asCellString(value).replace(/\s+/g, "").toLowerCase();
}

function detectKind(keys: string[], sheetName: string): MarksExcelKind | null {
  const hasCA = keys.some(key => key.startsWith("ca:") || key.startsWith("caAbsent:"));
  const hasFinal = keys.some(key => key.startsWith("final:") || key.startsWith("finalAbsent:"));
  if (hasCA && !hasFinal) return "CA";
  if (hasFinal && !hasCA) return "FINAL";
  if (/(?:^|[^a-z])ca(?:[^a-z]|$)/i.test(sheetName)) return "CA";
  if (/final/i.test(sheetName)) return "FINAL";
  if (hasCA) return "CA";
  if (hasFinal) return "FINAL";
  return null;
}

function parseAbsence(value: unknown): boolean | null {
  const token = asCellString(value).toUpperCase();
  if (!token) return null;
  if (ABSENT_TOKENS.has(token)) return true;
  if (PRESENT_TOKENS.has(token)) return false;
  return null;
}

function knownColumns(
  kind: MarksExcelKind,
  caComponents: CaComponent[],
  finalBlueprint: FinalBlueprint
): Map<string, TemplateColumn> {
  return new Map(columnsForKind(kind, caComponents, finalBlueprint).map(column => [column.key, column]));
}

function parseMachineColumn(key: string, kind: MarksExcelKind): TemplateColumn | null {
  const parts = key.split(":");
  if (kind === "CA") {
    if (parts[0] === "ca" && parts.length === 3) {
      const componentId = decodePart(parts[1]);
      const questionId = decodePart(parts[2]);
      if (componentId && questionId) {
        return { key, label: key, type: "ca-mark", kind, componentId, questionId };
      }
    }
    if (parts[0] === "caAbsent" && parts.length === 2) {
      const componentId = decodePart(parts[1]);
      if (componentId) return { key, label: key, type: "ca-absence", kind, componentId };
    }
  }
  if (kind === "FINAL") {
    if (parts[0] === "final" && parts.length === 3) {
      const section = parts[1] as FinalSectionKey;
      const questionId = decodePart(parts[2]);
      if (["mcq", "essay", "practical"].includes(section) && questionId) {
        return { key, label: key, type: "final-mark", kind, section, questionId };
      }
    }
    if (parts[0] === "finalAbsent" && parts.length === 2 && ["theory", "practical"].includes(parts[1])) {
      return { key, label: key, type: "final-absence", kind, parent: parts[1] as "theory" | "practical" };
    }
  }
  return null;
}

function emptyPatch(): MarksExcelPatch {
  return {};
}

function mergeSparsePatches(current: MarksExcelPatch, next: MarksExcelPatch): MarksExcelPatch {
  const finalCurrent = current.finalExamQuestionsMarks;
  const finalNext = next.finalExamQuestionsMarks;
  const componentIds = new Set([
    ...Object.keys(current.caQuestionsMarks ?? {}),
    ...Object.keys(next.caQuestionsMarks ?? {}),
  ]);
  const caQuestionsMarks = componentIds.size > 0
    ? Object.fromEntries(Array.from(componentIds, componentId => [
        componentId,
        {
          ...(current.caQuestionsMarks?.[componentId] ?? {}),
          ...(next.caQuestionsMarks?.[componentId] ?? {}),
        },
      ]))
    : undefined;

  return {
    ...(caQuestionsMarks ? { caQuestionsMarks } : {}),
    ...(current.isAbsentCa || next.isAbsentCa
      ? { isAbsentCa: { ...current.isAbsentCa, ...next.isAbsentCa } }
      : {}),
    ...(finalCurrent || finalNext
      ? {
          finalExamQuestionsMarks: {
            ...(finalCurrent?.theory || finalNext?.theory
              ? {
                  theory: {
                    mcq: { ...finalCurrent?.theory?.mcq, ...finalNext?.theory?.mcq },
                    essay: { ...finalCurrent?.theory?.essay, ...finalNext?.theory?.essay },
                  },
                }
              : {}),
            ...(finalCurrent?.practical || finalNext?.practical
              ? { practical: { ...finalCurrent?.practical, ...finalNext?.practical } }
              : {}),
          },
        }
      : {}),
    ...(next.isAbsentTheory !== undefined || current.isAbsentTheory !== undefined
      ? { isAbsentTheory: next.isAbsentTheory ?? current.isAbsentTheory }
      : {}),
    ...(next.isAbsentPractical !== undefined || current.isAbsentPractical !== undefined
      ? { isAbsentPractical: next.isAbsentPractical ?? current.isAbsentPractical }
      : {}),
  };
}

function putCaMark(patch: MarksExcelPatch, componentId: string, questionId: string, mark: number): void {
  patch.caQuestionsMarks ??= {};
  patch.caQuestionsMarks[componentId] ??= {};
  patch.caQuestionsMarks[componentId][questionId] = mark;
}

function putFinalMark(patch: MarksExcelPatch, section: FinalSectionKey, questionId: string, mark: number): void {
  patch.finalExamQuestionsMarks ??= {};
  if (section === "practical") {
    patch.finalExamQuestionsMarks.practical ??= {};
    patch.finalExamQuestionsMarks.practical[questionId] = mark;
  } else {
    patch.finalExamQuestionsMarks.theory ??= {};
    patch.finalExamQuestionsMarks.theory[section] ??= {};
    patch.finalExamQuestionsMarks.theory[section]![questionId] = mark;
  }
}

function setAbsent(patch: MarksExcelPatch, column: TemplateColumn, absent: boolean): void {
  if (column.type === "ca-mark" || column.type === "ca-absence") {
    if (!column.componentId) return;
    patch.isAbsentCa ??= {};
    patch.isAbsentCa[column.componentId] = absent;
    return;
  }
  if (column.type === "final-mark" || column.type === "final-absence") {
    if (column.parent === "theory" || column.parent === "practical") {
      if (column.parent === "theory") patch.isAbsentTheory = absent;
      else patch.isAbsentPractical = absent;
      return;
    }
    if (column.section === "practical") patch.isAbsentPractical = absent;
    else patch.isAbsentTheory = absent;
  }
}

function mergeWarnings(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}

function hasPatchChanges(patch: MarksExcelPatch): boolean {
  const hasCaMarks = Object.values(patch.caQuestionsMarks ?? {}).some(marks => Object.keys(marks).length > 0);
  const hasFinalTheoryMarks = Object.values(patch.finalExamQuestionsMarks?.theory ?? {}).some(
    marks => Boolean(marks && Object.keys(marks).length > 0)
  );
  const hasFinalPracticalMarks = Object.keys(patch.finalExamQuestionsMarks?.practical ?? {}).length > 0;
  return hasCaMarks
    || Object.keys(patch.isAbsentCa ?? {}).length > 0
    || hasFinalTheoryMarks
    || hasFinalPracticalMarks
    || patch.isAbsentTheory !== undefined
    || patch.isAbsentPractical !== undefined;
}

/**
 * Parse .xlsx, .xls and .csv templates. The second row contains machine keys;
 * blank cells produce no patch, so importing never clears an existing mark.
 */
export async function parseMarksExcelFiles(
  files: readonly MarksExcelFile[],
  caComponents: CaComponent[],
  finalBlueprint: FinalBlueprint
): Promise<MarksExcelImportResult> {
  if (files.length === 0) throw new Error("Choose at least one Excel or CSV file to import.");
  const XLSX = await import("xlsx");
  const updates: MarksExcelRowUpdate[] = [];
  const warnings: string[] = [];
  const updatePositions = new Map<string, number>();
  let duplicateRowsMerged = 0;
  let rowsRead = 0;
  let filesRead = 0;

  for (const file of files) {
    let workbook: ReturnType<typeof XLSX.read>;
    const lowerName = file.name.toLowerCase();
    const extension = lowerName.slice(lowerName.lastIndexOf("."));
    if (![".xlsx", ".xls", ".csv"].includes(extension)) {
      throw new Error(`Unsupported file type for '${file.name}'. Choose an .xlsx, .xls, or .csv file.`);
    }

    try {
      if (extension === ".csv") {
        const text = file.text
          ? await file.text()
          : new TextDecoder().decode(await file.arrayBuffer());
        workbook = XLSX.read(text, { type: "string", raw: true });
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const isZip = bytes.length >= 4
          && bytes[0] === 0x50
          && bytes[1] === 0x4b
          && ((bytes[2] === 0x03 && bytes[3] === 0x04)
            || (bytes[2] === 0x05 && bytes[3] === 0x06)
            || (bytes[2] === 0x07 && bytes[3] === 0x08));
        const isOleCompound = bytes.length >= 8
          && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => bytes[index] === byte);
        const isBiffStream = bytes.length >= 4
          && bytes[0] === 0x09
          && [0x00, 0x02, 0x04, 0x08].includes(bytes[1]);
        if ((extension === ".xlsx" && !isZip) || (extension === ".xls" && !isOleCompound && !isBiffStream)) {
          throw new Error(`invalid ${extension.slice(1).toUpperCase()} file signature`);
        }
        workbook = XLSX.read(bytes, { type: "array", raw: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unsupported or damaged file";
      throw new Error(`Could not read '${file.name}': ${message}`);
    }
    filesRead++;

    let fileHadTemplate = false;
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
      if (matrix.length < 2) continue;

      let headerRowIndex = -1;
      for (let index = 0; index < Math.min(matrix.length, 6); index++) {
        const values = matrix[index].map(asCellString);
        const hasMachineIndex = values.some(value => value === "studentIndex");
        const hasMachineField = values.some(value => /^(?:ca:|caAbsent:|final:|finalAbsent:)/.test(value));
        const hasIndexLabel = values.some(value => normaliseHeader(value) === "studentindex");
        if (hasMachineIndex || (hasIndexLabel && hasMachineField)) {
          headerRowIndex = index;
          break;
        }
      }
      if (headerRowIndex < 0) continue;

      const headerKeys = matrix[headerRowIndex].map(asCellString);
      const studentColumnIndex = headerKeys.findIndex(key => normaliseHeader(key) === "studentindex");
      if (studentColumnIndex < 0) continue;
      const kind = detectKind(headerKeys, `${sheetName} ${file.name}`);
      if (!kind) {
        mergeWarnings(warnings, `${file.name} · ${sheetName}: could not detect a CA or Final template; sheet ignored.`);
        continue;
      }
      fileHadTemplate = true;
      const currentColumns = knownColumns(kind, caComponents, finalBlueprint);
      const resolvedColumns = new Map<number, TemplateColumn>();
      const warnedColumns = new Set<string>();

      headerKeys.forEach((key, columnIndex) => {
        if (!key || columnIndex === studentColumnIndex) return;
        const parsed = parseMachineColumn(key, kind);
        const known = currentColumns.get(key);
        if (known && parsed) {
          resolvedColumns.set(columnIndex, { ...known, label: asCellString(matrix[Math.max(0, headerRowIndex - 1)]?.[columnIndex]) || known.label });
          return;
        }
        const warningKey = `${file.name} · ${sheetName}: unknown column '${asCellString(matrix[Math.max(0, headerRowIndex - 1)]?.[columnIndex]) || key}' was ignored (the blueprint may have changed).`;
        warnedColumns.add(warningKey);
      });
      for (const warning of warnedColumns) mergeWarnings(warnings, warning);

      for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex++) {
        const cells = matrix[rowIndex];
        const studentIndex = asCellString(cells[studentColumnIndex]).toUpperCase();
        if (!studentIndex) continue;
        rowsRead++;
        if (!STUDENT_INDEX_PATTERN.test(studentIndex)) {
          mergeWarnings(warnings, `${file.name} · ${sheetName} row ${rowIndex + 1}: invalid student index '${studentIndex}' was skipped.`);
          continue;
        }

        const patch = emptyPatch();
        const explicitAbsence: Array<{ column: TemplateColumn; absent: boolean }> = [];

        for (const [columnIndex, column] of resolvedColumns) {
          const value = cells[columnIndex];
          if (asCellString(value) === "") continue;

          if (column.type === "ca-absence" || column.type === "final-absence") {
            const absent = parseAbsence(value);
            if (absent === null) {
              mergeWarnings(warnings, `${file.name} · ${sheetName} row ${rowIndex + 1}: '${asCellString(value)}' is not a valid absence value for ${column.label}.`);
            } else {
              explicitAbsence.push({ column, absent });
            }
            continue;
          }

          if (asCellString(value).toUpperCase() === "AB") {
            setAbsent(patch, column, true);
            continue;
          }

          const numeric = typeof value === "number"
            ? value
            : typeof value === "string" && value.trim() !== ""
              ? Number(value.trim())
              : Number.NaN;
          if (!Number.isFinite(numeric)) {
            mergeWarnings(warnings, `${file.name} · ${sheetName} row ${rowIndex + 1}: '${asCellString(value)}' is not a mark or AB for ${column.label}; cell ignored.`);
            continue;
          }
          const maximum = Number.isFinite(column.maxMarks) ? Math.max(0, Number(column.maxMarks)) : Number.MAX_SAFE_INTEGER;
          const mark = Math.min(maximum, Math.max(0, numeric));
          if (column.type === "ca-mark" && column.componentId && column.questionId) {
            putCaMark(patch, column.componentId, column.questionId, mark);
          } else if (column.type === "final-mark" && column.section && column.questionId) {
            putFinalMark(patch, column.section, column.questionId, mark);
          }
        }

        // An explicit value in the dedicated absence column wins over an AB
        // entered in a mark cell, allowing the lecturer to restore attendance.
        for (const absence of explicitAbsence) setAbsent(patch, absence.column, absence.absent);

        // A roster-only row is not a change: keep blank template cells
        // untouched and do not restore pending-removal students by accident.
        if (!hasPatchChanges(patch)) continue;

        const duplicateKey = `${kind}:${studentIndex}`;
        const existingUpdatePosition = updatePositions.get(duplicateKey);
        if (existingUpdatePosition !== undefined) {
          duplicateRowsMerged++;
          const existingUpdate = updates[existingUpdatePosition];
          updates[existingUpdatePosition] = {
            ...existingUpdate,
            patch: mergeSparsePatches(existingUpdate.patch, patch),
          };
        } else {
          updatePositions.set(duplicateKey, updates.length);
          updates.push({ studentIndex, kind, patch });
        }
      }
    }

    if (!fileHadTemplate) {
      mergeWarnings(warnings, `${file.name}: no template header row was found; file ignored.`);
    }
  }

  return { updates, warnings, filesRead, rowsRead, duplicateRowsMerged };
}

/** Explicit conversion helper for tests and UI merge code. */
export function emptyMarksExcelRow(moduleCode: string, studentIndex: string): StudentMarkRecord {
  const emptyFinal: FinalPaperMarks = { theory: { mcq: {}, essay: {} }, practical: {} };
  return {
    id: 0,
    moduleCode,
    studentIndex,
    caQuestionsMarks: {},
    finalExamQuestionsMarks: emptyFinal,
    secondExamMarks: emptyFinal,
    isAbsentCa: {},
    isAbsentTheory: false,
    isAbsentPractical: false,
    isAbsentFinal: false,
    isEligible: true,
  };
}
