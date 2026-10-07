import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asModuleStats, toErrorMessage } from "@/lib/lecturer-marks";

export const dynamic = "force-dynamic";

/**
 * POST /api/lecturer/marks/approve
 * Body: { moduleCode: string }
 *
 * The Active Lecturer formally approves the Second Examiner's marksheet for a
 * module that is in RECONCILIATION_NEEDED state (variance above the threshold).
 * This unlocks the Examiner's "Finalise Reconciliation" action.
 *
 * Guard rails:
 *  • the module must be in RECONCILIATION_NEEDED;
 *  • it must not already be approved (idempotent response instead of an error);
 *  • the module must not be frozen by the HOD.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { moduleCode?: unknown } | null;
    const moduleCode = typeof body?.moduleCode === "string" ? body.moduleCode.trim() : "";

    if (!moduleCode) {
      return NextResponse.json({ error: "moduleCode is required" }, { status: 400 });
    }

    const mod = await prisma.module.findUnique({ where: { code: moduleCode } });
    if (!mod) {
      return NextResponse.json({ error: `Module '${moduleCode}' not found` }, { status: 404 });
    }

    const currentStats = asModuleStats(mod.stats);

    if (currentStats.marksheetStatus !== "RECONCILIATION_NEEDED") {
      return NextResponse.json(
        {
          error: "Module is not in RECONCILIATION_NEEDED state.",
          marksheetStatus: currentStats.marksheetStatus ?? "DRAFT",
        },
        { status: 409 }
      );
    }

    if (currentStats.lecturerApproved === true) {
      return NextResponse.json({
        success: true,
        unchanged: true,
        lecturerApprovedAt: currentStats.lecturerApprovedAt ?? null,
        stats: mod.stats,
      });
    }

    if (mod.isFrozen) {
      return NextResponse.json(
        { error: "Module is frozen by the HOD. Approval is disabled until it is unfrozen." },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();
    const updated = await prisma.module.update({
      where: { code: moduleCode },
      data: {
        stats: {
          ...currentStats,
          lecturerApproved: true,
          lecturerApprovedAt: now,
        },
      },
    });

    return NextResponse.json({
      success: true,
      lecturerApprovedAt: now,
      stats: updated.stats,
    });
  } catch (error) {
    const msg = toErrorMessage(error);
    console.error("[lecturer/marks/approve POST] Error:", msg);
    return NextResponse.json({ error: `Failed to approve marksheet: ${msg}` }, { status: 500 });
  }
}
