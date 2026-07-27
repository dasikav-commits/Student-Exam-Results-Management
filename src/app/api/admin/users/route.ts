import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET: All users for Admin control desk
export async function GET() {
  try {
    const users = await prisma.systemUser.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isHod: true,
        isActiveLec: true,
        isExamLec: true,
        createdAt: true,
      },
    });
    return NextResponse.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "Failed to load user records" }, { status: 500 });
  }
}

// POST: Create a new user account
export async function POST(request: Request) {
  try {
    const { email, fullName, role, password, isHod, isActiveLec, isExamLec } =
      await request.json();

    if (!email || !fullName || !role || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const existing = await prisma.systemUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const user = await prisma.systemUser.create({
      data: {
        email: email.toLowerCase().trim(),
        fullName: fullName.trim(),
        role: role.toUpperCase(),
        passwordHash: password,
        isHod: isHod ?? false,
        isActiveLec: isActiveLec ?? false,
        isExamLec: isExamLec ?? false,
      },
      select: { id: true, email: true, fullName: true, role: true },
    });

    return NextResponse.json({ success: true, user }, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: Remove a user
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("id");
    if (!userId) {
      return NextResponse.json({ error: "Missing user id" }, { status: 400 });
    }

    await prisma.systemUser.delete({ where: { id: parseInt(userId, 10) } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH: Update a single capability flag for a user (isHod | isActiveLec | isExamLec)
export async function PATCH(request: Request) {
  try {
    const { id, flag, value } = await request.json();

    const ALLOWED_FLAGS = ["isHod", "isActiveLec", "isExamLec"] as const;
    type AllowedFlag = (typeof ALLOWED_FLAGS)[number];

    if (!id || !flag || typeof value !== "boolean") {
      return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
    }

    if (!ALLOWED_FLAGS.includes(flag as AllowedFlag)) {
      return NextResponse.json({ error: "Invalid capability flag" }, { status: 400 });
    }

    const updated = await prisma.systemUser.update({
      where: { id: parseInt(id, 10) },
      data: { [flag]: value },
      select: { id: true, isHod: true, isActiveLec: true, isExamLec: true },
    });

    return NextResponse.json({ success: true, user: updated });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    console.error("Error updating capability flag:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}