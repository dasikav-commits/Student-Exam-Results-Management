import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/lecturer/marks?moduleCode=...
 * Returns all StudentMark rows for the given module, including secondExamMarks
 * so the active lecturer can see the second examiner's marks for comparison
 * (only revealed to UI after marksheetStatus === "FINALIZED").
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
  } catch (error: any) {
    console.error("[marks/GET] Error:", error?.message ?? error);
    return NextResponse.json({ error: "Failed to load marks" }, { status: 500 });
  }
}

/**
 * POST /api/lecturer/marks
 * Body: { moduleCode, students: StudentMarkRecord[] }
 *
 * Saves every student's CA and final exam marks (active lecturer only).
 * Does NOT touch secondExamMarks — that is owned by the examiner.
 * Uses findFirst + update/create to avoid compound-key upsert issues with the PG adapter.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { moduleCode, students } = body;

    // ── Payload validation ────────────────────────────────────────────────────
    if (!moduleCode || typeof moduleCode !== "string") {
      return NextResponse.json({ error: "moduleCode is required" }, { status: 400 });
    }
    if (!Array.isArray(students) || students.length === 0) {
      return NextResponse.json({ error: "students array is required and must not be empty" }, { status: 400 });
    }

    // ── Freeze-lock check ────────────────────────────────────────────────────
    const mod = await prisma.module.findUnique({ where: { code: moduleCode } });
    if (!mod) {
      return NextResponse.json({ error: `Module '${moduleCode}' not found` }, { status: 404 });
    }
    if (mod.isFrozen) {
      return NextResponse.json(
        { error: "Module is frozen by HOD. Marks cannot be modified." },
        { status: 403 }
      );
    }

    // ── Save each student row (findFirst → update or create) ─────────────────
    // Avoids compound-key upsert which can fail with Prisma 7 + PG adapter
    // when @map decorators are used on the unique index fields.
    // NOTE: secondExamMarks is intentionally excluded — that belongs to the examiner.
    await prisma.$transaction(async (tx) => {
      for (const s of students) {
        if (!s.studentIndex || typeof s.studentIndex !== "string") continue;

        const existing = await tx.studentMark.findFirst({
          where: { moduleCode, studentIndex: s.studentIndex },
          select: { id: true },
        });

        const payload = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          caQuestionsMarks:        (s.caQuestionsMarks        ?? {}) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          finalExamQuestionsMarks: (s.finalExamQuestionsMarks ?? {}) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isAbsentCa:              (s.isAbsentCa              ?? {}) as any,
          isAbsentFinal:            s.isAbsentFinal            ?? false,
          // secondExamMarks is deliberately NOT written here
        };

        if (existing) {
          await tx.studentMark.update({
            where: { id: existing.id },
            data: payload,
          });
        } else {
          await tx.studentMark.create({
            data: {
              moduleCode,
              studentIndex: s.studentIndex,
              ...payload,
            },
          });
        }
      }
    });

    // ── Auto-advance marksheetStatus: DRAFT → MARKING ────────────────────────
    const currentStats = (mod.stats as any) ?? {};
    if (!currentStats.marksheetStatus || currentStats.marksheetStatus === "DRAFT") {
      await prisma.module.update({
        where: { code: moduleCode },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { stats: { ...currentStats, marksheetStatus: "MARKING" } as any },
      });
    }

    return NextResponse.json({ success: true, saved: students.length });

  } catch (error: any) {
    const msg = error?.message ?? String(error);
    console.error("[marks/POST] Prisma error:", msg);
    return NextResponse.json(
      { error: `Failed to save marks: ${msg}` },
      { status: 500 }
    );
  }
}