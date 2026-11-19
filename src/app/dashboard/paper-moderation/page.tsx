import { notFound } from "next/navigation";
import { moderationEnabled } from "@/lib/moderation-session";
import PaperModerationWorkspace from "./workspace";

export default function PaperModerationPage() {
  if (!moderationEnabled()) notFound();
  return <PaperModerationWorkspace />;
}
