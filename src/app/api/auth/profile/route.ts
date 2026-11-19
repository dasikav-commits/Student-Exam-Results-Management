import { moderationEnabled, protectModerationInputs } from "@/lib/moderation-session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    const denied = await protectModerationInputs(request, "profile", email);
    if (denied) return denied;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const user = await prisma.systemUser.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { fullName: true, recoveryEmail: true, ...(moderationEnabled() ? { moderationContact: true, moderationDepartment: true } : {}) },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("Profile GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { email, fullName, recoveryEmail, moderationContact } = await request.json();

    const denied = await protectModerationInputs(request, "profile", email);
    if (denied) return denied;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (moderationEnabled() && moderationContact !== undefined && (typeof moderationContact !== "string" || !/^(?:[0-9]{10})?$/.test(moderationContact))) {
      return NextResponse.json({ error: "Enter a ten-digit contact number or leave it blank." }, { status: 400 });
    }
    const updated = await prisma.systemUser.update({
      where: { email: email.toLowerCase().trim() },
      data: {
        ...(moderationEnabled() && moderationContact !== undefined ? { moderationContact: moderationContact || null } : {}),
        ...(fullName && { fullName: fullName.trim() }),
        ...(recoveryEmail !== undefined && { recoveryEmail: recoveryEmail ? recoveryEmail.trim().toLowerCase() : null }),
      },
      select: { fullName: true, recoveryEmail: true, ...(moderationEnabled() ? { moderationContact: true, moderationDepartment: true } : {}) },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("Profile PATCH error:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
