import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  asModuleStats,
  blockingIssues,
  isLecturerLocked,
  isMarksheetStatus,
  normaliseCaComponents,
  summariseIssues,
  toErrorMessage,
  validateBlueprintInput,
  validateMarksheet,
  type MarkRowLike,
  type MarksheetStatusValue,
} from "@/lib/lecturer-marks";
import type { CaComponent, FinalBlueprint } from "@/types/hod";

export const dynamic = "force-dynamic";

/**
 * Status transitions the Lecturer Desk is allowed to perform.
 * DRAFT → MARKING happens implicitly when marks are saved, so anything else
 * (for example forcing FINALIZED from the client) is refused.
 */
const ALLOWED_TRANSITIONS: Partial<Record<MarksheetStatusValue, MarksheetStatusValue[]>> = {
  SECOND_CHECKING: ["DRAFT", "MARKING"],
  MARKING: ["DRAFT", "SECOND_CHECKING"], // SECOND_CHECKING → MARKING is "recall submission"
};

/**
 * GET /api/lecturer/modules?email=...  or  ?lecturerId=...
 *
 * Returns modules where the user is either activeLecturer or examLecturer.
 * Injects roleInModule and isExaminerViewOnly per the spec.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const emailParam = searchParams.get("email");
  const lecturerIdParam = searchParams.get("lecturerId");

  // Race-condition guard from spec
  if (lecturerIdParam === "admin-root") return NextResponse.json([]);

  const parsedId = lecturerIdParam ? parseInt(lecturerIdParam, 10) : null;
  if (lecturerIdParam && (parsedId === null || isNaN(parsedId))) {
    return NextResponse.json([]);
  }

  if (!emailParam && parsedId === null) {
    return NextResponse.json([]);
  }

  try {
    const modules = await prisma.module.findMany({
      where: {
        OR: emailParam
          ? [
              { activeLecturer: { email: emailParam } },
              { examLecturer: { email: emailParam } },
            ]
          : [
              { activeLecturerId: parsedId },
              { examLecturerId: parsedId },
            ],
      },
      include: {
        activeLecturer: { select: { id: true, fullName: true, email: true } },
        examLecturer: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { code: "asc" },
    });

    const result = modules.map((m) => {
      const isActiveLec = emailParam
        ? m.activeLecturer?.email === emailParam
        : m.activeLecturerId === parsedId;

      return {
        id: m.id,
        code: m.code,
        name: m.name,
        credits: m.credits,
        isFrozen: m.isFrozen,
        stats: m.stats,
        activeLecturerId: m.activeLecturerId,
        examLecturerId: m.examLecturerId,
        assignedActiveLec: m.activeLecturer
          ? { id: m.activeLecturer.id, fullName: m.activeLecturer.fullName ?? "" }
          : null,
        assignedExamLec: m.examLecturer
          ? { id: m.examLecturer.id, fullName: m.examLecturer.fullName ?? "" }
          : null,
        roleInModule: isActiveLec ? "LECTURER" : "EXAMINER",
        isExaminerViewOnly: !isActiveLec,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching lecturer modules:", error);
    return NextResponse.json({ error: "Failed to load modules" }, { status: 500 });
  }
}

/**
 * PATCH /api/lecturer/modules
 *
 * Mode A — status only:  { moduleCode, marksheetStatus }
 *   • Validates the transition, refuses to reopen a closed marksheet, and runs a
 *     full completeness audit before allowing SECOND_CHECKING (submission).
 *
 * Mode B — blueprint save: { moduleCode, caComponents, finalBlueprint }
 *   • Structural validation, 100% weight rule, frozen + closed-marksheet locks,
 *     auto-generates examTemplate from the final blueprint.
 */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      moduleCode?: unknown;
      marksheetStatus?: unknown;
      caComponents?: unknown;
      finalBlueprint?: unknown;
    } | null;

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const moduleCode = typeof body.moduleCode === "string" ? body.moduleCode.trim() : "";
    if (!moduleCode) {
      return NextResponse.json({ error: "moduleCode is required" }, { status: 400 });
    }

    const existing = await prisma.module.findUnique({ where: { code: moduleCode } });
    if (!existing) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    const currentStats = asModuleStats(existing.stats);
    const currentStatus: MarksheetStatusValue = isMarksheetStatus(currentStats.marksheetStatus)
      ? currentStats.marksheetStatus
      : "DRAFT";

    // ── Mode A: status-only update ───────────────────────────────────────────
    if (body.marksheetStatus !== undefined) {
      const target = body.marksheetStatus;

      if (!isMarksheetStatus(target)) {
        return NextResponse.json(
          { error: `Unknown marksheet status '${String(target)}'.` },
          { status: 400 }
        );
      }

      if (existing.isFrozen) {
        return NextResponse.json(
          { error: "Module is frozen by the HOD. The marksheet cannot change state." },
          { status: 403 }
        );
      }

      // Idempotent: asking for the state we are already in is not an error.
      if (currentStatus === target) {
        return NextResponse.json({ success: true, unchanged: true, stats: existing.stats });
      }

      if (isLecturerLocked(currentStatus)) {
        return NextResponse.json(
          {
            error: `This marksheet is closed (${currentStatus}). It can no longer be re-opened from the Lecturer Desk.`,
            marksheetStatus: currentStatus,
          },
          { status: 409 }
        );
      }

      const allowedFrom = ALLOWED_TRANSITIONS[target] ?? [];
      if (!allowedFrom.includes(currentStatus)) {
        return NextResponse.json(
          {
            error: `Cannot move the marksheet from ${currentStatus} to ${target} from the Lecturer Desk.`,
            marksheetStatus: currentStatus,
          },
          { status: 409 }
        );
      }

      // ── Submission gate: the marksheet must be complete ────────────────────
      if (target === "SECOND_CHECKING") {
        const caComponents = normaliseCaComponents(currentStats.caComponents);
        const finalBlueprint = (currentStats.finalBlueprint ?? null) as FinalBlueprint | null;

        if (caComponents.length === 0 && !finalBlueprint?.enabled) {
          return NextResponse.json(
            { error: "Define the module blueprint before submitting marks for second checking." },
            { status: 400 }
          );
        }

        const rows = await prisma.studentMark.findMany({
          where: { moduleCode },
          select: {
            studentIndex: true,
            caQuestionsMarks: true,
            finalExamQuestionsMarks: true,
            isAbsentCa: true,
            isAbsentFinal: true,
          },
        });

        const errors = blockingIssues(
          validateMarksheet(rows as unknown as MarkRowLike[], caComponents, finalBlueprint)
        );

        if (errors.length > 0) {
          return NextResponse.json(
            {
              error: `Marksheet is incomplete — ${summariseIssues(errors, 3)}`,
              issues: errors,
            },
            { status: 400 }
          );
        }
      }

      const now = new Date().toISOString();
      const transitionMeta: Record<string, unknown> =
        target === "SECOND_CHECKING"
          ? { submittedAt: now }
          : { recalledAt: now, recallCount: Number(currentStats.recallCount ?? 0) + 1 };

      const updated = await prisma.module.update({
        where: { code: moduleCode },
        data: { stats: { ...currentStats, ...transitionMeta, marksheetStatus: target } },
      });

      return NextResponse.json({ success: true, marksheetStatus: target, stats: updated.stats });
    }

    // ── Mode B: full blueprint save ──────────────────────────────────────────
    if (body.caComponents === undefined || body.finalBlueprint === undefined) {
      return NextResponse.json(
        { error: "Provide both caComponents and finalBlueprint to save a blueprint." },
        { status: 400 }
      );
    }

    const structureError = validateBlueprintInput(body.caComponents, body.finalBlueprint);
    if (structureError) {
      return NextResponse.json({ error: structureError }, { status: 400 });
    }

    if (existing.isFrozen) {
      return NextResponse.json(
        { error: "Blueprint is locked or frozen by the HOD" },
        { status: 403 }
      );
    }

    // A blueprint defines the shape of every recorded mark — after the Examiner
    // has finalised, changing it would orphan the marks already signed off.
    if (isLecturerLocked(currentStatus)) {
      return NextResponse.json(
        {
          error: `The blueprint cannot be changed once the marksheet is ${currentStatus}.`,
          marksheetStatus: currentStatus,
        },
        { status: 409 }
      );
    }

    // Canonical shape: Group A components carry totalMarks, Group B components
    // carry a per-question weightage list. Legacy payloads are upgraded here.
    const caComponents = normaliseCaComponents(body.caComponents);
    const finalBlueprint = body.finalBlueprint as FinalBlueprint;

    // ── Auto-generate examTemplate from finalBlueprint ──────────────────────
    const examTemplate =
      finalBlueprint.enabled && (finalBlueprint.totalQuestions ?? 0) > 0
        ? Array.from({ length: finalBlueprint.totalQuestions }, (_, i) => ({
            id: `Q${i + 1}`,
            maxMarks: finalBlueprint.marksPerQuestion,
          }))
        : [];

    const componentIds = new Set(caComponents.map(comp => comp.id));

    const updatedStats = {
      ...currentStats,
      caComponents,
      finalBlueprint,
      examTemplate,
      caCompletionRate: caComponents.length > 0 ? 100 : 0,
      blueprintUpdatedAt: new Date().toISOString(),
      // Preserve existing marksheetStatus or set to DRAFT
      marksheetStatus: currentStats.marksheetStatus ?? "DRAFT",
    };

    const updated = await prisma.module.update({
      where: { code: moduleCode },
      data: { stats: updatedStats },
    });

    // ── Tidy up marks that belong to components that no longer exist ────────
    const orphaned = await removeOrphanedComponentMarks(moduleCode, componentIds);

    return NextResponse.json({
      success: true,
      stats: updated.stats,
      ...(orphaned > 0 ? { orphanedMarksCleared: orphaned } : {}),
    });
  } catch (error) {
    const msg = toErrorMessage(error);
    console.error("Error saving module blueprint:", msg);
    return NextResponse.json({ error: `Failed to save blueprint: ${msg}` }, { status: 500 });
  }
}

