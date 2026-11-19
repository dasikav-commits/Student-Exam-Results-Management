import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, moderationEnabled, requireSession } from "@/lib/moderation-session";
import { moderationCommand, moderationRoles, moderationTransition } from "@/lib/paper-moderation";

const headers = { "Cache-Control": "no-store" };
const moduleSelect = { id: true, code: true, name: true, activeLecturerId: true, examLecturerId: true } as const;
const paperSelect = {
  id: true, moduleId: true, academicYear: true, semester: true, reference: true, status: true, version: true,
  submittedById: true, updatedAt: true,
  events: { orderBy: { version: "asc" }, select: { version: true, action: true, note: true, createdAt: true } },
} as const satisfies Prisma.ModerationPaperSelect;
const eligibleModerator = { role: "LECTURER", isExamLec: true } as const;

async function getActor(request: Request) {
  if (!moderationEnabled()) return apiError("Paper Moderation is not enabled.", 404);
  const actor = await requireSession(request);
  if (actor instanceof Response) return actor;
  if (actor.role !== "LECTURER" || (!actor.isActiveLec && !actor.isExamLec)) {
    return apiError("You need a lecturer or Second Examiner assignment to use this workspace.", 403);
  }
  return actor;
}

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor instanceof Response) return actor;
    const where: Prisma.ModuleWhereInput = { OR: [
      ...(actor.isActiveLec ? [{ activeLecturerId: actor.id }] : []),
      ...(actor.isExamLec ? [{ examLecturerId: actor.id, OR: [{ activeLecturerId: null }, { activeLecturerId: { not: actor.id } }] }] : []),
    ] };
    const modules = await prisma.module.findMany({
      where, orderBy: { code: "asc" }, select: {
        ...moduleSelect, examLecturer: { select: { role: true, isExamLec: true } },
        moderationPapers: { orderBy: [{ academicYear: "desc" }, { semester: "desc" }], select: paperSelect },
      },
    });
    return NextResponse.json(modules.map(module => {
      const { setter, moderator } = moderationRoles(actor, module);
      return {
        id: module.id, code: module.code, name: module.name, setter, moderator,
        hasModerator: module.examLecturerId !== module.activeLecturerId
          && module.examLecturer?.role === "LECTURER" && module.examLecturer.isExamLec,
        papers: module.moderationPapers.map(({ submittedById, ...paper }) => ({
          ...paper, canReview: moderator && submittedById !== actor.id,
        })),
      };
    }), { headers });
  } catch (error) {
    console.error("Unable to load paper moderation:", error);
    return apiError("Unable to load paper moderation.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor instanceof Response) return actor;
    const parsed = moderationCommand.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("Invalid submission: check the academic period, reference or review notes.", 400);
    const cmd = parsed.data;

    return await prisma.$transaction(async tx => {
      if (cmd.action === "SUBMIT") {
        const assignedModule = await tx.module.findFirst({
          where: { id: cmd.moduleId, activeLecturerId: actor.id }, select: moduleSelect,
        });
        if (!assignedModule || !moderationRoles(actor, assignedModule).setter) return apiError("Assigned module not found.", 404);
        const moderator = assignedModule.examLecturerId && assignedModule.examLecturerId !== actor.id
          ? await tx.systemUser.findFirst({ where: { id: assignedModule.examLecturerId, ...eligibleModerator }, select: { id: true } }) : null;
        if (!moderator) return apiError("Assign a different eligible Second Examiner before submitting.", 409);

        await tx.moderationPaper.create({ data: {
          moduleId: assignedModule.id, academicYear: cmd.academicYear, semester: cmd.semester,
          reference: cmd.reference, submittedById: actor.id,
          events: { create: { actorId: actor.id, version: 1, action: cmd.action, note: cmd.reference } },
        }, select: { id: true } });
        return NextResponse.json({ success: true }, { status: 201, headers });
      }

      const paper = await tx.moderationPaper.findUnique({ where: { id: cmd.paperId }, select: {
        id: true, version: true, status: true, submittedById: true,
        module: { select: moduleSelect },
      } });
      if (!paper) return apiError("Assigned paper not found.", 404);
      const { setter, moderator } = moderationRoles(actor, paper.module);
      if (!setter && !moderator) return apiError("Assigned paper not found.", 404);
      if (cmd.action === "RESUBMIT" ? !setter : !moderator || paper.submittedById === actor.id) {
        return apiError("Only the assigned setter or independent moderator may perform their own actions.", 403);
      }
      if (cmd.action === "RESUBMIT") {
        const moderatorId = paper.module.examLecturerId;
        if (moderatorId === null || moderatorId === actor.id || !await tx.systemUser.findFirst({
          where: { id: moderatorId, ...eligibleModerator }, select: { id: true },
        })) return apiError("Assign a different eligible Second Examiner before resubmitting.", 409);
      }
      const status = moderationTransition(cmd.action, paper.status);
      if (!status || paper.version !== cmd.version) return apiError("This paper changed or is no longer awaiting that action. Refresh the workspace.", 409);
      const nextVersion = cmd.version + 1;
      const updated = await tx.moderationPaper.updateMany({
        where: { id: paper.id, version: cmd.version },
        data: { status, version: nextVersion, ...(cmd.action === "RESUBMIT" ? { reference: cmd.reference, submittedById: actor.id } : {}) },
      });
      if (!updated.count) return apiError("This paper changed. Refresh the workspace.", 409);
      await tx.moderationEvent.create({ data: {
        paperId: paper.id, version: nextVersion, actorId: actor.id,
        action: cmd.action, note: cmd.action === "RESUBMIT" ? cmd.reference : cmd.note,
      } });
      return NextResponse.json({ success: true }, { headers });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return apiError("A submission already exists for this module and academic period. Refresh the workspace.", 409);
      if (error.code === "P2034" || error.code === "P2003") return apiError("The paper or module changed. Refresh the workspace and try again.", 409);
    }
    console.error("Unable to update paper moderation:", error);
    return apiError("Unable to update paper moderation.", 500);
  }
}
