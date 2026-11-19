import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { jsPDF } from "jspdf";
import { moderationActor } from "@/lib/moderation-access";
import { apiError } from "@/lib/moderation-session";
import { privateDownload } from "@/lib/moderation-documents";
import { fileSlots } from "@/lib/moderation-criteria";

export async function GET(request: Request) {
  try {
    const actor = await moderationActor(request);
    if (actor instanceof Response) return actor;
    const slot = fileSlots.find(([key]) => key === new URL(request.url).searchParams.get("slot"));
    if (!slot) return apiError("Sample not found.", 404);
    const [name, label, ext] = slot;
    const lines = [`Sample ${label.replace(/ \(.+\)$/, "")}`, "Fictional example for local testing only", "Module: DEMO001 | Semester: 1", "", name.startsWith("scheme")
      ? "Q1. Award 5 marks for defining the example concept and 5 for applying it."
      : "Q1. Define the example concept and explain how you would apply it. (10 marks)"];
    if (ext === ".pdf") {
      const doc = new jsPDF(); doc.setFontSize(12); doc.text(lines, 20, 25);
      return privateDownload(new Uint8Array(doc.output("arraybuffer")), `sample-${name}${ext}`, "application/pdf");
    }
    const doc = new Document({ sections: [{ children: lines.map((text, i) => new Paragraph({ text, heading: i === 0 ? HeadingLevel.TITLE : undefined })) }] });
    return privateDownload(new Uint8Array(await Packer.toBuffer(doc)), `sample-${name}${ext}`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  } catch { return apiError("Unable to create a sample file.", 500); }
}
