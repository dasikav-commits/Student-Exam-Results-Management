"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import type { PaperModerationAction, PaperModerationStatus } from "@prisma/client";

type Paper = {
  id: number; version: number; reference: string; academicYear: string; semester: number;
  status: PaperModerationStatus; canReview: boolean;
  events: { version: number; action: PaperModerationAction; note: string; createdAt: string }[];
};
type AssignedModule = {
  id: number; code: string; name: string; setter: boolean; moderator: boolean; hasModerator: boolean; papers: Paper[];
};

const statusLabels = { UNDER_MODERATION: "Under moderation", REVISION_REQUIRED: "Revision required", APPROVED: "Approved" };
const actionLabels = { SUBMIT: "Submitted", RESUBMIT: "Resubmitted", REQUEST_REVISION: "Revision requested", APPROVE: "Approved" };
const button = "rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50";
const secondary = "rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50";
const input = "mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";

export default function PaperModerationWorkspace() {
  const { user } = useAuth();
  const [modules, setModules] = useState<AssignedModule[] | null>(null);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/paper-moderation", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) {
        setModules(null);
        setNeedsLogin(response.status === 401);
        throw new Error(data.error ?? "Unable to load paper moderation.");
      }
      setModules(data);
      setNeedsLogin(false);
      setError("");
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : "Unable to load paper moderation.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    return () => controller.abort();
  }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>, moduleId: number, paper?: Paper) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form, (event.nativeEvent as SubmitEvent).submitter);
    const action = fields.get("action");
    const body = action === "SUBMIT"
      ? { action, moduleId, academicYear: fields.get("academicYear"), semester: Number(fields.get("semester")), reference: fields.get("reference") }
      : action === "RESUBMIT"
        ? { action, paperId: paper?.id, version: paper?.version, reference: fields.get("reference") }
        : { action, paperId: paper?.id, version: paper?.version, note: fields.get("note") };
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/paper-moderation", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) { setNeedsLogin(true); setModules(null); }
        throw new Error(data.error ?? "Unable to save the moderation update.");
      }
      form.reset();
      setSaved(true);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the moderation update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-cream-canvas px-4 py-8 text-neutral-900 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Exam preparation</p>
            <h1 className="mt-1 text-3xl font-black">Paper Moderation</h1>
            <p className="mt-2 text-sm text-neutral-600">Track review of papers shared through your approved document channel. This workspace does not upload files or change student marks.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-semibold text-indigo-700">
            {user?.capabilities.isActiveLec && <Link className="px-2 py-2 hover:underline" href="/dashboard/lecturer">Lecturer Desk</Link>}
            {user?.capabilities.isExamLec && <Link className="px-2 py-2 hover:underline" href="/dashboard/examiner">Examiner Hub</Link>}
            {user?.capabilities.isHOD && <Link className="px-2 py-2 hover:underline" href="/dashboard/hod">HOD Console</Link>}
            <button type="button" className={secondary} disabled={busy} onClick={() => void refresh()}>Refresh</button>
          </div>
        </header>

        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error} {needsLogin && <Link href="/login" className="font-bold underline">Sign in</Link>}
        </div>}
        {saved && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Moderation update saved.</p>}
        {!modules && !error && <p role="status" className="text-sm text-neutral-600">Loading assignments…</p>}
        {modules?.length === 0 && <p className="rounded-xl border border-neutral-200 bg-white p-6 text-sm">No modules are assigned to you for moderation.</p>}

        {modules?.map(module => (
          <section key={module.id} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 sm:p-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">{module.setter ? "Paper-setting lecturer" : "Paper moderator · Second Examiner"}</p>
              <h2 className="mt-1 text-lg font-bold">{module.code} — {module.name}</h2>
            </div>
            {module.setter && !module.hasModerator && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">An administrator must assign a different eligible Second Examiner before you can submit a paper.</p>}
            {module.setter && module.hasModerator && (
              <details className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
                <summary className="cursor-pointer text-sm font-bold text-indigo-800">Record a paper submission</summary>
                <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={ev => void submit(ev, module.id)}>
                  <label className="text-sm font-semibold">Academic year
                    <input className={input} name="academicYear" placeholder="2026/2027" maxLength={9} pattern="20[0-9]{2}/20[0-9]{2}" required />
                  </label>
                  <label className="text-sm font-semibold">Semester
                    <select className={input} name="semester"><option value="1">1</option><option value="2">2</option></select>
                  </label>
                  <label className="min-w-52 flex-1 text-sm font-semibold">Paper reference (not a link or password)
                    <input className={input} name="reference" maxLength={160} placeholder="e.g. Final paper v1" required />
                  </label>
                  <button className={button} name="action" value="SUBMIT" disabled={busy}>Submit for moderation</button>
                </form>
              </details>
            )}
            {module.papers.length === 0 && <p className="text-sm text-neutral-600">No recorded submissions yet.</p>}
            {module.papers.map(paper => (
              <article key={paper.id} className="space-y-3 rounded-lg border border-neutral-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold">{paper.academicYear} · Semester {paper.semester}</h3>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${paper.status === "APPROVED" ? "bg-emerald-100 text-emerald-900" : paper.status === "REVISION_REQUIRED" ? "bg-amber-100 text-amber-900" : "bg-indigo-100 text-indigo-900"}`}>{statusLabels[paper.status]}</span>
                </div>
                <p className="break-words text-sm"><strong>Current reference:</strong> {paper.reference}</p>
                <details open={paper.status === "REVISION_REQUIRED"}>
                  <summary className="cursor-pointer text-sm font-semibold text-indigo-700">Review history ({paper.events.length})</summary>
                  <ol className="mt-2 space-y-2 rounded-lg bg-neutral-50 p-3 text-sm">
                    {paper.events.map(event => <li key={event.version}>
                      <strong>{actionLabels[event.action]}</strong> · <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                      {event.note && <p className="whitespace-pre-wrap break-words text-neutral-700">{event.note}</p>}
                    </li>)}
                  </ol>
                </details>
                {paper.status === "UNDER_MODERATION" && paper.canReview && (
                  <form className="space-y-3" onSubmit={ev => void submit(ev, module.id, paper)}>
                    <label className="block text-sm font-semibold">Review notes (required when requesting a revision)
                      <textarea className={input} name="note" maxLength={2000} rows={3} placeholder="Summarize the feedback without copying confidential exam content." />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button className={secondary} name="action" value="REQUEST_REVISION" disabled={busy}>Request revision</button>
                      <button className={button} name="action" value="APPROVE" disabled={busy}>Approve paper</button>
                    </div>
                  </form>
                )}
                {paper.status === "UNDER_MODERATION" && module.moderator && !paper.canReview && <p className="text-sm text-amber-900">You cannot review a version you submitted. Ask the administrator to assign a different moderator.</p>}
                {paper.status === "REVISION_REQUIRED" && module.setter && module.hasModerator && (
                  <form className="flex flex-wrap items-end gap-3" onSubmit={ev => void submit(ev, module.id, paper)}>
                    <label className="min-w-52 flex-1 text-sm font-semibold">Revised paper reference
                      <input className={input} name="reference" maxLength={160} placeholder="e.g. Final paper v2" required />
                    </label>
                    <button className={button} name="action" value="RESUBMIT" disabled={busy}>Resubmit</button>
                  </form>
                )}
              </article>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
