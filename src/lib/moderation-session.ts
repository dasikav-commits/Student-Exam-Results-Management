import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { issueSession, readSessionId, SESSION_COOKIE, SESSION_SECONDS, verifySession } from "./moderation-session-token";

export function moderationEnabled() {
  return process.env.NEXT_PUBLIC_PAPER_MODERATION_ENABLED === "true";
}

function sessionSecret() {
  const key = process.env.PAPER_MODERATION_SESSION_SECRET;
  return key && key.length >= 32 ? key : null;
}

export function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function setSessionCookie(response: NextResponse, value: string, maxAge: number) {
  response.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge,
  });
}

export function startModerationSession(response: NextResponse, id: number, passwordHash: string | null) {
  const secret = sessionSecret();
  if (moderationEnabled() && secret && passwordHash) {
    setSessionCookie(response, issueSession(id, passwordHash, secret), SESSION_SECONDS);
  }
}

export function clearModerationSession(response: NextResponse) {
  setSessionCookie(response, "", 0);
}

export function isSameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  // Fetch Metadata is set by the browser and works behind a reverse proxy.
  // Clients without Fetch Metadata must not present a different Origin.
  return site ? site === "same-origin" : !origin || origin === new URL(request.url).origin;
}

export async function requireSession(request: Request) {
  const secret = sessionSecret();
  if (!secret) return apiError("Paper Moderation session configuration is missing.", 503);

  if (!["GET", "HEAD"].includes(request.method) && !isSameOrigin(request)) {
    return apiError("Cross-origin requests are not allowed.", 403);
  }

  const token = request.headers.get("cookie")?.split(";").map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const id = token ? readSessionId(token) : null;
  if (!token || !id) return apiError("Sign in again to continue.", 401);

  const user = await prisma.systemUser.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, isHod: true, isActiveLec: true, isExamLec: true, passwordHash: true },
  });
  if (!user?.passwordHash || !verifySession(token, user.passwordHash, secret)) {
    return apiError("Sign in again to continue.", 401);
  }
  const { id: userId, email, role, isHod, isActiveLec, isExamLec } = user;
  return { id: userId, email, role, isHod, isActiveLec, isExamLec };
}

// These legacy APIs control the accounts, permissions and assignments used by the pilot.
// Preserve their existing behavior when the pilot is switched off.
export async function protectModerationInputs(request: Request, scope: "admin" | "hod" | "profile", email?: unknown) {
  if (!moderationEnabled()) return null;
  const user = await requireSession(request);
  if (user instanceof Response) return user;
  const allowed = scope === "admin" ? user.role === "ADMIN"
    : scope === "hod" ? user.role === "LECTURER" && user.isHod
      : typeof email === "string" && email.toLowerCase().trim() === user.email;
  return allowed ? null : apiError("You do not have permission for this action.", 403);
}
