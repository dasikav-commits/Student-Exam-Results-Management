import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/moderation-session";
import { canReadPaper, moderationActor, moderationModuleSelect } from "@/lib/moderation-access";
import { privateDownload } from "@/lib/moderation-documents";
import { createModerationReport } from "@/lib/moderation-report";
import { followUpSchema, positiveId, reviewSchema } from "@/lib/paper-moderation";

function signer(details: Prisma.JsonValue | null | undefined) {
  return details && typeof details === "object" && !Array.isArray(details) && typeof details.signedBy === "string" ? ` — ${details.signedBy}` : "";
}

export async function GET(request: Request) {
  try {
    const actor = await moderationActor(request);
    if (actor instanceof Response) return actor;
    const query = new URL(request.url).searchParams;
    const id = positiveId.safeParse(Number(query.get("paperId")));
    const version = positiveId.safeParse(Number(query.get("version")));
    const format = query.get("format");
    if (!id.success || !version.success || (format !== "pdf" && format !== "docx")) return apiError("Invalid report request.", 400);
    const paper = await prisma.moderationPaper.findUnique({ where: { id: id.data }, select: {
      status: true, version: true, academicYear: true, semester: true, module: { select: moderationModuleSelect },
      events: { where: { version: { lte: version.data } }, orderBy: { version: "desc" }, select: { action: true, version: true, createdAt: true, note: true, details: true } },
    } });
    if (!paper || !canReadPaper(actor, paper.module, paper.status)) return apiError("Moderation report not found.", 404);
    const review = paper.events.find(event => event.version === version.data && ["REQUEST_REVISION", "APPROVE"].includes(event.action));
    const details = review?.details;
    const remarks = reviewSchema.safeParse(details && typeof details === "object" && !Array.isArray(details) ? details.remarks : null);
    if (!review || !remarks.success) return apiError("No signed checklist exists for this review.", 404);
    const submission = paper.events.find(event => event.action === "SUBMIT" || event.action === "RESUBMIT");
    // A final package belongs to the review immediately preceding its handoff.
    const finalization = paper.status === "FINALIZED" && review.version === paper.version - 1
      ? await prisma.moderationEvent.findUnique({ where: { paperId_version: { paperId: id.data, version: paper.version } }, select: { details: true } }) : null;
    const finalDetails = finalization?.details;
    const followUp = followUpSchema.safeParse(finalDetails && typeof finalDetails === "object" && !Array.isArray(finalDetails) ? finalDetails.followUp : null);
    const images = await prisma.moderationFile.findMany({ where: { paperId: id.data, OR: [
      { version: review.version, slot: "moderatorSignature" },
      ...(finalization ? [{ version: paper.version, slot: "lecturerSignature" }] : []),
    ] }, orderBy: { version: "asc" }, select: { slot: true, content: true } });
    const data = await createModerationReport(format, {
      title: "Examination Paper Moderation Report", subtitle: `${paper.module.code} — ${paper.module.name} · ${paper.academicYear} · Semester ${paper.semester}`,
      reference: submission?.note ?? "Submitted paper",
      outcome: review.action === "APPROVE" ? "Approved" : "Revision requested", date: review.createdAt.toISOString().slice(0, 10),
      remarks: remarks.data, note: review.note, followUp: followUp.success ? followUp.data : undefined,
      signatures: images.map(image => ({ label: image.slot === "moderatorSignature" ? `Moderator signature${signer(details)}` : `First Examiner signature${signer(finalDetails)}`, content: image.content })),
    });
    return privateDownload(data, `${paper.module.code}-moderation-v${review.version}.${format}`, format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  } catch { return apiError("Unable to generate the moderation report.", 500); }
}