/**
 * When a CA component is deleted from the blueprint, drop its key from every
 * student row so the ledger cannot accumulate invisible marks.
 * Returns the number of rows touched.
 */
async function removeOrphanedComponentMarks(
  moduleCode: string,
  validComponentIds: Set<string>
): Promise<number> {
  try {
    const rows = await prisma.studentMark.findMany({
      where: { moduleCode },
      select: { id: true, caQuestionsMarks: true, isAbsentCa: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: any[] = [];

    for (const row of rows) {
      const marks = (row.caQuestionsMarks as Record<string, unknown>) ?? {};
      const absent = (row.isAbsentCa as Record<string, unknown>) ?? {};

      const keptMarks = Object.fromEntries(Object.entries(marks).filter(([key]) => validComponentIds.has(key)));
      const keptAbsent = Object.fromEntries(Object.entries(absent).filter(([key]) => validComponentIds.has(key)));

      if (
        Object.keys(keptMarks).length !== Object.keys(marks).length ||
        Object.keys(keptAbsent).length !== Object.keys(absent).length
      ) {
        ops.push(
          prisma.studentMark.update({
            where: { id: row.id },
            data: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              caQuestionsMarks: keptMarks as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              isAbsentCa: keptAbsent as any,
            },
          })
        );
      }
    }

    if (ops.length > 0) await prisma.$transaction(ops);
    return ops.length;
  } catch (error) {
    // Never fail a successful blueprint save because of housekeeping.
    console.error("[lecturer/modules] orphan cleanup failed:", toErrorMessage(error));
    return 0;
  }
}
