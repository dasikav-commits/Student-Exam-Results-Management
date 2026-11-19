ALTER TYPE "PaperModerationStatus" ADD VALUE 'DRAFT';
ALTER TYPE "PaperModerationStatus" ADD VALUE 'FINALIZED';
ALTER TYPE "PaperModerationAction" ADD VALUE 'SAVE_DRAFT';
ALTER TYPE "PaperModerationAction" ADD VALUE 'FINALIZE';

ALTER TABLE "moderation_papers" ADD COLUMN "bundle_version" INTEGER,
  ADD COLUMN "handoff_at" TIMESTAMP(3), ADD COLUMN "file_password_hash" TEXT;
ALTER TABLE "moderation_events" ADD COLUMN "details" JSONB;

CREATE TABLE "moderation_files" (
  "id" SERIAL PRIMARY KEY,
  "paper_id" INTEGER NOT NULL REFERENCES "moderation_papers"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  "version" INTEGER NOT NULL,
  "slot" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "protected" BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX "moderation_files_paper_id_version_slot_key" ON "moderation_files"("paper_id", "version", "slot");

ALTER TABLE "system_users" ADD COLUMN "moderation_department" TEXT NOT NULL DEFAULT 'CIS', ADD COLUMN "moderation_contact" TEXT;
ALTER TABLE "modules" ADD COLUMN "moderation_department" TEXT NOT NULL DEFAULT 'CIS';

CREATE TABLE "moderation_settings" (
  "department" TEXT PRIMARY KEY,
  "academic_year" TEXT NOT NULL,
  "semester" INTEGER NOT NULL
);
CREATE TABLE "moderation_panel_decisions" (
  "user_id" INTEGER PRIMARY KEY REFERENCES "system_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "approved" BOOLEAN NOT NULL
);
CREATE TABLE "moderation_course_lecturers" (
  "module_id" INTEGER NOT NULL REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" INTEGER NOT NULL REFERENCES "system_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY ("module_id", "user_id")
);
CREATE INDEX "moderation_course_lecturers_user_id_idx" ON "moderation_course_lecturers"("user_id");
