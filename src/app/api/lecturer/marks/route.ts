import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  asModuleStats,
  hasAnyMark,
  isLecturerLocked,
  normaliseCaComponents,
  sanitiseMarkRow,
  toErrorMessage,
  type SanitisedRow,
} from "@/lib/lecturer-marks";
import type { FinalBlueprint } from "@/types/hod";

export const dynamic = "force-dynamic";

/**
 * GET /api/lecturer/marks?moduleCode=...
 * Returns all StudentMark rows for the given module, including secondExamMarks
 * so the active lecturer can see the second examiner's marks for comparison
 * (only revealed to the UI once the marksheet has left SECOND_CHECKING).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const moduleCode = searchParams.get("moduleCode");

  if (!moduleCode) {
    return NextResponse.json({ error: "moduleCode is required" }, { status: 400 });
  }

  try {
    const marks = await prisma.studentMark.findMany({
      where: { moduleCode },
      orderBy: { studentIndex: "asc" },
    });

    return NextResponse.json(marks);
  } catch (error) {
    console.error("[marks/GET] Error:", toErrorMessage(error));
    return NextResponse.json({ error: "Failed to load marks" }, { status: 500 });
  }
}

/**
 * POST /api/lecturer/marks
 * Body: {
 *   moduleCode: string,
 *   students: StudentMarkRecord[],
 *   deletedIndexes?: string[]      // roster rows the lecturer removed client-side
 * }
 *
 * Saves the Active Lecturer's own ledger (CA + final exam marks). Never touches
 * `secondExamMarks` — that column belongs to the Second Examiner.
 *
 * Guarantees:
 *  • Frozen (HOD lock) and post-finalisation marksheets are rejected.
 *  • Every value is clamped to its blueprint maximum and unknown question keys /
 *    removed CA components are dropped before they reach the database.
 *  • Removals are persisted, but a row the Examiner has already marked is never
 *    deleted — those indexes come back in `skippedDeletions`.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { moduleCode?: unknown; students?: unknown; deletedIndexes?: unknown }
      | null;

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const moduleCode = typeof body.moduleCode === "string" ? body.moduleCode.trim() : "";
    if (!moduleCode) {
      return NextResponse.json({ error: "moduleCode is required" }, { status: 400 });
    }

    const studentsInput = Array.isArray(body.students) ? body.students : [];
    const deletedIndexes = Array.isArray(body.deletedIndexes)
      ? body.deletedIndexes
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map(value => value.trim().toUpperCase())
      : [];

    if (studentsInput.length === 0 && deletedIndexes.length === 0) {
      return NextResponse.json(
        { error: "students array is required and must not be empty" },
        { status: 400 }
      );
    }

    // ── Module + state guards ────────────────────────────────────────────────
    const mod = await prisma.module.findUnique({ where: { code: moduleCode } });
    if (!mod) {
      return NextResponse.json({ error: `Module '${moduleCode}' not found` }, { status: 404 });
    }
    if (mod.isFrozen) {
      return NextResponse.json(
        { error: "Module is frozen by the HOD. Marks cannot be modified." },
        { status: 403 }
      );
    }

    const currentStats = asModuleStats(mod.stats);
    if (isLecturerLocked(currentStats.marksheetStatus)) {
      return NextResponse.json(
        {
          error: `This marksheet is closed (${currentStats.marksheetStatus}). Marks can no longer be edited.`,
          marksheetStatus: currentStats.marksheetStatus,
        },
        { status: 409 }
      );
    }

    // Normalised so per-question maxima are known for both component groups.
    const caComponents = normaliseCaComponents(currentStats.caComponents);
    const finalBlueprint = (currentStats.finalBlueprint ?? null) as FinalBlueprint | null;

    // ── Sanitise the payload against the current blueprint ───────────────────
    // Last write wins if the client somehow sends the same index twice.
    const sanitised = new Map<string, SanitisedRow>();
    let rejectedRows = 0;
    for (const raw of studentsInput) {
      if (!raw || typeof raw !== "object") {
        rejectedRows++;
        continue;
      }
      const row = sanitiseMarkRow(raw as Record<string, unknown>, caComponents, finalBlueprint);
      if (!row) {
        rejectedRows++;
        continue;
      }
      sanitised.set(row.studentIndex, row);
    }

    const rows = Array.from(sanitised.values());

    // ── Plan the write: update existing rows, create new ones, delete removals ─
    const existing = await prisma.studentMark.findMany({
      where: { moduleCode },
      select: { studentIndex: true, secondExamMarks: true },
    });
    const existingIndexes = new Set(existing.map(row => row.studentIndex));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: any[] = [];
    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const payload = {
        caQuestionsMarks: row.caQuestionsMarks,
        finalExamQuestionsMarks: row.finalExamQuestionsMarks,
        isAbsentCa: row.isAbsentCa,
        isAbsentFinal: row.isAbsentFinal,
        isEligible: row.isEligible,
      };

      if (existingIndexes.has(row.studentIndex)) {
        updated++;
        ops.push(
          prisma.studentMark.updateMany({
            where: { moduleCode, studentIndex: row.studentIndex },
            data: payload,
          })
        );
      } else {
        created++;
        ops.push(
          prisma.studentMark.create({
            data: { moduleCode, studentIndex: row.studentIndex, ...payload },
          })
        );
      }
    }

    const skippedDeletions: string[] = [];
    let deleted = 0;

    for (const index of deletedIndexes) {
      const existingRow = existing.find(row => row.studentIndex === index);
      if (!existingRow) continue;

      // Safety net: never destroy marks the Second Examiner has recorded.
      if (hasAnyMark(existingRow.secondExamMarks as Record<string, unknown> | null)) {
        skippedDeletions.push(index);
        continue;
      }

      deleted++;
      ops.push(prisma.studentMark.deleteMany({ where: { moduleCode, studentIndex: index } }));
    }

    if (ops.length > 0) {
      await prisma.$transaction(ops);
    }

    // ── Auto-advance DRAFT → MARKING ─────────────────────────────────────────
    let newStats = currentStats;
    if (!currentStats.marksheetStatus || currentStats.marksheetStatus === "DRAFT") {
      newStats = {
        ...currentStats,
        marksheetStatus: "MARKING",
        marksheetStartedAt: currentStats.marksheetStartedAt ?? new Date().toISOString(),
      };
      await prisma.module.update({
        where: { code: moduleCode },
        data: { stats: newStats },
      });
    }

    return NextResponse.json({
      success: true,
      saved: rows.length,
      created,
      updated,
      deleted,
      skippedDeletions,
      rejectedRows,
      stats: newStats,
    });
  } catch (error) {
    const msg = toErrorMessage(error);
    console.error("[marks/POST] Prisma error:", msg);
    return NextResponse.json({ error: `Failed to save marks: ${msg}` }, { status: 500 });
  }
}
