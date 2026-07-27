import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";
import path from "path";

// Explicitly load .env so Prisma CLI can resolve environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export default defineConfig({
  schema: "./prisma/schema.prisma",
  // Use the direct (non-pooled) URL for Prisma CLI operations
  datasource: {
    url: process.env.DIRECT_URL!,
  },
});
