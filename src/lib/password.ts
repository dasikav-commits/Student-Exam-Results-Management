// src/lib/password.ts
//
// Password hashing with Node's built-in scrypt (no native dependency).
//
// Stored format: `scrypt$<saltHex>$<hashHex>`
//
// Legacy accounts still hold plain-text passwords (no `scrypt$` prefix).
// `verifyPassword` accepts those with a constant-time comparison so existing
// users are not locked out. Their passwords are upgraded to hashes the next
// time they change or reset them.

import { randomBytes, scrypt, timingSafeEqual } from "crypto";

const SCHEME = "scrypt";
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

function deriveKey(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function safeEqualBuffers(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await deriveKey(password, salt, KEY_LENGTH);
  return `${SCHEME}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: unknown,
  stored: string | null | undefined
): Promise<boolean> {
  if (typeof password !== "string" || !stored) return false;

  // Legacy plain-text value (pre-hashing accounts).
  if (!stored.startsWith(`${SCHEME}$`)) {
    return safeEqualBuffers(Buffer.from(password), Buffer.from(stored));
  }

  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  const derived = await deriveKey(password, Buffer.from(saltHex, "hex"), expected.length);
  return safeEqualBuffers(derived, expected);
}
