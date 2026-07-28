import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const user = await prisma.systemUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // We return success even if user not found or no recovery email,
    // to prevent email enumeration (security best practice).
    if (!user || !user.recoveryEmail) {
      return NextResponse.json({ success: true });
    }

    // Generate random 64-hex-char token
    const token = crypto.randomBytes(32).toString("hex");
    
    // Expires in 1 hour
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1);

    await prisma.systemUser.update({
      where: { id: user.id },
      data: {
        resetToken: token,
        resetTokenExpiry: expiry,
      },
    });

    // Send email using Resend
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/reset-password?token=${token}`;

    const { error } = await resend.emails.send({
      from: "Wayamba Exams <onboarding@resend.dev>", // Change to verified domain later
      to: [user.recoveryEmail],
      subject: "Password Reset - Wayamba University Examination Administration System",
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #1a1a1a;">Reset your password</h2>
          <p>Hello ${user.fullName},</p>
          <p>We received a request to reset the password for your Wayamba University account (<strong>${user.email}</strong>).</p>
          <p>Click the button below to set a new password. This link will expire in 1 hour.</p>
          <div style="margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
          </div>
          <p>If you did not request this, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="font-size: 12px; color: #777;">Wayamba University of Sri Lanka</p>
        </div>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
