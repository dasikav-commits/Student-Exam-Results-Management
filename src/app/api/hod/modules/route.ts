import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/hod/modules
 * Returns all modules with assigned lecturer info
 */
export async function GET() {
  try {
    const modules = await prisma.module.findMany({
      orderBy: { code: "asc" },
      include: {
        activeLecturer: { select: { id: true, fullName: true } },
        examLecturer: { select: { id: true, fullName: true } },
      },
    });

    const result = modules.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      credits: m.credits,
      isFrozen: m.isFrozen,
      stats: m.stats,
      assignedActiveLec: m.activeLecturer
        ? { id: m.activeLecturer.id, fullName: m.activeLecturer.fullName ?? "" }
        : null,
      assignedExamLec: m.examLecturer
        ? { id: m.examLecturer.id, fullName: m.examLecturer.fullName ?? "" }
        : null,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching modules:", error);
    return NextResponse.json({ error: "Failed to fetch modules" }, { status: 500 });
  }
}

/**
 * PATCH /api/hod/modules
 * Toggle freeze or reassign lecturers
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { code, isFrozen, activeLecturerId, examLecturerId } = body;

    if (!code) {
      return NextResponse.json({ error: "Module code is required" }, { status: 400 });
    }

    // Determine what we're updating
    if (isFrozen !== undefined) {
      // Freeze / unfreeze toggle
      const updated = await prisma.module.update({
        where: { code },
        data: { isFrozen },
        select: { id: true, code: true, isFrozen: true },
      });
      return NextResponse.json({ success: true, ...updated });
    }

    // Reassign lecturers
    const data: Record<string, number | null> = {};
    if (activeLecturerId !== undefined) {
      data.activeLecturerId =
        activeLecturerId === "" || activeLecturerId === null
          ? null
          : parseInt(activeLecturerId, 10);
    }
    if (examLecturerId !== undefined) {
      data.examLecturerId =
        examLecturerId === "" || examLecturerId === null
          ? null
          : parseInt(examLecturerId, 10);
    }

    const updated = await prisma.module.update({
      where: { code },
      data,
      select: { id: true, code: true },
    });

    return NextResponse.json({ success: true, ...updated });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }
    console.error("Error updating module:", error);
    return NextResponse.json({ error: "Failed to update module" }, { status: 500 });
  }
}