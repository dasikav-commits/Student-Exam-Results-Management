"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import type { PaperModerationAction, PaperModerationStatus } from "@prisma/client";
import { criteria, fileSlots, MAX_UPLOAD_BYTES } from "@/lib/moderation-criteria";
import { ModerationSettingsPanel, type SettingsData } from "./settings-panel";

export type Paper = {
  id: number; version: number; reference: string; academicYear: string; semester: number;
  status: PaperModerationStatus; canReview: boolean; bundleVersion: number | null; handoffAt: string | null;
  events: { version: number; action: PaperModerationAction; note: string; createdAt: string; details: {
    remarks?: Record<string, boolean>; followUp?: string[];
  } | null }[];
  files: { id: number; slot: string; version: number; protected: boolean }[];
};
type AssignedModule = {
  id: number; code: string; name: string; setter: boolean; moderator: boolean; hasModerator: boolean; papers: Paper[];
};

const statusLabels: Record<PaperModerationStatus, string> = {
  DRAFT: "Draft", UNDER_MODERATION: "Under moderation", REVISION_REQUIRED: "Revision required", APPROVED: "Approved", FINALIZED: "Sent to HOD",
};
const actionLabels: Record<PaperModerationAction, string> = {
  SAVE_DRAFT: "Draft saved", SUBMIT: "Submitted", RESUBMIT: "Resubmitted", REQUEST_REVISION: "Revision requested", APPROVE: "Approved", FINALIZE: "Sent to HOD",
};
const primary = "rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50";
const secondary = "rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50";
const input = "mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";
const link = "font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900";
const section = "space-y-4 rounded-xl border border-neutral-200 bg-white p-5 sm:p-6";
const actionPanel = "space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4";
const endpoint = "/api/paper-moderation";

function PeriodFields({ defaults }: { defaults?: SettingsData["period"] }) {
  return <div className="flex flex-wrap items-end gap-3">
    <label className="text-sm font-semibold">Academic year
      <input className={input} name="academicYear" defaultValue={defaults?.academicYear} placeholder="2026/2027" maxLength={9} pattern="20[0-9]{2}/20[0-9]{2}" required />
    </label>
    <label className="text-sm font-semibold">Semester
      <select className={input} name="semester" defaultValue={defaults?.semester ?? 1}><option value="1">1</option><option value="2">2</option></select>
    </label>
  </div>;
}

function BundleFields({ required }: { required?: boolean }) {
  return <div className="space-y-2">
    <div className="grid gap-3 sm:grid-cols-2">{fileSlots.map(([slot, label, ext]) => <label key={slot} className="min-w-0 text-sm font-semibold">{label}
      <input className={input} name={slot} type="file" accept={ext} required={required} />
    </label>)}</div>
    <p className="text-xs text-neutral-600">Use ordinary, unlocked PDFs and .docx files. All files in one upload must total under 4 MiB.</p>
  </div>;
}

function SampleLinks() {
  return <details className="text-sm"><summary className="cursor-pointer font-semibold text-indigo-700">Download fictional sample files for testing</summary>
    <ul className="mt-2 flex flex-wrap gap-3">{fileSlots.map(([slot, label]) => <li key={slot}><a className={link} href={`${endpoint}/samples?slot=${slot}`}>{label}</a></li>)}</ul>
  </details>;
}

function PaperDocuments({ files, busy, download }: { files: Paper["files"]; busy: boolean; download: (form: HTMLFormElement) => Promise<void> }) {
  if (!files.length) return null;
  if (!files[0].protected) return <ul className="flex flex-wrap gap-3 text-sm">{files.map(file => <li key={file.id}>
    <a className={link} href={`${endpoint}/files?id=${file.id}`}>{fileSlots.find(([slot]) => slot === file.slot)?.[1]}</a>
  </li>)}</ul>;
  return <form className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4" onSubmit={event => { event.preventDefault(); void download(event.currentTarget); }}>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-semibold">Final document<select name="fileId" className={input}>{files.map(file => <option key={file.id} value={file.id}>{fileSlots.find(([slot]) => slot === file.slot)?.[1]}</option>)}</select></label>
      <label className="text-sm font-semibold">Package password<input name="password" type="password" className={input} minLength={12} maxLength={80} autoComplete="off" required /></label>
      <label className="text-sm font-semibold">Download format<select name="mode" className={input}><option value="protected">Password-protected original</option><option value="unlocked">Unlocked copy</option></select></label>
      <button className={primary} disabled={busy}>Download</button>
    </div>
    <p className="mt-2 text-xs text-neutral-600">Get the package password from the setter through an approved private channel.</p>
  </form>;
}

