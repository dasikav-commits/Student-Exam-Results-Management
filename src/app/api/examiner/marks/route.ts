import { hasExaminerHandover, seedSecondExamMarks } from "@/lib/second-examiner";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  asModuleStats,
  buildFinalExamTemplate,
  exceedsVarianceThreshold,
  finalPaperVariance,
  finalSectionAnsweredCount,
  finalSectionRequiredCount,
  getFinalPaperSections,
  getFinalSectionMarks,
  isRowEligible,
  normaliseFinalAbsence,
  normaliseFinalBlueprint,
  normaliseFinalMarkRow,
  normaliseFinalMarks,
  toErrorMessage,
  VARIANCE_THRESHOLD,
  type MarkRowLike,
} from "@/lib/lecturer-marks";

export const dynamic = "force-dynamic";

/**
 * GET /api/examiner/marks
 * Without ?moduleCode returns assigned modules and their sectioned template.
 * With ?moduleCode returns normalised lecturer and examiner marks for each row.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const moduleCode = searchParams.get("moduleCode");
  const emailParam = searchParams.get("email");

  try {
    if (!moduleCode) {
      const modules = await prisma.module.findMany({
        where: emailParam ? { examLecturer: { email: emailParam } } : {},
        include: {
          activeLecturer: { select: { id: true, fullName: true } },
          examLecturer: { select: { id: true, fullName: true } },
        },
        orderBy: { code: "asc" },
      });

      return NextResponse.json(modules.map(mod => {
        const stats = asModuleStats(mod.stats);
        const finalBlueprint = normaliseFinalBlueprint(stats.finalBlueprint, stats.examTemplate);
        return {
          id: mod.id,
          code: mod.code,
          name: mod.name,
          credits: mod.credits,
          isFrozen: mod.isFrozen,
          stats: { ...stats, finalBlueprint, examTemplate: buildFinalExamTemplate(finalBlueprint) },
          assignedActiveLec: mod.activeLecturer
            ? { id: mod.activeLecturer.id, fullName: mod.activeLecturer.fullName ?? "" }
            : null,
        };
      }));
    }

    const moduleRecord = await prisma.module.findUnique({
      where: { code: moduleCode },
      select: { stats: true },
    });
    if (!moduleRecord) return NextResponse.json({ error: `Module '${moduleCode}' not found` }, { status: 404 });

    const stats = asModuleStats(moduleRecord.stats);
    const finalBlueprint = normaliseFinalBlueprint(stats.finalBlueprint, stats.examTemplate);
    const marks = await prisma.studentMark.findMany({
      where: { moduleCode },
      select: {
        id: true, moduleCode: true, studentIndex: true,
        finalExamQuestionsMarks: true, secondExamMarks: true,
        isAbsentTheory: true, isAbsentPractical: true, isAbsentFinal: true, isEligible: true,
      },
      orderBy: { studentIndex: "asc" },
    });

    return NextResponse.json(marks.map(row => {
      const normalized = normaliseFinalMarkRow(row as unknown as MarkRowLike, finalBlueprint);
      return {
        ...row, ...normalized,
        secondExamMarks: seedSecondExamMarks(normalized.finalExamQuestionsMarks, normalized.secondExamMarks),
      };
    }));
  } catch (error) {
    console.error("Examiner GET error:", toErrorMessage(error));
    return NextResponse.json({ error: "Failed to load examiner data" }, { status: 500 });
  }
}

/**
 * PATCH /api/examiner/marks
 * Stores the Examiner's question-by-question marks in `secondExamMarks`; the
 * active lecturer's section marks are never overwritten.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null) as {
      moduleCode?: unknown;
      students?: unknown;
      finalize?: unknown;
    } | null;

    const moduleCode = typeof body?.moduleCode === "string" ? body.moduleCode.trim() : "";
    const students = Array.isArray(body?.students) ? body.students : [];
    if (!moduleCode) {
      return NextResponse.json({ error: "moduleCode is required" }, { status: 400 });
    }
    if (students.length === 0) {
      return NextResponse.json({ error: "students array is required" }, { status: 400 });
    }

    const moduleRecord = await prisma.module.findUnique({ where: { code: moduleCode } });
    if (!moduleRecord) return NextResponse.json({ error: `Module '${moduleCode}' not found` }, { status: 404 });

    const currentStats = asModuleStats(moduleRecord.stats);
    if (!hasExaminerHandover(currentStats.marksheetStatus)) {
      return NextResponse.json({ error: "The First Examiner must hand over the marksheet before second marking can begin." }, { status: 409 });
    }
    if (moduleRecord.isFrozen || currentStats.marksheetStatus !== "SECOND_CHECKING") {
      return NextResponse.json({ error: "Second marking is locked while frozen, finalised, or awaiting reconciliation." }, { status: 409 });
    }
    const finalBlueprint = normaliseFinalBlueprint(currentStats.finalBlueprint, currentStats.examTemplate);

    // A batch transaction ensures section marks and both parent-absence flags
    // move together. Absence never clears marks already recorded for a student.
    const updateOps = students
      .filter((student): student is Record<string, unknown> => !!student && typeof student === "object")
      .filter(student => typeof student.studentIndex === "string" && String(student.studentIndex).trim())
      .map(student => {
        const studentIndex = String(student.studentIndex).trim().toUpperCase();
        const marks = normaliseFinalMarks(student.secondExamMarks, finalBlueprint);
        const absence = normaliseFinalAbsence(student as {
          isAbsentTheory?: boolean;
          isAbsentPractical?: boolean;
          isAbsentFinal?: boolean;
        });
        return prisma.studentMark.updateMany({
          where: { moduleCode, studentIndex },
          data: {
            // Prisma JSON columns need the generated client's Json-compatible value.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            secondExamMarks: marks as any,
            isAbsentTheory: absence.isAbsentTheory,
            isAbsentPractical: absence.isAbsentPractical,
            isAbsentFinal: absence.isAbsentTheory && absence.isAbsentPractical,
          },
        });
      });

    if (updateOps.length > 0) await prisma.$transaction(updateOps);

    if (body?.finalize === true) {
      const allStudentMarks = await prisma.studentMark.findMany({
        where: { moduleCode },
        select: {
          studentIndex: true,
          finalExamQuestionsMarks: true,
          secondExamMarks: true,
          isAbsentTheory: true,
          isAbsentPractical: true,
          isAbsentFinal: true,
          isEligible: true,
        },
      });

      if (!finalBlueprint.enabled) {
        return NextResponse.json({ error: "There is no enabled Final Paper to finalise." }, { status: 400 });
      }

      const finalSections = getFinalPaperSections(finalBlueprint);
      if (finalSections.every(section => section.blueprint.questions.length === 0)) {
        return NextResponse.json({ error: "The Final Paper has no configured questions." }, { status: 400 });
      }

      const incompleteMarks: string[] = [];
      for (const rawRow of allStudentMarks) {
        if (!isRowEligible(rawRow as Pick<MarkRowLike, "isEligible">)) continue;
        const row = rawRow as unknown as MarkRowLike;
        const normalized = normaliseFinalMarkRow(row, finalBlueprint);
        for (const section of finalSections) {
          const isAbsent = section.parent === "theory"
            ? normalized.isAbsentTheory
            : normalized.isAbsentPractical;
          if (isAbsent) continue;
          // Any N configured answers complete a section — the Second Examiner
          // need not have marked Q1…QN, and extra answers never block. Only the
          // highest N marks earned count toward the total. Zero is an entered
          // answer; unknown question IDs are ignored by the normaliser.
          const requiredCount = finalSectionRequiredCount(section.blueprint);
          const sectionMarks = getFinalSectionMarks(normalized.secondExamMarks, section.key);
          const answered = finalSectionAnsweredCount(sectionMarks, section.blueprint);
          if (answered < requiredCount) {
            incompleteMarks.push(`${row.studentIndex} · ${section.label}: ${answered} of ${requiredCount} required answers recorded`);
          }
        }
      }

      if (incompleteMarks.length > 0) {
        return NextResponse.json({
          error: `Second marking is incomplete — ${incompleteMarks.slice(0, 4).join("; ")}${incompleteMarks.length > 4 ? ` (+${incompleteMarks.length - 4} more)` : ""}`,
          issues: incompleteMarks,
        }, { status: 400 });
      }

      // Ineligible, wholly absent and unmarked students are not compared; the
      // console uses the very same helper for its variance flags.
      const hasVariance = allStudentMarks.some(rawRow =>
        exceedsVarianceThreshold(finalPaperVariance(rawRow as unknown as MarkRowLike, finalBlueprint))
      );

      const now = new Date().toISOString();
      const newStatus = hasVariance ? "RECONCILIATION_NEEDED" : "FINALIZED";
      await prisma.module.update({
        where: { code: moduleCode },
        data: {
          stats: {
            ...currentStats,
            marksheetStatus: newStatus,
            varianceThreshold: VARIANCE_THRESHOLD,
            ...(hasVariance ? { reconciliationRequestedAt: now, lecturerApproved: false } : {}),
          },
        },
      });

      return NextResponse.json({ success: true, requiresReconciliation: hasVariance, newStatus });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = toErrorMessage(error);
    console.error("[examiner/marks PATCH] Error:", message);
    return NextResponse.json(
      { error: `Failed to save examiner marks: ${message}` },
      { status: 500 }
    );
  }
}
