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
    //
    // Use the batch array form of $transaction (NOT the interactive callback form).
    // The interactive form holds a single DB connection open across N sequential
    // awaits — which exhausts the pg pool under load ("Unable to start a transaction
    // in the given time"). The array form sends all statements at once, releasing
    // the connection immediately after the batch completes.
    //
    // updateMany with the compound unique filter (moduleCode + studentIndex)
    // naturally skips rows that don't yet exist, so no findFirst is needed.
    const updateOps = students
      .filter((s) => !!s.studentIndex)
      .map((s) =>
        prisma.studentMark.updateMany({
          where: { moduleCode, studentIndex: s.studentIndex },
          data: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            secondExamMarks: (s.secondExamMarks ?? {}) as any,
            // isAbsentFinal is shared — examiner can mark student absent too
            isAbsentFinal: s.isAbsentFinal ?? false,
          },
        })
      );

    if (updateOps.length > 0) {
      await Promise.all(updateOps);
    }

    // ── Advance marksheetStatus on finalize ──────────────────────────────────
    const mod = await prisma.module.findUnique({ where: { code: moduleCode } });
    if (mod) {
      const currentStats = (mod.stats as any) ?? {};

      if (finalize) {
        // ── Detect variance > 1 across all students ───────────────────────────
        // Load the final blueprint so we can compute per-student totals
        const finalBp = currentStats.finalBlueprint as
          | { questionsToAnswer: number; scoreMode: "SUM" | "AVG" }
          | undefined;
        const questionsToAnswer = finalBp?.questionsToAnswer ?? 0;
        const scoreMode: "SUM" | "AVG" = finalBp?.scoreMode ?? "SUM";

        // Fetch fresh DB marks for this module
        const allStudentMarks = await prisma.studentMark.findMany({
          where: { moduleCode },
          select: { studentIndex: true, finalExamQuestionsMarks: true, secondExamMarks: true, isAbsentFinal: true },
        });

        const calcTotal = (marks: Record<string, number>): number => {
          const vals = Object.values(marks)
            .slice(0, questionsToAnswer)
            .map((v) => Number(v) || 0);
          const sum = vals.reduce((a, b) => a + b, 0);
          return scoreMode === "AVG" && questionsToAnswer > 0
            ? sum / questionsToAnswer
            : sum;
        };

        // Variance threshold is fixed at 1 (no slider)
        const VARIANCE_THRESHOLD = 1;

        const hasVariance = allStudentMarks.some((s) => {
          if (s.isAbsentFinal) return false;
          const examMarks = s.secondExamMarks as Record<string, number>;
          if (Object.keys(examMarks).length === 0) return false; // examiner hasn't marked yet
          const lecTotal = calcTotal(s.finalExamQuestionsMarks as Record<string, number>);
          const examTotal = calcTotal(examMarks);
          return Math.abs(lecTotal - examTotal) > VARIANCE_THRESHOLD;
        });

        const now = new Date().toISOString();
        const newStatus = hasVariance ? "RECONCILIATION_NEEDED" : "FINALIZED";

        await prisma.module.update({
          where: { code: moduleCode },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: {
            stats: {
              ...currentStats,
              marksheetStatus: newStatus,
              varianceThreshold: VARIANCE_THRESHOLD,
              ...(hasVariance ? { reconciliationRequestedAt: now, lecturerApproved: false } : {}),
            } as any,
          },
        });

        return NextResponse.json({ success: true, requiresReconciliation: hasVariance, newStatus });
      } else {
        // Progress save (not finalize) — advance DRAFT/SECOND_CHECKING → same or higher
        const order = ["DRAFT", "MARKING", "SECOND_CHECKING", "FINALIZED", "RECONCILIATION_NEEDED", "RECONCILED"];
        const currentIdx = order.indexOf(currentStats.marksheetStatus ?? "DRAFT");
        const targetStatus = "SECOND_CHECKING";
        const targetIdx = order.indexOf(targetStatus);
        if (targetIdx > currentIdx) {
          await prisma.module.update({
            where: { code: moduleCode },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { stats: { ...currentStats, marksheetStatus: targetStatus } as any },
          });
        }
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