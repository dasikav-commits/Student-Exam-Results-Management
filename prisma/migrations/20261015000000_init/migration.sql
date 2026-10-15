-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "system_users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'LECTURER',
    "full_name" TEXT,
    "password_hash" TEXT,
    "is_hod" BOOLEAN NOT NULL DEFAULT false,
    "is_active_lec" BOOLEAN NOT NULL DEFAULT false,
    "is_exam_lec" BOOLEAN NOT NULL DEFAULT false,
    "recovery_email" TEXT,
    "reset_token" TEXT,
    "reset_token_expiry" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 3,
    "eligible_students" INTEGER NOT NULL DEFAULT 0,
    "deadline" TIMESTAMP(3),
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "active_lecturer_id" INTEGER,
    "exam_lecturer_id" INTEGER,
    "stats" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_marks" (
    "id" SERIAL NOT NULL,
    "module_code" TEXT NOT NULL,
    "student_index" TEXT NOT NULL,
    "ca_questions_marks" JSONB NOT NULL DEFAULT '{}',
    "final_exam_questions_marks" JSONB NOT NULL DEFAULT '{}',
    "second_exam_marks" JSONB NOT NULL DEFAULT '{}',
    "is_absent_ca" JSONB NOT NULL DEFAULT '{}',
    "is_absent_theory" BOOLEAN NOT NULL DEFAULT false,
    "is_absent_practical" BOOLEAN NOT NULL DEFAULT false,
    "is_absent_final" BOOLEAN NOT NULL DEFAULT false,
    "is_eligible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "student_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_users_email_key" ON "system_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "modules_code_key" ON "modules"("code");

-- CreateIndex
CREATE UNIQUE INDEX "student_marks_module_code_student_index_key" ON "student_marks"("module_code", "student_index");

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_active_lecturer_id_fkey" FOREIGN KEY ("active_lecturer_id") REFERENCES "system_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_exam_lecturer_id_fkey" FOREIGN KEY ("exam_lecturer_id") REFERENCES "system_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_marks" ADD CONSTRAINT "student_marks_module_code_fkey" FOREIGN KEY ("module_code") REFERENCES "modules"("code") ON DELETE CASCADE ON UPDATE CASCADE;