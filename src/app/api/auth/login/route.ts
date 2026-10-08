import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const dbUser = await prisma.systemUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!dbUser) {
      return NextResponse.json(
        { error: "Access Denied. No account found for this email." },
        { status: 401 }
      );
    }

    // Verify password (scrypt hash, or legacy plain text for unmigrated accounts)
    const passwordOk = await verifyPassword(password, dbUser.passwordHash);
    if (!passwordOk) {
      return NextResponse.json(
        { error: "Incorrect password. Please try again." },
        { status: 401 }
      );
    }

    const formattedUser = {
      id: String(dbUser.id),
      email: dbUser.email,
      fullName: dbUser.fullName ?? dbUser.email,
      role: dbUser.role,
      capabilities: {
        isHOD: dbUser.isHod,
        isActiveLec: dbUser.isActiveLec,
        isExamLec: dbUser.isExamLec,
      },
    };

    return NextResponse.json({ user: formattedUser });
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}