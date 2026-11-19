import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/moderation-session";
import { canReadPaper, moderationActor, moderationModuleSelect, publishedBundles, type PaperActor } from "@/lib/moderation-access";
import { boundedRequest, ModerationInputError, privateDownload, unlockFile } from "@/lib/moderation-documents";
import { fileSlots } from "@/lib/moderation-criteria";
import { moderationRoles, passwordSchema, positiveId } from "@/lib/paper-moderation";
import { verifyPassword } from "@/lib/password";

async function authorizeFile(actor: PaperActor, id: number) {
  const file = await prisma.moderationFile.findUnique({ where: { id }, select: {
    slot: true, name: true, protected: true, version: true, contentType: true, paper: { select: {
      status: true, filePasswordHash: true, module: { select: moderationModuleSelect },
      events: { where: { action: { in: ["SUBMIT", "RESUBMIT"] } }, select: { action: true, version: true, details: true } },
    } },
  } });
  // Signature images are only available embedded in authorized report exports.
  if (!file || !fileSlots.some(([slot]) => slot === file.slot) || !canReadPaper(actor, file.paper.module, file.paper.status)) return null;
  const { setter, moderator } = moderationRoles(actor, file.paper.module);
  if (file.protected) return file.paper.status === "FINALIZED" && (setter || moderator || actor.isHod) ? file : null;
  const published = publishedBundles(file.paper.events).has(file.version);
  const courseLecturer = actor.approved && file.paper.module.moderationLecturers.some(row => row.userId === actor.id);
  return setter || (published && (moderator || courseLecturer)) ? file : null;
}

export async function GET(request: Request) {
  try {
    const actor = await moderationActor(request);
    if (actor instanceof Response) return actor;
    const parsed = positiveId.safeParse(Number(new URL(request.url).searchParams.get("id")));
    if (!parsed.success) return apiError("Document not found.", 404);
    const file = await authorizeFile(actor, parsed.data);
    if (!file) return apiError("Document not found.", 404);
    if (file.protected) return apiError("Enter the package password to download this final document.", 403);
    const row = await prisma.moderationFile.findUniqueOrThrow({ where: { id: parsed.data }, select: { content: true } });
    return privateDownload(row.content, file.name, file.contentType);
  } catch { return apiError("Unable to download this document.", 500); }
}

const downloadRequest = z.strictObject({ id: positiveId, password: passwordSchema, mode: z.enum(["protected", "unlocked"]) });

export async function POST(request: Request) {
  try {
    const actor = await moderationActor(request);
    if (actor instanceof Response) return actor;
    const body = downloadRequest.safeParse(await (await boundedRequest(request, 1024)).json().catch(() => null));
    if (!body.success) return apiError("Enter the package password.", 400);
    const { id, password, mode } = body.data;
    const file = await authorizeFile(actor, id);
    if (!file?.protected) return apiError("Document not found.", 404);
    if (!await verifyPassword(password, file.paper.filePasswordHash)) return apiError("Incorrect package password.", 403);
    const row = await prisma.moderationFile.findUniqueOrThrow({ where: { id }, select: { content: true } });
    const content = mode === "unlocked" ? await unlockFile(row.content, file.contentType, password) : row.content;
    return privateDownload(content, `${mode}-${file.name}`, file.contentType);
  } catch (error) {
    if (error instanceof ModerationInputError) return apiError(error.message, error.status);
    return apiError("Unable to download this document.", 500);
  }
}
