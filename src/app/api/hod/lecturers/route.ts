import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/hod/lecturers
 * Returns all LECTURER users with their assigned module codes
 */
export async function GET() {
  try {
    const lecturers = await prisma.systemUser.findMany({
      where: { role: "LECTURER" },
      orderBy: { fullName: "asc" },
      include: {
        activeModules: { select: { code: true } },
        examModules: { select: { code: true } },
      },
    });

    const result = lecturers.map((l) => ({
      id: l.id,
      fullName: l.fullName ?? l.email,
      email: l.email,
      isHod: l.isHod,
      isActiveLec: l.isActiveLec,
      isExamLec: l.isExamLec,
      activeModules: l.activeModules.map((m) => m.code),
      examModules: l.examModules.map((m) => m.code),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching lecturers:", error);
    return NextResponse.json({ error: "Failed to fetch lecturers" }, { status: 500 });
  }
}

/**
 * PATCH /api/hod/lecturers
 * Re-assigns module workloads for a lecturer
 */
export async function PATCH(request: Request) {
  try {
    const { lecturerId, activeModuleCodes, examModuleCodes } = await request.json();
    const lecId = parseInt(lecturerId, 10);

    if (isNaN(lecId)) {
      return NextResponse.json({ error: "Invalid lecturer ID" }, { status: 400 });
    }

    // Run all updates in a transaction
    await prisma.$transaction(async (tx) => {
      // Clear previous active assignments for this lecturer
      await tx.module.updateMany({
        where: { activeLecturerId: lecId },
        data: { activeLecturerId: null },
      });
      // Clear previous exam assignments
      await tx.module.updateMany({
        where: { examLecturerId: lecId },
        data: { examLecturerId: null },
      });

      // Assign new active modules
      if (activeModuleCodes?.length > 0) {
        await tx.module.updateMany({
          where: { code: { in: activeModuleCodes } },
          data: { activeLecturerId: lecId },
        });
      }

      // Assign new exam modules
      if (examModuleCodes?.length > 0) {
        await tx.module.updateMany({
          where: { code: { in: examModuleCodes } },
          data: { examLecturerId: lecId },
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating lecturer assignments:", error);
    return NextResponse.json({ error: "Failed to update assignments" }, { status: 500 });
  }
}