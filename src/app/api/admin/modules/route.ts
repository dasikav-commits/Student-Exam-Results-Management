import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asModuleStats, isLecturerLocked } from "@/lib/lecturer-marks";

export const dynamic = "force-dynamic";

/** Module assignments for the Admin desk; HOD examiner controls remain hidden. */
export async function GET() {
  try {
    const modules = await prisma.module.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, isFrozen: true, stats: true,
        activeLecturerId: true, examLecturerId: true,
        activeLecturer: { select: { fullName: true } },
        _count: { select: { studentMarks: true } },
      },
    });
    return NextResponse.json(modules.map(mod => ({
      id: String(mod.id), code: mod.code, name: mod.name,
      activeLecturerId: mod.activeLecturerId, examLecturerId: mod.examLecturerId,
      assignedLecturerName: mod.activeLecturer?.fullName ?? "Unassigned",
      totalStudents: mod._count.studentMarks,
      assignmentLocked: mod.isFrozen || isLecturerLocked(asModuleStats(mod.stats).marksheetStatus)
        || asModuleStats(mod.stats).marksheetStatus === "SECOND_CHECKING",
    })));
  } catch (error) {
    console.error("Admin modules GET:", error);
    return NextResponse.json({ error: "Failed to load module assignments." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.moduleCode !== "string" || !body.moduleCode.trim()
      || (body.examLecturerId !== null && (!Number.isSafeInteger(body.examLecturerId) || body.examLecturerId <= 0))) {
      return NextResponse.json({ error: "Provide moduleCode and a valid examiner ID (or null to unassign)." }, { status: 400 });
    }
    const mod = await prisma.module.findUnique({ where: { code: body.moduleCode.trim() } });
    if (!mod) return NextResponse.json({ error: "Module not found." }, { status: 404 });
    const status = asModuleStats(mod.stats).marksheetStatus;
    if (mod.isFrozen || status === "SECOND_CHECKING" || isLecturerLocked(status)) {
      return NextResponse.json({ error: "Recall the marksheet before changing its Second Examiner. Frozen and finalised assignments are locked." }, { status: 409 });
    }
    if (body.examLecturerId !== null) {
      if (body.examLecturerId === mod.activeLecturerId) {
        return NextResponse.json({ error: "The First and Second Examiner must be different people." }, { status: 400 });
      }
      const examiner = await prisma.systemUser.findFirst({ where: { id: body.examLecturerId, role: "LECTURER", isExamLec: true }, select: { id: true } });
      if (!examiner) return NextResponse.json({ error: "Choose a lecturer with Second Examiner capability." }, { status: 400 });
    }
    await prisma.module.update({ where: { id: mod.id }, data: { examLecturerId: body.examLecturerId } });
    return NextResponse.json({ success: true, examLecturerId: body.examLecturerId });
  } catch (error) {
    console.error("Admin module assignment PATCH:", error);
    return NextResponse.json({ error: "Failed to update Second Examiner assignment." }, { status: 500 });
  }
}
