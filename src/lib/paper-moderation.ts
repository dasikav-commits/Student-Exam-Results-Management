import type { PaperModerationAction, PaperModerationStatus } from "@prisma/client";
import { z } from "zod";
import { criteria } from "./moderation-criteria";

export const positiveId = z.number().int().min(1).max(2147483647);
const reference = z.string().trim().min(1).max(160);
const note = z.string().trim().max(2000);
export const academicPeriod = z.object({
  semester: z.union([z.literal(1), z.literal(2)]),
  academicYear: z.string().trim().regex(/^20\d{2}\/20\d{2}$/).refine(year => Number(year.slice(5)) === Number(year.slice(0, 4)) + 1, "Use consecutive academic years, e.g. 2026/2027."),
}).strict();
const target = { paperId: positiveId, version: positiveId };
export const passwordSchema = z.string().min(12).max(80).regex(/^[!-~]+$/);
export const followUpSchema = z.array(z.string().trim().min(1).max(500)).min(1).max(10);
export const reviewSchema = z.object(Object.fromEntries(criteria.map(([key]) => [key, z.boolean()])) as Record<(typeof criteria)[number][0], z.ZodBoolean>).strict();

export const moderationCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("SUBMIT"), moduleId: positiveId, reference, ...academicPeriod.shape }),
  z.strictObject({ action: z.literal("CREATE_DRAFT"), moduleId: positiveId, reference, ...academicPeriod.shape }),
  z.strictObject({ action: z.literal("SAVE_DRAFT"), ...target, reference }),
  z.strictObject({ action: z.literal("SUBMIT_DRAFT"), ...target }),
  z.strictObject({ action: z.literal("RESUBMIT"), ...target, reference }),
  z.strictObject({ action: z.literal("REQUEST_REVISION"), ...target, note: note.min(1), remarks: reviewSchema.optional() }),
  z.strictObject({ action: z.literal("APPROVE"), ...target, note, remarks: reviewSchema.optional() }),
  z.strictObject({ action: z.literal("FINALIZE"), ...target, reference, password: passwordSchema, followUp: followUpSchema }),
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
  if (action === "SAVE_DRAFT" && status === "DRAFT") return "DRAFT";
  if (action === "FINALIZE" && (status === "REVISION_REQUIRED" || status === "APPROVED")) return "FINALIZED";
  if (action === "RESUBMIT" && status === "REVISION_REQUIRED") return "UNDER_MODERATION";
  if (action === "REQUEST_REVISION" && status === "UNDER_MODERATION") return "REVISION_REQUIRED";
  if (action === "APPROVE" && status === "UNDER_MODERATION") return "APPROVED";
  return null;
}
