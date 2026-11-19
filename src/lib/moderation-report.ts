import { jsPDF } from "jspdf";
import { Document, HeadingLevel, ImageRun, Packer, Paragraph } from "docx";
import sharp from "sharp";
import { criteria } from "./moderation-criteria";

type ReportData = {
  title: string; subtitle: string; reference: string; outcome: string; date: string;
  remarks: Record<string, boolean>; note: string; followUp?: string[];
  signatures: { label: string; content: Uint8Array }[];
};

export async function createModerationReport(format: "pdf" | "docx", data: ReportData) {
  const lines = [data.subtitle, `Reviewed submission: ${data.reference}`, `Review date: ${data.date}`, `Decision: ${data.outcome}`, "",
    ...criteria.map(([key, label], index) => `${index + 1}. ${label} ${data.remarks[key] ? "Yes" : "No"}`), "",
    `Moderator comments: ${data.note || "None"}`, "Follow-up actions:", ...(data.followUp?.map((line, i) => `${i + 1}. ${line}`) ?? ["Not yet submitted"])];
  const signatures = await Promise.all(data.signatures.map(async signature => {
    const { width, height } = await sharp(signature.content).metadata();
    const ratio = Math.min(150 / width, 50 / height, 1);
    return { ...signature, width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
  }));
  if (format === "docx") {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ text: data.title, heading: HeadingLevel.TITLE }),
      ...lines.flatMap(line => line.split("\n").map(text => new Paragraph(text))),
      ...signatures.flatMap(signature => [new Paragraph(signature.label), new Paragraph({ children: [new ImageRun({
        type: "png", data: signature.content, transformation: { width: signature.width, height: signature.height },
      })] })]),
    ] }] });
    return new Uint8Array(await Packer.toBuffer(doc));
  }
  const doc = new jsPDF();
  let y = 22;
  const ensureSpace = (height: number) => { if (y + height > 276) { doc.addPage(); y = 20; } };
  doc.setFontSize(18);
  doc.text(data.title, 18, y); y += 12;
  doc.setFontSize(11);
  for (const line of lines) {
    const wrapped: string[] = doc.splitTextToSize(line, 174);
    for (const text of wrapped.length ? wrapped : [""]) { ensureSpace(6); doc.text(text, 18, y); y += 6; }
  }
  for (const signature of signatures) {
    ensureSpace(28);
    doc.text(signature.label, 18, y); y += 3;
    doc.addImage(signature.content, "PNG", 18, y, signature.width / 2.6, signature.height / 2.6);
    y += signature.height / 2.6 + 5;
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
