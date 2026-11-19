import type { PaperModerationAction, PaperModerationStatus } from "@prisma/client";
import { z } from "zod";

const positiveId = z.number().int().min(1).max(2147483647);
const reference = z.string().trim().min(1).max(160);
const note = z.string().trim().max(2000);

export const moderationCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("SUBMIT"), moduleId: positiveId, reference, semester: z.union([z.literal(1), z.literal(2)]),
    academicYear: z.string().trim().regex(/^20\d{2}\/20\d{2}$/).refine(year => Number(year.slice(5)) === Number(year.slice(0, 4)) + 1, "Use consecutive academic years, e.g. 2026/2027.") }),
  z.strictObject({ action: z.literal("RESUBMIT"), paperId: positiveId, version: positiveId, reference }),
  z.strictObject({ action: z.literal("REQUEST_REVISION"), paperId: positiveId, version: positiveId, note: note.min(1) }),
  z.strictObject({ action: z.literal("APPROVE"), paperId: positiveId, version: positiveId, note }),
]);

export type ModerationActor = {
  id: number; role: string; isActiveLec: boolean; isExamLec: boolean;
};
export type ModerationAssignment = {
  activeLecturerId: number | null; examLecturerId: number | null;
};

export function moderationRoles(actor: ModerationActor, module: ModerationAssignment) {
  return {
    setter: actor.role === "LECTURER" && actor.isActiveLec && module.activeLecturerId === actor.id,
    moderator: actor.role === "LECTURER" && actor.isExamLec && module.examLecturerId === actor.id
      && module.activeLecturerId !== actor.id,
  };
}

export function moderationTransition(action: Exclude<PaperModerationAction, "SUBMIT">, status: PaperModerationStatus): PaperModerationStatus | null {
  if (action === "RESUBMIT" && status === "REVISION_REQUIRED") return "UNDER_MODERATION";
  if (action === "REQUEST_REVISION" && status === "UNDER_MODERATION") return "REVISION_REQUIRED";
  if (action === "APPROVE" && status === "UNDER_MODERATION") return "APPROVED";
  return null;
}
