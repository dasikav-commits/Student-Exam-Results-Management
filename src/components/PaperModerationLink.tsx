import Link from "next/link";

export function PaperModerationLink() {
  if (process.env.NEXT_PUBLIC_PAPER_MODERATION_ENABLED !== "true") return null;
  return <Link href="/dashboard/paper-moderation" className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
    Paper Moderation
  </Link>;
}
