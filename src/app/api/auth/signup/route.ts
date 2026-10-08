import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { signupRequestSchema } from "@/types/auth";

export const dynamic = "force-dynamic";

const DUPLICATE_MESSAGE = "An account with this email already exists. Try signing in instead.";

// POST: Self-service lecturer signup.
// New accounts get no elevated capability. An administrator must grant
// HOD, active-lecturer, or examiner access in the admin desk.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = signupRequestSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid signup details";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const fullName = parsed.data.fullName.trim();

    const existing = await prisma.systemUser.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
    }

    const passwordHash = await hashPassword(parsed.data.password);

    try {
      const user = await prisma.systemUser.create({
        data: {
          email,
          fullName,
          role: "LECTURER",
          passwordHash,
          isHod: false,
          isActiveLec: false,
          isExamLec: false,
        },
        select: { id: true, email: true, fullName: true, role: true },
      });

      return NextResponse.json({ success: true, user }, { status: 201 });
    } catch (error) {
      // Unique-constraint race: another request created the same email
      // between the findUnique check and the create.
      if ((error as { code?: string })?.code === "P2002") {
        return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
