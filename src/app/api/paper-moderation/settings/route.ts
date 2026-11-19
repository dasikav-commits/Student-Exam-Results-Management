import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/moderation-session";
import { moderationActor } from "@/lib/moderation-access";
import { academicPeriod, positiveId } from "@/lib/paper-moderation";
import { boundedRequest, ModerationInputError } from "@/lib/moderation-documents";

const headers = { "Cache-Control": "private, no-store" };
const command = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("PERIOD"), ...academicPeriod.shape }),
  z.strictObject({ action: z.literal("PANEL"), userId: positiveId, approved: z.boolean() }),
  z.strictObject({ action: z.literal("COURSE_LECTURER"), userId: positiveId, moduleId: positiveId, assigned: z.boolean() }),
]);

export async function GET(request: Request) {
  try {
    const actor = await moderationActor(request);
    if (actor instanceof Response) return actor;
    const period = await prisma.moderationSettings.findUnique({ where: { department: actor.moderationDepartment }, select: { academicYear: true, semester: true } });
    if (!actor.isHod || new URL(request.url).searchParams.get("panel") !== "1") return NextResponse.json({ period }, { headers });
    const [users, modules] = await Promise.all([
      prisma.systemUser.findMany({ where: { role: "LECTURER", moderationDepartment: actor.moderationDepartment }, orderBy: { email: "asc" }, select: {
        id: true, fullName: true, email: true, isActiveLec: true, isExamLec: true, moderationDecision: { select: { approved: true } },
      } }),
      prisma.module.findMany({ where: { moderationDepartment: actor.moderationDepartment }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true,
        activeLecturer: { select: { fullName: true, email: true } }, examLecturer: { select: { fullName: true, email: true } },
        moderationLecturers: { select: { userId: true } },
      } }),
    ]);
    return NextResponse.json({ period, modules, users: users.map(({ moderationDecision, ...user }) => ({
      ...user, approved: moderationDecision?.approved ?? (user.isActiveLec || user.isExamLec),
    })) }, { headers });
  } catch { return apiError("Unable to load Paper Moderation settings.", 500); }
}

export async function POST(request: Request) {
  try {
    const actor = await moderationActor(request);
    if (actor instanceof Response) return actor;
    if (!actor.isHod) return apiError("Only the HOD can change moderation settings.", 403);
    const parsed = command.safeParse(await (await boundedRequest(request, 8192)).json().catch(() => null));
    if (!parsed.success) return apiError("Invalid academic period or panel assignment.", 400);
    const cmd = parsed.data;
    if (cmd.action === "PERIOD") {
      const values = { academicYear: cmd.academicYear, semester: cmd.semester };
      await prisma.moderationSettings.upsert({ where: { department: actor.moderationDepartment }, create: { department: actor.moderationDepartment, ...values }, update: values });
    } else {
      const user = await prisma.systemUser.findFirst({ where: { id: cmd.userId, role: "LECTURER", moderationDepartment: actor.moderationDepartment }, select: {
        id: true, isExamLec: true, isActiveLec: true, moderationDecision: { select: { approved: true } },
      } });
      if (!user) return apiError("Lecturer not found.", 404);
      if (cmd.action === "PANEL") {
        await prisma.moderationPanelDecision.upsert({ where: { userId: user.id }, create: { userId: user.id, approved: cmd.approved }, update: { approved: cmd.approved } });
      } else if (!await prisma.module.findUnique({ where: { id: cmd.moduleId, moderationDepartment: actor.moderationDepartment }, select: { id: true } })) {
        return apiError("Module not found in your department.", 404);
      } else if (!cmd.assigned) {
        await prisma.moderationCourseLecturer.deleteMany({ where: { userId: user.id, moduleId: cmd.moduleId } });
      } else {
        if (!(user.moderationDecision?.approved ?? (user.isActiveLec || user.isExamLec))) return apiError("Approve the lecturer before assigning them.", 409);
        await prisma.moderationCourseLecturer.upsert({ where: { moduleId_userId: { moduleId: cmd.moduleId, userId: user.id } },
          create: { moduleId: cmd.moduleId, userId: user.id }, update: {}, });
      }
    }
    return NextResponse.json({ success: true }, { headers });
  } catch (error) {
    if (error instanceof ModerationInputError) return apiError(error.message, error.status);
    return apiError("Unable to save Paper Moderation settings.", 500);
  }
}
