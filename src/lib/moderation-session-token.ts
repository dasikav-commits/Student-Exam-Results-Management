import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "weg_moderation_session";
export const SESSION_SECONDS = 8 * 60 * 60;

function sign(payload: string, passwordHash: string, secret: string) {
  // The password hash is never sent to the browser. A password change invalidates old sessions.
  return createHmac("sha256", secret).update(JSON.stringify([payload, passwordHash])).digest("base64url");
}

export function issueSession(id: number, passwordHash: string, secret: string, now = Date.now()) {
  const payload = `${id}.${now + SESSION_SECONDS * 1000}`;
  return `${payload}.${sign(payload, passwordHash, secret)}`;
}

export function readSessionId(token: string, now = Date.now()) {
  if (!/^\d{1,10}\.\d{1,15}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [id, expiry] = token.split(".").map(Number);
  return id > 0 && id <= 2147483647 && expiry > now ? id : null;
}

export function verifySession(token: string, passwordHash: string, secret: string, now = Date.now()) {
  if (!readSessionId(token, now)) return false;
  const lastDot = token.lastIndexOf(".");
  return timingSafeEqual(Buffer.from(token.slice(lastDot + 1)), Buffer.from(sign(token.slice(0, lastDot), passwordHash, secret)));
}
