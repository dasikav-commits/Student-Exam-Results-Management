import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/examiner/marks/finalise-reconciled
 * Body: { moduleCode: string }
 *
 * The Second Examiner finalises a module that is in RECONCILIATION_NEEDED
 * state AND has been approved by the Active Lecturer (lecturerApproved: true).
 * Sets marksheetStatus → "RECONCILED" and records reconciledAt.
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

    if (!currentStats.lecturerApproved) {
      return NextResponse.json(
        { error: "Cannot finalise: the Active Lecturer has not yet approved the marksheet." },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();
    await prisma.module.update({
      where: { code: moduleCode },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        stats: {
          ...currentStats,
          marksheetStatus: "RECONCILED",
          reconciledAt: now,
        } as any,
      },
    });

    return NextResponse.json({ success: true, reconciledAt: now });
  } catch (error: any) {
    const msg = error?.message ?? String(error);
    console.error("[examiner/marks/finalise-reconciled POST] Error:", msg);
    return NextResponse.json(
      { error: `Failed to finalise reconciliation: ${msg}` },
      { status: 500 }
    );
  }
}
