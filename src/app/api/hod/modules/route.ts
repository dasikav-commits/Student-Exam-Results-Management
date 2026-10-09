import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asModuleStats, buildFinalExamTemplate, normaliseFinalBlueprint } from "@/lib/lecturer-marks";

export const dynamic = "force-dynamic";

const ALLOWED_COMPONENTS = ["CONTINUOUS_ASSESSMENT", "PRACTICAL", "LAB_SESSIONS"] as const;
type AllowedComponent = typeof ALLOWED_COMPONENTS[number];

function isValidComponent(c: unknown): c is AllowedComponent {
  return typeof c === "string" && (ALLOWED_COMPONENTS as readonly string[]).includes(c);
}

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
    const components: string[] = Array.isArray(body.components)
      ? [...new Set((body.components as unknown[]).filter(isValidComponent))]
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
 *
 * Multiplexed update endpoint — dispatched by which fields appear in the body:
 *   • Freeze toggle:           { code, isFrozen }
 *   • Edit blueprint:          { code, name?, activeLecturerId?, eligibleStudents?,
 *                               deadline?, components? }
 *   • Lecturer reassignment:   { code, activeLecturerId?, examLecturerId? }
 *     (triggered when the caller only sends IDs — i.e. the manage-lecturer modal)
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!code) {
      return NextResponse.json({ error: "Module code is required" }, { status: 400 });
    }

    // ── 1. Freeze / unfreeze ──────────────────────────────────────────────
    if (typeof body.isFrozen === "boolean") {
      const updated = await prisma.module.update({
        where: { code },
        data: { isFrozen: body.isFrozen },
        select: { id: true, code: true, isFrozen: true },
      });
      return NextResponse.json({ success: true, ...updated });
    }

    // ── 2. Edit blueprint fields ──────────────────────────────────────────
    //     Heuristic: any blueprint field present => treat as an edit.
    const isBlueprintEdit =
      "name" in body ||
      "eligibleStudents" in body ||
      "deadline" in body ||
      "components" in body;

    if (isBlueprintEdit) {
      const data: Record<string, unknown> = {};
      let nextComponents: string[] | null = null;

      // Validate every present field BEFORE touching the DB so invalid input
      // returns 400 instead of 500.
      if ("name" in body) {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) return NextResponse.json({ error: "Module name is required" }, { status: 400 });
        if (name.length > 120) return NextResponse.json({ error: "Module name is too long" }, { status: 400 });
        data.name = name;
      }

      if ("activeLecturerId" in body) {
        const raw = body.activeLecturerId;
        const lecturerId = raw === "" || raw === null ? null : Number(raw);
        if (lecturerId !== null) {
          if (!Number.isInteger(lecturerId) || lecturerId <= 0) {
            return NextResponse.json({ error: "Select a valid lecturer" }, { status: 400 });
          }
          const lecturer = await prisma.systemUser.findFirst({
            where: { id: lecturerId, role: "LECTURER" },
            select: { id: true },
          });
          if (!lecturer) {
            return NextResponse.json({ error: "Lecturer not found or is not a LECTURER" }, { status: 400 });
          }
          data.activeLecturerId = lecturerId;
        } else {
          data.activeLecturerId = null;
        }
      }

      if ("eligibleStudents" in body) {
        const n = Number(body.eligibleStudents);
        if (!Number.isInteger(n) || n < 0) {
          return NextResponse.json({ error: "Eligible students must be a non-negative whole number" }, { status: 400 });
        }
        data.eligibleStudents = n;
      }

      if ("deadline" in body) {
        const raw = body.deadline;
        if (raw === null || raw === "") {
          data.deadline = null;
        } else {
          const d = typeof raw === "string" ? new Date(raw) : null;
          if (!d || Number.isNaN(d.getTime())) {
            return NextResponse.json({ error: "A valid deadline is required" }, { status: 400 });
          }
          data.deadline = d;
        }
      }

      if ("components" in body) {
        if (!Array.isArray(body.components)) {
          return NextResponse.json({ error: "Components must be a list" }, { status: 400 });
        }
        const comps = [...new Set((body.components as unknown[]).filter(isValidComponent))];
        if (comps.length !== body.components.length) {
          return NextResponse.json({ error: "Select valid module components" }, { status: 400 });
        }
        nextComponents = comps;
      }

      if (Object.keys(data).length === 0 && nextComponents === null) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
      }

      // If components changed, load existing stats so we can merge without
      // clobbering caComponents / finalBlueprint.
      if (nextComponents !== null) {
        const existing = await prisma.module.findUnique({
          where: { code },
          select: { stats: true },
        });
        if (!existing) return NextResponse.json({ error: "Module not found" }, { status: 404 });
        const prevStats = asModuleStats(existing.stats);
        data.stats = { ...prevStats, moduleComponents: nextComponents };
      }

      const updated = await prisma.module.update({
        where: { code },
        data,
        select: { id: true, code: true },
      });
      return NextResponse.json({ success: true, ...updated });
    }

    // ── 3. Lecturer reassignment (manage-lecturer modal path) ─────────────
    const data: Record<string, number | null> = {};
    if (body.activeLecturerId !== undefined) {
      data.activeLecturerId =
        body.activeLecturerId === "" || body.activeLecturerId === null
          ? null
          : parseInt(body.activeLecturerId, 10);
    }
    if (body.examLecturerId !== undefined) {
      data.examLecturerId =
        body.examLecturerId === "" || body.examLecturerId === null
          ? null
          : parseInt(body.examLecturerId, 10);
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
    if (errorCode === "P2002") {
      return NextResponse.json({ error: "A module with that code already exists" }, { status: 409 });
    }
    console.error("Error updating module:", error);
    return NextResponse.json({ error: "Failed to update module" }, { status: 500 });
  }
}

/**
 * DELETE /api/hod/modules?code=XYZ
 *
 * Deletes the module. Related student_marks rows are removed by the schema's
 * onDelete: Cascade, so deleting a module also wipes all recorded marks for it.
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = (searchParams.get("code") ?? "").trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ error: "Module code is required" }, { status: 400 });
    }

    await prisma.module.delete({ where: { code } });
    return NextResponse.json({ success: true, code });
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
    if (errorCode === "P2025") {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }
    console.error("Error deleting module:", error);
    return NextResponse.json({ error: "Failed to delete module" }, { status: 500 });
  }
}
