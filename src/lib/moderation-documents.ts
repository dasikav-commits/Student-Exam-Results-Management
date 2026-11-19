import { PDF } from "@libpdf/core";
import officeCrypto from "officecrypto-tool";
import JSZip from "jszip";
import sharp from "sharp";
import { fileSlots, MAX_UPLOAD_BYTES } from "./moderation-criteria";

export class ModerationInputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function boundedRequest(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new ModerationInputError("Request is too large.", 413);
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  const reader = request.body?.getReader();
  let count = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        count += value.byteLength;
        if (count > maxBytes) {
          void reader.cancel().catch(() => {});
          throw new ModerationInputError("Request is too large.", 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = Buffer.concat(chunks, count);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } });
}

export async function readModerationForm(request: Request) {
  try { return await (await boundedRequest(request, MAX_UPLOAD_BYTES)).formData(); }
  catch (error) {
    if (error instanceof ModerationInputError) throw error;
    throw new ModerationInputError("Invalid upload form.");
  }
}

export type PrivateFile = { slot: string; name: string; contentType: string; content: Uint8Array<ArrayBuffer>; protected: boolean };

function isUpload(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

export async function readBundle(form: FormData | null, required: boolean, password?: string): Promise<PrivateFile[]> {
  const selected = fileSlots.map(([slot]) => form?.get(slot) ?? null);
  if (!required && !selected.some(isUpload)) return [];
  if (!selected.every(isUpload)) throw new ModerationInputError("Upload all four files: the paper and marking scheme in both PDF and Word (.docx).");
  const files: PrivateFile[] = [];
  for (const [i, file] of selected.entries()) {
    const [slot, label, ext] = fileSlots[i];
    if (!file.name.toLowerCase().endsWith(ext)) throw new ModerationInputError(`${label} must be a ${ext} file.`);
    let content = new Uint8Array(await file.arrayBuffer());
    try {
      if (ext === ".pdf") {
        if (Buffer.from(content.subarray(0, 5)).toString() !== "%PDF-") throw new Error();
        const pdf = await PDF.load(content);
        if (pdf.isEncrypted || pdf.getPageCount() < 1) throw new Error();
        if (password) {
          pdf.setProtection({ userPassword: password, algorithm: "AES-256" });
          content = new Uint8Array(await pdf.save());
        }
      } else {
        const zip = await JSZip.loadAsync(content); // inspect the directory only; do not inflate arbitrary entries
        if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml") || Object.keys(zip.files).some(name => /vbaProject\.bin$/i.test(name))) throw new Error();
        if (password) content = new Uint8Array(officeCrypto.encrypt(Buffer.from(content), { password }));
      }
    } catch { throw new ModerationInputError(`${label} is unreadable, already locked, or not a supported document.`); }
    files.push({ slot, name: `${slot}${ext}`, content, protected: !!password,
      contentType: ext === ".pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }
  return files;
}

export async function readSignature(form: FormData | null, slot: "moderatorSignature" | "lecturerSignature"): Promise<PrivateFile> {
  const file = form?.get(slot) ?? null;
  if (!isUpload(file) || file.size > 512 * 1024 || !/\.(png|jpe?g)$/i.test(file.name)) {
    throw new ModerationInputError("Upload a PNG or JPEG signature no larger than 512 KiB.");
  }
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 4_000_000 });
    if (!["png", "jpeg"].includes((await image.metadata()).format ?? "")) throw new Error();
    const content = new Uint8Array(await image.resize({ width: 600, height: 220, fit: "inside", withoutEnlargement: true }).png().toBuffer());
    return { slot, name: `${slot}.png`, contentType: "image/png", content, protected: false };
  } catch { throw new ModerationInputError("The signature image could not be read."); }
}

export async function unlockFile(content: Uint8Array<ArrayBuffer>, contentType: string, password: string) {
  if (contentType !== "application/pdf") return new Uint8Array(await officeCrypto.decrypt(Buffer.from(content), { password }));
  const pdf = await PDF.load(content, { credentials: password });
  pdf.removeProtection({ ignorePermissions: true });
  return new Uint8Array(await pdf.save());
}

export function privateDownload(content: Uint8Array<ArrayBuffer>, name: string, contentType: string) {
  return new Response(content, { headers: {
    "Content-Type": contentType, "Content-Disposition": `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
  } });
}
