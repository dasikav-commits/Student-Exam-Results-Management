import { prisma } from "./prisma";
import { apiError, moderationEnabled, requireSession } from "./moderation-session";
import type { Prisma } from "@prisma/client";

export const moderationModuleSelect = {
  id: true, code: true, name: true, moderationDepartment: true, activeLecturerId: true, examLecturerId: true,
  moderationLecturers: { select: { userId: true } },
} as const;
export const availableModerator = {
  role: "LECTURER", isExamLec: true,
  OR: [{ moderationDecision: { is: null } }, { moderationDecision: { is: { approved: true } } }],
} as const satisfies Prisma.SystemUserWhereInput;

async function panelApproved(db: Prisma.TransactionClient, user: { id: number; isActiveLec: boolean; isExamLec: boolean }) {
  const decision = await db.moderationPanelDecision.findUnique({ where: { userId: user.id } });
  return decision?.approved ?? (user.isActiveLec || user.isExamLec);
}

export async function moderationActor(request: Request) {
  if (!moderationEnabled()) return apiError("Paper Moderation is not enabled.", 404);
  const user = await requireSession(request);
  if (user instanceof Response) return user;
  if (user.role !== "LECTURER") return apiError("Paper Moderation is for lecturers and the HOD.", 403);
  const approved = await panelApproved(prisma, user);
  if (!approved && !user.isHod) return apiError("Faculty Board panel approval is required for Paper Moderation.", 403);
  return { ...user, approved, isActiveLec: user.isActiveLec && approved, isExamLec: user.isExamLec && approved };
}

export type PaperActor = Exclude<Awaited<ReturnType<typeof moderationActor>>, Response>;
export type PaperModule = Prisma.ModuleGetPayload<{ select: typeof moderationModuleSelect }>;

export function canReadPaper(actor: PaperActor, module: PaperModule, status: string) {
  if (module.moderationDepartment !== actor.moderationDepartment) return false;
  if (actor.isActiveLec && module.activeLecturerId === actor.id) return true;
  if (status === "DRAFT") return false;
  if (actor.isExamLec && module.examLecturerId === actor.id && module.activeLecturerId !== actor.id) return true;
  return actor.approved && module.moderationLecturers.some(row => row.userId === actor.id) || actor.isHod && status === "FINALIZED";
}

export function publishedBundles(events: { action: string; version: number; details: Prisma.JsonValue | null }[]) {
  return new Set(events.filter(event => event.action === "SUBMIT" || event.action === "RESUBMIT").map(event => {
    const details = event.details;
    return details && typeof details === "object" && !Array.isArray(details) && typeof details.bundleVersion === "number"
      ? details.bundleVersion : event.version;
  }));
}

export async function refreshPaperActor(tx: Prisma.TransactionClient, actor: PaperActor): Promise<PaperActor | null> {
  const current = await tx.systemUser.findUnique({ where: { id: actor.id }, select: {
    role: true, isHod: true, isActiveLec: true, isExamLec: true, moderationDepartment: true,
  } });
  if (current?.role !== "LECTURER") return null;
  const approved = await panelApproved(tx, { ...current, id: actor.id });
  return { ...actor, ...current, approved, isActiveLec: current.isActiveLec && approved, isExamLec: current.isExamLec && approved };
}
