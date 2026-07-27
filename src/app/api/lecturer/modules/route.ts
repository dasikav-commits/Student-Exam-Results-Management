import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { CaComponent, FinalBlueprint } from "@/types/hod";

export const dynamic = "force-dynamic";

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
 * Body: { moduleCode, caComponents, finalBlueprint }
 *
 * Rules:
 *  - Sum(caComponents.weightage) + finalBlueprint.weightage MUST equal 100
 *  - If module.isFrozen → 403
 *  - Auto-generates examTemplate from finalBlueprint.totalQuestions
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json() as {
      moduleCode: string;
      marksheetStatus?: string;
      caComponents?: CaComponent[];
      finalBlueprint?: FinalBlueprint;
    };

    const { moduleCode, marksheetStatus, caComponents, finalBlueprint } = body;

    if (!moduleCode) {
      return NextResponse.json({ error: "moduleCode is required" }, { status: 400 });
    }

    // ── Mode A: Status-only update (no weight check needed) ────────────────
    if (marksheetStatus !== undefined) {
      const existing = await prisma.module.findUnique({ where: { code: moduleCode } });
      if (!existing) return NextResponse.json({ error: "Module not found" }, { status: 404 });
      const currentStats = (existing.stats as any) ?? {};
      const updated = await prisma.module.update({
        where: { code: moduleCode },
        data: { stats: { ...currentStats, marksheetStatus } as any },
      });
      return NextResponse.json({ success: true, stats: updated.stats });
    }

    // ── Mode B: Full blueprint save with 100% weight check ─────────────────
    const caTotal = (caComponents ?? []).reduce(
      (sum: number, c: CaComponent) => sum + (Number(c.weightage) || 0),
      0
    );
    const finalWeight = Number(finalBlueprint?.weightage) || 0;
    const grandTotal = caTotal + finalWeight;

    if (grandTotal !== 100) {
      return NextResponse.json(
        {
          error: `Total weight must equal exactly 100%. Current: ${grandTotal}% (CA: ${caTotal}% + Final: ${finalWeight}%)`,
        },
        { status: 400 }
      );
    }

    // ── Operational lock check ──────────────────────────────────────────────
    const existing = await prisma.module.findUnique({ where: { code: moduleCode } });
    if (!existing) return NextResponse.json({ error: "Module not found" }, { status: 404 });
    if (existing.isFrozen) {
      return NextResponse.json(
        { error: "Blueprint is locked or frozen by the HOD" },
        { status: 403 }
      );
    }

    // ── Auto-generate examTemplate from finalBlueprint ──────────────────────
    const examTemplate =
      finalBlueprint?.enabled && (finalBlueprint?.totalQuestions ?? 0) > 0
        ? Array.from({ length: finalBlueprint!.totalQuestions }, (_, i) => ({
            id: `Q${i + 1}`,
            maxMarks: finalBlueprint!.marksPerQuestion,
          }))
        : [];

    const currentStats = (existing.stats as any) ?? {};
    const updatedStats = {
      ...currentStats,
      caComponents: caComponents ?? [],
      finalBlueprint: finalBlueprint ?? {},
      examTemplate,
      caCompletionRate: (caComponents ?? []).length > 0 ? 100 : 0,
      // Preserve existing marksheetStatus or set to DRAFT
      marksheetStatus: currentStats.marksheetStatus ?? "DRAFT",
    };

    const updated = await prisma.module.update({
      where: { code: moduleCode },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { stats: updatedStats as any },
    });

    return NextResponse.json({ success: true, stats: updated.stats });
  } catch (error) {
    console.error("Error saving module blueprint:", error);
    return NextResponse.json({ error: "Failed to save blueprint" }, { status: 500 });
  }
}