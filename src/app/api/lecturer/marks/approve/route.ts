import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/lecturer/marks/approve
 * Body: { moduleCode: string }
 *
 * The Active Lecturer formally approves the Second Examiner's marksheet
 * for a module that is in RECONCILIATION_NEEDED state.
 * This unlocks the Examiner's "Finalise Reconciliation" button.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { moduleCode } = body;

    if (!moduleCode || typeof moduleCode !== "string") {
      return NextResponse.json({ error: "moduleCode is required" }, { status: 400 });
    }

    const mod = await prisma.module.findUnique({ where: { code: moduleCode } });
    if (!mod) {
      return NextResponse.json({ error: `Module '${moduleCode}' not found` }, { status: 404 });
    }

    const currentStats = (mod.stats as any) ?? {};
    if (currentStats.marksheetStatus !== "RECONCILIATION_NEEDED") {
      return NextResponse.json(
        { error: "Module is not in RECONCILIATION_NEEDED state." },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    await prisma.module.update({
      where: { code: moduleCode },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        stats: {
          ...currentStats,
          lecturerApproved: true,
          lecturerApprovedAt: now,
        } as any,
      },
    });

    return NextResponse.json({ success: true, lecturerApprovedAt: now });
  } catch (error: any) {
    const msg = error?.message ?? String(error);
    console.error("[lecturer/marks/approve POST] Error:", msg);
    return NextResponse.json(
      { error: `Failed to approve marksheet: ${msg}` },
      { status: 500 }
    );
  }
}
