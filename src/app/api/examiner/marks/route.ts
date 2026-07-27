import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/examiner/marks
 * Without ?moduleCode → returns modules where user is examLecturer
 * With    ?moduleCode → returns StudentMark rows for that module,
 *                       including both finalExamQuestionsMarks (active lec)
 *                       and secondExamMarks (examiner's own marks for guided entry)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const moduleCode = searchParams.get("moduleCode");
  const emailParam = searchParams.get("email");

  try {
    if (!moduleCode) {
      // Return modules assigned to this examiner
      const where = emailParam
        ? { examLecturer: { email: emailParam } }
        : {};

      const modules = await prisma.module.findMany({
        where,
        include: {
          activeLecturer: { select: { id: true, fullName: true } },
          examLecturer:   { select: { id: true, fullName: true } },
        },
        orderBy: { code: "asc" },
      });

      return NextResponse.json(
        modules.map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          credits: m.credits,
          isFrozen: m.isFrozen,
          stats: m.stats,
          assignedActiveLec: m.activeLecturer
            ? { id: m.activeLecturer.id, fullName: m.activeLecturer.fullName ?? "" }
            : null,
        }))
      );
    }

    // Return student marks for the module.
    // Both finalExamQuestionsMarks (active lec) and secondExamMarks are returned
    // so the examiner can see the active lec's marks as a guided reference.
    const marks = await prisma.studentMark.findMany({
      where: { moduleCode },
      orderBy: { studentIndex: "asc" },
    });

    return NextResponse.json(marks);
  } catch (error) {
    console.error("Examiner GET error:", error);
    return NextResponse.json({ error: "Failed to load examiner data" }, { status: 500 });
  }
}

/**
 * PATCH /api/examiner/marks
 * Saves the examiner's second marking into `secondExamMarks` (NOT finalExamQuestionsMarks).
 * The active lecturer's finalExamQuestionsMarks are preserved untouched.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { moduleCode, students, finalize } = body;

    if (!moduleCode || typeof moduleCode !== "string") {
      return NextResponse.json({ error: "moduleCode is required" }, { status: 400 });
    }
    if (!Array.isArray(students) || students.length === 0) {
      return NextResponse.json({ error: "students array is required" }, { status: 400 });
    }

    // ── Save each student's SECOND EXAM marks only ────────────────────────────
    // Active lec's finalExamQuestionsMarks are intentionally NOT touched here.
    await prisma.$transaction(async (tx) => {
      for (const s of students) {
        if (!s.studentIndex) continue;

        const existing = await tx.studentMark.findFirst({
          where: { moduleCode, studentIndex: s.studentIndex },
          select: { id: true },
        });

        if (existing) {
          await tx.studentMark.update({
            where: { id: existing.id },
            data: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              secondExamMarks: (s.secondExamMarks ?? {}) as any,
              // isAbsentFinal is shared — examiner can mark student absent too
              isAbsentFinal: s.isAbsentFinal ?? false,
            },
          });
        }
        // If no existing record, examiner cannot create one — active lec must save first
      }
    });

    // ── Advance marksheetStatus ───────────────────────────────────────────────
    const mod = await prisma.module.findUnique({ where: { code: moduleCode } });
    if (mod) {
      const currentStats = (mod.stats as any) ?? {};
      const newStatus = finalize ? "FINALIZED" : "SECOND_CHECKING";
      const order = ["DRAFT", "MARKING", "SECOND_CHECKING", "FINALIZED"];
      const currentIdx = order.indexOf(currentStats.marksheetStatus ?? "DRAFT");
      const newIdx = order.indexOf(newStatus);
      if (newIdx > currentIdx) {
        await prisma.module.update({
          where: { code: moduleCode },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { stats: { ...currentStats, marksheetStatus: newStatus } as any },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const msg = error?.message ?? String(error);
    console.error("[examiner/marks PATCH] Error:", msg);
    return NextResponse.json(
      { error: `Failed to save examiner marks: ${msg}` },
      { status: 500 }
    );
  }
}