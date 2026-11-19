CREATE TYPE "PaperModerationStatus" AS ENUM ('UNDER_MODERATION', 'REVISION_REQUIRED', 'APPROVED');
CREATE TYPE "PaperModerationAction" AS ENUM ('SUBMIT', 'REQUEST_REVISION', 'RESUBMIT', 'APPROVE');

CREATE TABLE "moderation_papers" (
    "id" SERIAL PRIMARY KEY,
    "module_id" INTEGER NOT NULL,
    "academic_year" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "PaperModerationStatus" NOT NULL DEFAULT 'UNDER_MODERATION',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submitted_by_id" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "moderation_papers_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "moderation_papers_module_id_academic_year_semester_key" ON "moderation_papers"("module_id", "academic_year", "semester");

CREATE TABLE "moderation_events" (
    "id" SERIAL PRIMARY KEY,
    "paper_id" INTEGER NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "action" "PaperModerationAction" NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "moderation_events_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "moderation_papers"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "moderation_events_paper_id_version_key" ON "moderation_events"("paper_id", "version");
