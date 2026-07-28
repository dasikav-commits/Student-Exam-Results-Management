import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const user = await prisma.systemUser.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { fullName: true, recoveryEmail: true },
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
    const { email, fullName, recoveryEmail } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const updated = await prisma.systemUser.update({
      where: { email: email.toLowerCase().trim() },
      data: {
        ...(fullName && { fullName: fullName.trim() }),
        ...(recoveryEmail !== undefined && { recoveryEmail: recoveryEmail ? recoveryEmail.trim().toLowerCase() : null }),
      },
      select: { fullName: true, recoveryEmail: true },
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
