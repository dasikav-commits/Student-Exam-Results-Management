import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asModuleStats, buildFinalExamTemplate, normaliseFinalBlueprint } from "@/lib/lecturer-marks";

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

    const result = modules.map((m) => {
      const stats = asModuleStats(m.stats);
      const finalBlueprint = normaliseFinalBlueprint(stats.finalBlueprint, stats.examTemplate);
      return {
      id: m.id,
      code: m.code,
      name: m.name,
      credits: m.credits,
      eligibleStudents: m.eligibleStudents,
      deadline: m.deadline,
      isFrozen: m.isFrozen,
      stats: { ...stats, finalBlueprint, examTemplate: buildFinalExamTemplate(finalBlueprint) },
      assignedActiveLec: m.activeLecturer
        ? { id: m.activeLecturer.id, fullName: m.activeLecturer.fullName ?? "" }
        : null,
      assignedExamLec: m.examLecturer
        ? { id: m.examLecturer.id, fullName: m.examLecturer.fullName ?? "" }
        : null,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching modules:", error);
    return NextResponse.json({ error: "Failed to fetch modules" }, { status: 500 });
  }
}

/**
 * POST /api/hod/modules
 * Create a module and assign its active lecturer.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const lecturerId = Number(body.lecturerId);
    const eligibleStudents = Number(body.eligibleStudents);
    const deadline = typeof body.deadline === "string" ? new Date(body.deadline) : null;
    const allowedComponents = ["CONTINUOUS_ASSESSMENT", "PRACTICAL", "LAB_SESSIONS"];
    const components: string[] = Array.isArray(body.components)
      ? [...new Set((body.components as unknown[]).filter((component): component is string =>
          typeof component === "string" && allowedComponents.includes(component)
        ))]
      : [];

    if (!name || !code) {
      return NextResponse.json({ error: "Module name and code are required" }, { status: 400 });
    }
    if (!Number.isInteger(lecturerId) || lecturerId <= 0) {
      return NextResponse.json({ error: "Select a valid lecturer" }, { status: 400 });
    }
    if (!Number.isInteger(eligibleStudents) || eligibleStudents < 0) {
      return NextResponse.json({ error: "Eligible students must be a non-negative whole number" }, { status: 400 });
    }
    if (!deadline || Number.isNaN(deadline.getTime())) {
      return NextResponse.json({ error: "A valid deadline is required" }, { status: 400 });
    }
    if (!Array.isArray(body.components) || components.length !== body.components.length) {
      return NextResponse.json({ error: "Select valid module components" }, { status: 400 });
    }

    const lecturer = await prisma.systemUser.findFirst({
      where: { id: lecturerId, role: "LECTURER" },
      select: { id: true },
    });
    if (!lecturer) {
      return NextResponse.json({ error: "Lecturer not found" }, { status: 404 });
    }

    const createdModule = await prisma.module.create({
      data: {
        code,
        name,
        activeLecturer: { connect: { id: lecturerId } },
        eligibleStudents,
        deadline,
        stats: { moduleComponents: components, caComponents: [], marksheetStatus: "DRAFT" },
      },
    });

    return NextResponse.json({ success: true, module: createdModule }, { status: 201 });
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
    if (errorCode === "P2002") {
      return NextResponse.json({ error: "A module with this code already exists" }, { status: 409 });
    }
    console.error("Error creating module:", error);
    const message = error instanceof Error ? error.message : "Unknown database error";
    return NextResponse.json(
      { error: process.env.NODE_ENV === "development" ? message : "Failed to create module" },
      { status: 500 }
    );
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
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
    if (errorCode === "P2025") {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }
    console.error("Error updating module:", error);
    return NextResponse.json({ error: "Failed to update module" }, { status: 500 });
  }
}