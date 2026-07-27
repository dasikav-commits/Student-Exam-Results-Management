import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // ── Seed Users ─────────────────────────────────────────────────────────────
  const deepani = await prisma.systemUser.upsert({
    where: { email: "deepani.w@wyb.ac.lk" },
    update: { passwordHash: "password123" },
    create: {
      id: 8,
      email: "deepani.w@wyb.ac.lk",
      role: "LECTURER",
      fullName: "Dr. Deepani Wijesekara",
      passwordHash: "password123",
      isHod: false,
      isActiveLec: true,
      isExamLec: true,
    },
  });

  const asanka = await prisma.systemUser.upsert({
    where: { email: "asanka.s@wyb.ac.lk" },
    update: { passwordHash: "password123" },
    create: {
      id: 11,
      email: "asanka.s@wyb.ac.lk",
      role: "LECTURER",
      fullName: "Prof. Asanka Sanjeewa",
      passwordHash: "password123",
      isHod: true,
      isActiveLec: true,
      isExamLec: true,
    },
  });

  await prisma.systemUser.upsert({
    where: { email: "admin@wyb.ac.lk" },
    update: { passwordHash: "admin123" },
    create: {
      email: "admin@wyb.ac.lk",
      role: "ADMIN",
      fullName: "System Administrator",
      passwordHash: "admin123",
    },
  });

  // ── Seed Modules ──────────────────────────────────────────────────────────
  await prisma.module.upsert({
    where: { code: "CMIS 4222" },
    update: {},
    create: {
      code: "CMIS 4222",
      name: "Information Systems Security",
      credits: 3,
      activeLecturerId: deepani.id,
      examLecturerId: asanka.id,
      isFrozen: false,
      stats: {},
    },
  });

  await prisma.module.upsert({
    where: { code: "CMIS 4121" },
    update: {},
    create: {
      code: "CMIS 4121",
      name: "Artificial Intelligence & Machine Learning",
      credits: 3,
      activeLecturerId: asanka.id,
      examLecturerId: deepani.id,
      isFrozen: false,
      stats: {},
    },
  });

  await prisma.module.upsert({
    where: { code: "CMIS 3214" },
    update: {},
    create: {
      code: "CMIS 3214",
      name: "Advanced Database Systems",
      credits: 3,
      activeLecturerId: asanka.id,
      examLecturerId: deepani.id,
      isFrozen: false,
      stats: {},
    },
  });

  console.log("✅ Seed complete — 3 users + 3 modules upserted.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
