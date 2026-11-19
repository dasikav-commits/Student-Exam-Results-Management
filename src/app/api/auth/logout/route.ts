import { NextResponse } from "next/server";
import { apiError, clearModerationSession, isSameOrigin } from "@/lib/moderation-session";

export function POST(request: Request) {
  if (!isSameOrigin(request)) return apiError("Cross-origin requests are not allowed.", 403);
  const response = new NextResponse(null, { status: 204 });
  clearModerationSession(response);
  return response;
}