export default function PaperModerationWorkspace() {
  const { user } = useAuth();
  const [modules, setModules] = useState<AssignedModule[] | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [chosenScope, setScope] = useState<"assigned" | "hod" | null>(null);
  const scope = chosenScope ?? (user?.capabilities.isHOD && !user.capabilities.isActiveLec && !user.capabilities.isExamLec ? "hod" : "assigned");
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${endpoint}?scope=${scope}`, { cache: "no-store", signal });
      const data = await response.json();
      if (signal?.aborted) return;
      if (!response.ok) {
        setModules(null);
        setNeedsLogin(response.status === 401);
        throw new Error(data.error ?? "Unable to load paper moderation.");
      }
      setModules(data);
      setNeedsLogin(false);
      setError("");
      const config = await fetch(`${endpoint}/settings?panel=${showSettings ? 1 : 0}`, { cache: "no-store", signal });
      if (config.ok) setSettings(await config.json());
      else if (showSettings && !signal?.aborted) setError("Unable to load the Faculty Board panel and moderation settings.");
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : "Unable to load paper moderation.");
    }
  }, [scope, showSettings]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    return () => controller.abort();
  }, [refresh]);

  async function mutate(url: string, body: BodyInit, json = false) {
    setBusy(true); setSaved(false); setError("");
    try {
      const response = await fetch(url, { method: "POST", body, headers: json ? { "Content-Type": "application/json" } : undefined });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (response.status === 401) { setNeedsLogin(true); setModules(null); }
        throw new Error(data?.error ?? (response.status === 413 ? "The upload is too large." : "Unable to save the moderation update."));
      }
      setSaved(true);
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the moderation update.");
      return false;
    } finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>, moduleId: number, paper?: Paper) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form, (event.nativeEvent as SubmitEvent).submitter);
    const action = fields.get("action");
    const target = paper ? { paperId: paper.id, version: paper.version } : { moduleId };
    const command: Record<string, unknown> = { action, ...target };
    for (const key of ["reference", "academicYear", "note"] as const) if (fields.has(key)) command[key] = fields.get(key);
    if (fields.has("semester")) command.semester = Number(fields.get("semester"));
    if (fields.has(criteria[0][0])) command.remarks = Object.fromEntries(criteria.map(([key]) => [key, fields.get(key) === "yes"]));
    if (action === "FINALIZE") {
      if (fields.get("password") !== fields.get("confirmPassword")) { setError("The package passwords do not match."); return; }
      command.password = fields.get("password");
      command.followUp = String(fields.get("followUp") ?? "").split("\n").map(line => line.trim()).filter(Boolean);
    }
    const upload = new FormData();
    let size = 0;
    for (const slot of [...fileSlots.map(([key]) => key), "moderatorSignature", "lecturerSignature"]) {
      const file = fields.get(slot);
      if (file instanceof File && file.size) { upload.set(slot, file); size += file.size; }
    }
    if (size >= MAX_UPLOAD_BYTES - 24 * 1024) { setError("The combined upload must be under 4 MiB."); return; }
    upload.set("command", JSON.stringify(command));
    if (await mutate(endpoint, upload)) form.reset();
  }

  async function download(form: HTMLFormElement) {
    const fields = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch(`${endpoint}/files`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: Number(fields.get("fileId")), mode: fields.get("mode"), password: fields.get("password") }) });
      if (!response.ok) {
        if (response.status === 401) setNeedsLogin(true);
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Unable to download this file.");
      }
      const object = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = object;
      anchor.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "moderation-document";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(object), 1000);
      form.reset();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to download this file."); }
    finally { setBusy(false); }
  }

  const years = Array.from(new Set(modules?.flatMap(module => module.papers.map(paper => paper.academicYear)) ?? [])).sort().reverse();
  const displayed = modules?.filter(module => `${module.code} ${module.name}`.toLowerCase().includes(query.trim().toLowerCase())).map(module => ({
    ...module, visible: module.papers.filter(paper => (!filter || paper.status === filter) && (!year || paper.academicYear === year) && (!semester || paper.semester === Number(semester))),
  })).filter(module => !(filter || year || semester) || module.visible.length > 0);

  return <main className="min-h-screen bg-cream-canvas px-4 py-8 text-neutral-900 sm:px-8">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Exam preparation</p>
          <h1 className="mt-1 text-3xl font-black">Paper Moderation</h1>
          <p className="mt-2 text-sm text-neutral-600">Prepare, review, and securely hand off exam papers. This does not change student marks.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {user?.capabilities.isActiveLec && <Link className={link} href="/dashboard/lecturer">Lecturer Desk</Link>}
          {user?.capabilities.isExamLec && <Link className={link} href="/dashboard/examiner">Examiner Hub</Link>}
          {user?.capabilities.isHOD && <Link className={link} href="/dashboard/hod">HOD Console</Link>}
          <button type="button" className={secondary} disabled={busy} onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>
      {user?.capabilities.isHOD && <nav aria-label="Moderation workspace" className="flex flex-wrap gap-2">
        {([ ["assigned", "My assignments"], ["hod", "HOD handoff inbox"] ] as const).map(([value, label]) => <button key={value} type="button" className={scope === value ? primary : secondary} aria-pressed={scope === value} disabled={busy} onClick={() => { if (scope !== value) { setModules(null); setError(""); setScope(value); } }}>{label}</button>)}
        <button type="button" className={secondary} aria-expanded={showSettings} disabled={busy} onClick={() => setShowSettings(!showSettings)}>Academic settings &amp; Faculty Board panel</button>
      </nav>}
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
        {error} {needsLogin && <Link href="/login" className={link}>Sign in again</Link>}
      </div>}
      {saved && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Moderation update saved.</p>}
      {showSettings && settings?.users && <ModerationSettingsPanel key={JSON.stringify(settings.period)} settings={settings} busy={busy} save={command => mutate(`${endpoint}/settings`, JSON.stringify(command), true)} />}
      <div className="grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-4">
        <label className="text-sm font-semibold">Search modules<input className={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="Code or name" /></label>
        <label className="text-sm font-semibold">Academic year<select className={input} value={year} onChange={event => setYear(event.target.value)}><option value="">All years</option>{years.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm font-semibold">Semester<select className={input} value={semester} onChange={event => setSemester(event.target.value)}><option value="">All semesters</option><option>1</option><option>2</option></select></label>
        <label className="text-sm font-semibold">Status<select className={input} value={filter} onChange={event => setFilter(event.target.value)}><option value="">All statuses</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      {!modules && !error && <p role="status" className="text-sm text-neutral-600">Loading moderation workspace…</p>}
      {displayed?.length === 0 && <p className={section}>{modules?.length ? "No papers match the current filters." : scope === "hod" ? "No finalized packages have been sent to the HOD." : "No modules are assigned to you for moderation."}</p>}
      {displayed?.map(module => <section key={module.id} className={section}>
        <header><p className="text-xs font-bold uppercase tracking-wider text-indigo-700">{scope === "hod" ? "HOD handoff" : module.setter ? "Paper-setting lecturer" : module.moderator ? "Paper moderator · Second Examiner" : "Course lecturer · Read only"}</p>
          <h2 className="mt-1 text-lg font-bold">{module.code} — {module.name}</h2></header>
        {module.setter && !module.hasModerator && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">You can save a draft. Submission requires a different, approved Second Examiner.</p>}
        {module.setter && <details className={actionPanel}>
          <summary className="cursor-pointer text-sm font-bold text-indigo-800">Set a new exam paper</summary>
          <form className="space-y-3" key={`${settings?.period?.academicYear ?? ""}-${settings?.period?.semester ?? ""}`} onSubmit={event => void submit(event, module.id)}>
            <PeriodFields defaults={settings?.period} />
            <label className="block text-sm font-semibold">Paper reference<input className={input} name="reference" maxLength={160} placeholder="e.g. Exam paper v1" required /></label>
            <BundleFields /><SampleLinks />
            <div className="flex flex-wrap gap-2"><button className={secondary} name="action" value="CREATE_DRAFT" disabled={busy}>Save draft</button>
              <button className={primary} name="action" value="SUBMIT" disabled={busy || !module.hasModerator}>Submit for moderation</button></div>
          </form>
        </details>}
        {module.visible.length === 0 && <p className="text-sm text-neutral-600">No recorded submissions yet.</p>}
        {module.visible.map(paper => {
          const files = paper.files.filter(file => file.version === paper.bundleVersion);
          const oldVersions = Array.from(new Set(paper.files.filter(file => file.version !== paper.bundleVersion).map(file => file.version))).sort((a, b) => b - a);
          const signedReview = paper.events.find(event => event.version === paper.version && event.details?.remarks);
          return <article key={paper.id} className="space-y-3 rounded-lg border border-neutral-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">{paper.academicYear} · Semester {paper.semester}</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${["APPROVED", "FINALIZED"].includes(paper.status) ? "bg-emerald-100 text-emerald-900" : paper.status === "REVISION_REQUIRED" ? "bg-amber-100 text-amber-900" : "bg-indigo-100 text-indigo-900"}`}>{statusLabels[paper.status]}</span>
            </div>
            <p className="break-words text-sm"><strong>Current reference:</strong> {paper.reference}</p>
            {paper.handoffAt && <p className="text-xs text-neutral-600">Handoff: {new Date(paper.handoffAt).toLocaleString()}</p>}
            <PaperDocuments files={files} busy={busy} download={download} />
            {oldVersions.length > 0 && <details className="rounded-lg bg-neutral-50 p-3 text-sm"><summary className="cursor-pointer font-semibold text-indigo-700">Previous document versions</summary>
              {oldVersions.map(version => <div key={version} className="mt-2"><b>Version {version}</b><PaperDocuments files={paper.files.filter(file => file.version === version)} busy={busy} download={download} /></div>)}
            </details>}
            <details open={paper.status === "REVISION_REQUIRED" || paper.status === "FINALIZED"}>
              <summary className="cursor-pointer text-sm font-semibold text-indigo-700">Review history ({paper.events.length})</summary>
              <ol className="mt-2 space-y-3 rounded-lg bg-neutral-50 p-3 text-sm">{paper.events.map(event => <li key={event.version}>
                <strong>{actionLabels[event.action]}</strong> · <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                {event.note && <p className="whitespace-pre-wrap break-words text-neutral-700">{event.note}</p>}
                {event.details?.remarks && <div className="space-y-2">
                  <details><summary className="cursor-pointer">View checklist answers</summary><ul className="ml-4 list-disc">{criteria.map(([key, label]) => <li key={key}>{label} <b>{event.details?.remarks?.[key] ? "Yes" : "No"}</b></li>)}</ul></details>
                  <div className="flex flex-wrap gap-3">{([ ["pdf", "PDF"], ["docx", "Word"] ] as const).map(([format, label]) => <a key={format} className={link} href={`${endpoint}/report?paperId=${paper.id}&version=${event.version}&format=${format}`}>Signed report ({label})</a>)}</div>
                </div>}
                {!!event.details?.followUp?.length && <ul className="mt-1 ml-4 list-disc">{event.details.followUp.map((part, i) => <li key={i}>{part}</li>)}</ul>}
              </li>)}</ol>
            </details>
            {paper.status === "DRAFT" && module.setter && <div className={actionPanel}>
              <form className="space-y-3" key={paper.version} onSubmit={event => void submit(event, module.id, paper)}>
                <label className="block text-sm font-semibold">Draft reference<input className={input} name="reference" defaultValue={paper.reference} maxLength={160} required /></label>
                <BundleFields /><button className={secondary} name="action" value="SAVE_DRAFT" disabled={busy}>Save draft changes</button>
              </form>
              <form onSubmit={event => void submit(event, module.id, paper)}><button className={primary} name="action" value="SUBMIT_DRAFT" disabled={busy || !module.hasModerator || !paper.bundleVersion}>Submit saved draft</button></form>
            </div>}
            {paper.status === "UNDER_MODERATION" && paper.canReview && <form className={actionPanel} onSubmit={event => void submit(event, module.id, paper)}>
              {paper.bundleVersion && <><fieldset><legend className="mb-2 text-sm font-bold">Moderation checklist</legend>
                {criteria.map(([key, label]) => <label key={key} className="flex items-center justify-between gap-2 border-b border-indigo-100 py-2 text-sm">{label}
                  <select name={key} className="rounded border border-neutral-300 bg-white p-1" defaultValue="" required><option value="" disabled>Select</option><option value="yes">Yes</option><option value="no">No</option></select>
                </label>)}
              </fieldset><label className="block text-sm font-semibold">Moderator signature (PNG/JPEG)<input type="file" name="moderatorSignature" accept=".png,.jpg,.jpeg" className={input} required /></label></>}
              <label className="block text-sm font-semibold">Review notes (required when requesting a revision)<textarea className={input} name="note" maxLength={2000} rows={3} /></label>
              <div className="flex flex-wrap gap-2"><button className={secondary} name="action" value="REQUEST_REVISION" disabled={busy}>Request revision</button>
                <button className={primary} name="action" value="APPROVE" disabled={busy}>Approve paper</button></div>
            </form>}
            {paper.status === "UNDER_MODERATION" && module.moderator && !paper.canReview && <p className="text-sm text-amber-900">You cannot review a version you submitted. Ask the administrator to assign a different moderator.</p>}
            {module.setter && module.hasModerator && (paper.status === "REVISION_REQUIRED" || (!paper.bundleVersion && ["UNDER_MODERATION", "APPROVED"].includes(paper.status))) && <details className={actionPanel}>
              <summary className="cursor-pointer text-sm font-semibold text-indigo-700">{paper.bundleVersion ? "Resubmit for another review" : "Add files and request a new review"}</summary>
              <form className="space-y-3" onSubmit={event => void submit(event, module.id, paper)}>
                <label className="block text-sm font-semibold">Revised paper reference<input className={input} name="reference" maxLength={160} required /></label>
                <BundleFields required /><button className={primary} name="action" value="RESUBMIT" disabled={busy}>Resubmit</button>
              </form>
            </details>}
            {module.setter && signedReview && (paper.status === "APPROVED" || paper.status === "REVISION_REQUIRED") && <details className={actionPanel}>
              <summary className="cursor-pointer text-sm font-semibold text-indigo-700">Finalise and send to HOD</summary>
              <form className="space-y-3" onSubmit={event => void submit(event, module.id, paper)}>
                <label className="block text-sm font-semibold">Final reference<input className={input} name="reference" defaultValue={paper.reference} maxLength={160} required /></label>
                <BundleFields required />
                <label className="block text-sm font-semibold">Follow-up actions (one per line)<textarea className={input} name="followUp" maxLength={5009} rows={3} required /></label>
                <label className="block text-sm font-semibold">First Examiner signature (PNG/JPEG)<input className={input} name="lecturerSignature" type="file" accept=".png,.jpg,.jpeg" required /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold">Package password<input className={input} name="password" type="password" autoComplete="new-password" minLength={12} maxLength={80} required /></label>
                  <label className="text-sm font-semibold">Confirm password<input className={input} name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={80} required /></label>
                </div>
                <p className="text-xs text-neutral-700">Use a unique password of at least 12 characters with no spaces. Share it separately. Finalised packages cannot be changed.</p>
                <button className={primary} name="action" value="FINALIZE" disabled={busy}>Encrypt files and send to HOD</button>
              </form>
            </details>}
          </article>;
        })}
      </section>)}
    </div>
  </main>;
}
