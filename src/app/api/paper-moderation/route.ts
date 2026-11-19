import { Prisma, type PaperModerationAction, type PaperModerationStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/moderation-session";
import { availableModerator, canReadPaper, moderationActor, moderationModuleSelect, publishedBundles, refreshPaperActor, type PaperActor } from "@/lib/moderation-access";
import { moderationCommand, moderationRoles, moderationTransition } from "@/lib/paper-moderation";
import { boundedRequest, ModerationInputError, readBundle, readModerationForm, readSignature, type PrivateFile } from "@/lib/moderation-documents";
import { fileSlots } from "@/lib/moderation-criteria";
import { hashPassword } from "@/lib/password";

const headers = { "Cache-Control": "private, no-store" };
const paperSelect = {
  id: true, moduleId: true, academicYear: true, semester: true, reference: true, status: true, version: true,
  submittedById: true, updatedAt: true, bundleVersion: true, handoffAt: true,
  events: { orderBy: { version: "asc" }, select: { version: true, action: true, note: true, createdAt: true, details: true } },
  files: { select: { id: true, slot: true, version: true, protected: true }, orderBy: { id: "asc" } },
} as const satisfies Prisma.ModerationPaperSelect;

type Command = ReturnType<typeof moderationCommand.parse>;

export async function GET(request: Request) {
  try {
    const actor = await moderationActor(request);
    if (actor instanceof Response) return actor;
    const inbox = new URL(request.url).searchParams.get("scope") === "hod";
    if (inbox && !actor.isHod) return apiError("Only the HOD can open the handoff inbox.", 403);
    if (!inbox && !actor.isActiveLec && !actor.isExamLec && !actor.approved) return apiError("No moderation capability is assigned.", 403);
    const scope: Prisma.ModuleWhereInput = inbox ? { moderationPapers: { some: { status: "FINALIZED" } } } : { OR: [
      ...(actor.isActiveLec ? [{ activeLecturerId: actor.id }] : []),
      ...(actor.isExamLec ? [{ examLecturerId: actor.id, OR: [{ activeLecturerId: null }, { activeLecturerId: { not: actor.id } }] }] : []),
      ...(actor.approved ? [{ moderationLecturers: { some: { userId: actor.id } } }] : []),
    ] };
    const modules = await prisma.module.findMany({
      where: { moderationDepartment: actor.moderationDepartment, ...scope }, orderBy: { code: "asc" }, select: {
        ...moderationModuleSelect,
        examLecturer: { select: { role: true, isExamLec: true, moderationDepartment: true, moderationDecision: { select: { approved: true } } } },
        moderationPapers: { where: inbox ? { status: "FINALIZED" } : {
          OR: [{ status: { not: "DRAFT" } }, ...(actor.isActiveLec ? [{ module: { activeLecturerId: actor.id } }] : [])],
        }, orderBy: [{ academicYear: "desc" }, { semester: "desc" }], select: paperSelect },
      },
    });
    return NextResponse.json(modules.map(module => {
      const { setter, moderator } = inbox ? { setter: false, moderator: false } : moderationRoles(actor, module);
      return {
        id: module.id, code: module.code, name: module.name, setter, moderator,
        hasModerator: module.examLecturerId !== module.activeLecturerId
          && module.examLecturer?.role === "LECTURER" && module.examLecturer.isExamLec
          && module.examLecturer.moderationDepartment === module.moderationDepartment
          && module.examLecturer.moderationDecision?.approved !== false,
        papers: module.moderationPapers.map(({ submittedById, ...paper }) => {
          const published = publishedBundles(paper.events);
          const visible = setter && !inbox;
          return { ...paper,
            events: paper.events.filter(event => visible || event.action !== "SAVE_DRAFT"),
            files: paper.files.filter(file => fileSlots.some(([slot]) => slot === file.slot)
              && (file.protected ? inbox || setter || moderator || actor.isHod : !inbox && (visible || published.has(file.version)))),
            canReview: moderator && submittedById !== actor.id,
          };
        }),
      };
    }), { headers });
  } catch (error) {
    console.error("Unable to load paper moderation:", error);
    return apiError("Unable to load paper moderation.", 500);
  }
}

async function moderatorReady(tx: Prisma.TransactionClient, module: { examLecturerId: number | null; moderationDepartment: string }, setter: number) {
  return module.examLecturerId !== null && module.examLecturerId !== setter && !!await tx.systemUser.findFirst({
    where: { ...availableModerator, id: module.examLecturerId, moderationDepartment: module.moderationDepartment }, select: { id: true },
  });
}

// Authorize once before file processing and again inside the committing transaction.
async function loadTarget(tx: Prisma.TransactionClient, actor: PaperActor, cmd: Command) {
  if (!("paperId" in cmd)) {
    const mod = await tx.module.findUnique({ where: { id: cmd.moduleId }, select: moderationModuleSelect });
    if (!mod || mod.moderationDepartment !== actor.moderationDepartment || !moderationRoles(actor, mod).setter) return apiError("Assigned module not found.", 404);
    if (cmd.action === "SUBMIT" && !await moderatorReady(tx, mod, actor.id)) return apiError("Assign a different eligible Second Examiner before submitting.", 409);
    return { moduleId: mod.id } as const;
  }
  const paper = await tx.moderationPaper.findUnique({ where: { id: cmd.paperId }, select: {
    id: true, version: true, status: true, submittedById: true, bundleVersion: true, reference: true,
    module: { select: moderationModuleSelect },
  } });
  if (!paper || !canReadPaper(actor, paper.module, paper.status)) return apiError("Assigned paper not found.", 404);
  const { setter, moderator } = moderationRoles(actor, paper.module);
  const isReview = cmd.action === "REQUEST_REVISION" || cmd.action === "APPROVE";
  if (isReview ? !moderator || paper.submittedById === actor.id : !setter) {
    return apiError("Only the assigned setter or independent moderator may perform their own actions.", 403);
  }
  const status = cmd.action === "SUBMIT_DRAFT" ? paper.status === "DRAFT" ? "UNDER_MODERATION" : null
    // Existing reference-only records can enter the document workflow by starting a fresh review.
    : cmd.action === "RESUBMIT" && paper.bundleVersion === null && ["APPROVED", "UNDER_MODERATION"].includes(paper.status) ? "UNDER_MODERATION"
    : moderationTransition(cmd.action, paper.status);
  if (!status || paper.version !== cmd.version) return apiError("This paper changed or is no longer awaiting that action. Refresh the workspace.", 409);
  if ((cmd.action === "SUBMIT_DRAFT" || cmd.action === "RESUBMIT") && !await moderatorReady(tx, paper.module, actor.id)) {
    return apiError("Assign a different eligible Second Examiner before submitting.", 409);
  }
  if (cmd.action === "SUBMIT_DRAFT" && !paper.bundleVersion) return apiError("Save the four draft files before submitting.", 409);
  if (cmd.action === "FINALIZE") {
    const review = await tx.moderationEvent.findFirst({ where: { paperId: paper.id, version: paper.version, action: { in: ["REQUEST_REVISION", "APPROVE"] } }, select: { details: true } });
    if (!paper.bundleVersion || !review?.details) return apiError("A document-backed signed moderation report is required before sending to the HOD.", 409);
  }
  return { paper, status } as const;
}

export async function POST(request: Request) {
  try {
    const actor = await moderationActor(request);
    if (actor instanceof Response) return actor;
    const form = request.headers.get("content-type")?.startsWith("multipart/form-data") ? await readModerationForm(request) : null;
    const raw = form ? JSON.parse(String(form.get("command") ?? "null")) : await (await boundedRequest(request, 24 * 1024)).json().catch(() => null);
    const parsed = moderationCommand.safeParse(raw);
    if (!parsed.success) return apiError("Check the academic period, reference, checklist, notes, or password. A package password must be 12–80 printable characters without spaces.", 400);
    const cmd = parsed.data;
    const target = await loadTarget(prisma, actor, cmd);
    if (target instanceof Response) return target;

    let files: PrivateFile[] = [];
    let details: Prisma.InputJsonObject | undefined;
    let filePasswordHash: string | undefined;
    if (cmd.action === "SUBMIT" || cmd.action === "CREATE_DRAFT" || cmd.action === "SAVE_DRAFT" || cmd.action === "RESUBMIT") {
      files = await readBundle(form, (cmd.action === "RESUBMIT" || cmd.action === "SUBMIT") && !!form);
      if (cmd.action === "RESUBMIT" && "paper" in target && target.paper?.bundleVersion && !files.length) return apiError("Upload the revised set of four files.", 400);
    } else if (cmd.action === "REQUEST_REVISION" || cmd.action === "APPROVE") {
      if ("paper" in target && target.paper?.bundleVersion && !cmd.remarks) return apiError("Complete all ten checklist criteria and attach your signature.", 400);
      if (cmd.remarks) {
        files = [await readSignature(form, "moderatorSignature")];
        details = { remarks: cmd.remarks, signedBy: actor.fullName || actor.email };
      }
    } else if (cmd.action === "FINALIZE") {
      const signature = await readSignature(form, "lecturerSignature");
      files = [...await readBundle(form, true, cmd.password), signature];
      filePasswordHash = await hashPassword(cmd.password);
      details = { followUp: cmd.followUp, signedBy: actor.fullName || actor.email };
    }

    return await prisma.$transaction(async tx => {
      const currentActor = await refreshPaperActor(tx, actor);
      if (!currentActor) return apiError("Your moderation access changed. Sign in again.", 403);
      const fresh = await loadTarget(tx, currentActor, cmd);
      if (fresh instanceof Response) return fresh;
      if ("moduleId" in fresh && "moduleId" in cmd) {
        const draft = cmd.action === "CREATE_DRAFT";
        await tx.moderationPaper.create({ data: {
          moduleId: fresh.moduleId!, academicYear: cmd.academicYear, semester: cmd.semester,
          reference: cmd.reference, submittedById: actor.id, status: draft ? "DRAFT" : "UNDER_MODERATION",
          bundleVersion: files.length ? 1 : null,
          events: { create: { actorId: actor.id, version: 1, action: draft ? "SAVE_DRAFT" : "SUBMIT", note: cmd.reference } },
          files: { create: files.map(file => ({ ...file, version: 1 })) },
        }, select: { id: true } });
        return NextResponse.json({ success: true }, { status: 201, headers });
      }
      if (!("paper" in fresh) || !fresh.paper || !("paperId" in cmd)) return apiError("Assigned paper not found.", 404);
      const version = cmd.version + 1;
      const status: PaperModerationStatus = fresh.status;
      const action: PaperModerationAction = cmd.action === "SUBMIT_DRAFT" ? "SUBMIT" : cmd.action;
      const markAuthor = cmd.action === "RESUBMIT" || (cmd.action === "SAVE_DRAFT" && files.length > 0);
      const hasBundle = files.some(file => file.slot === "paperPdf");
      const result = await tx.moderationPaper.updateMany({
        where: { id: fresh.paper.id, version: cmd.version }, data: {
          status, version, ...("reference" in cmd ? { reference: cmd.reference } : {}),
          ...(markAuthor ? { submittedById: actor.id } : {}), ...(hasBundle ? { bundleVersion: version } : {}),
          ...(status === "FINALIZED" ? { handoffAt: new Date(), filePasswordHash } : {}),
        },
      });
      if (!result.count) return apiError("This paper changed. Refresh the workspace.", 409);
      await tx.moderationEvent.create({ data: { paperId: cmd.paperId, version, actorId: actor.id, action,
        note: "note" in cmd ? cmd.note : "reference" in cmd ? cmd.reference : fresh.paper.reference,
        details: cmd.action === "SUBMIT_DRAFT" ? { bundleVersion: fresh.paper.bundleVersion } : details } });
      if (files.length) await tx.moderationFile.createMany({ data: files.map(file => ({ ...file, paperId: cmd.paperId, version })) });
      return NextResponse.json({ success: true }, { headers });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof ModerationInputError) return apiError(error.message, error.status);
    if (error instanceof SyntaxError) return apiError("Malformed moderation request.", 400);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return apiError("A submission already exists for this module and academic period. Refresh the workspace.", 409);
      if (error.code === "P2034" || error.code === "P2003") return apiError("The paper or module changed. Refresh the workspace and try again.", 409);
    }
    console.error("Unable to update paper moderation:", error instanceof Error ? error.name : "unknown");
    return apiError("Unable to update paper moderation.", 500);
  }
}
