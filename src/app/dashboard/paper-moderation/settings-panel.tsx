"use client";

export type SettingsData = {
  period: { academicYear: string; semester: number } | null;
  users?: { id: number; fullName: string | null; email: string; isActiveLec: boolean; isExamLec: boolean; approved: boolean }[];
  modules?: { id: number; code: string; name: string; activeLecturer: { fullName: string | null; email: string } | null;
    examLecturer: { fullName: string | null; email: string } | null; moderationLecturers: { userId: number }[] }[];
};

const input = "mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";
const button = "rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50";

export function ModerationSettingsPanel({ settings, busy, save }: { settings: SettingsData; busy: boolean; save: (body: Record<string, unknown>) => Promise<boolean> }) {
  return <section className="space-y-5 rounded-xl border border-indigo-200 bg-white p-5 text-sm">
    <h2 className="text-lg font-bold">Academic settings &amp; Faculty Board panel</h2>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      void save({ action: "PERIOD", academicYear: data.get("academicYear"), semester: Number(data.get("semester")) });
    }}>
      <label className="font-semibold">Default academic year<input className={input} name="academicYear" defaultValue={settings.period?.academicYear} placeholder="2026/2027" required /></label>
      <label className="font-semibold">Default semester<select className={input} name="semester" defaultValue={settings.period?.semester ?? 1}><option value="1">1</option><option value="2">2</option></select></label>
      <button className={button} disabled={busy}>Save academic period</button>
    </form>
    <details>
      <summary className="cursor-pointer font-semibold text-indigo-800">Faculty Board examiner panel</summary>
      <p className="my-2 text-neutral-600">Record the Faculty Board’s approval or revoke moderation access here. The Results admin still assigns First and Second Examiner capabilities.</p>
      <ul className="divide-y divide-neutral-100">{settings.users?.map(user => <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span>{user.fullName || user.email}{user.fullName && <small className="ml-2 text-neutral-500">{user.email}</small>} · {user.approved ? "Approved" : "Pending / not approved"}</span>
        <button type="button" className={button} disabled={busy} onClick={() => void save({ action: "PANEL", userId: user.id, approved: !user.approved })}>{user.approved ? "Revoke approval" : "Approve for panel"}</button>
      </li>)}</ul>
    </details>
    <details>
      <summary className="cursor-pointer font-semibold text-indigo-800">Subject assignments &amp; course lecturers</summary>
      <p className="my-2 text-neutral-600">The First Examiner and moderator are taken from the existing Results module assignments. Add any other approved course lecturers here for read-only review access.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void save({ action: "COURSE_LECTURER", moduleId: Number(data.get("moduleId")), userId: Number(data.get("userId")), assigned: true });
      }}>
        <label className="font-semibold">Module<select className={input} name="moduleId" required defaultValue=""><option value="" disabled>Select module</option>{settings.modules?.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label className="font-semibold">Approved lecturer<select className={input} name="userId" required defaultValue=""><option value="" disabled>Select lecturer</option>{settings.users?.filter(user => user.approved).map(user => <option key={user.id} value={user.id}>{user.fullName || user.email}</option>)}</select></label>
        <button className={button} disabled={busy}>Add course lecturer</button>
      </form>
      <ul className="mt-3 divide-y divide-neutral-100">{settings.modules?.map(item => <li className="space-y-1 py-2" key={item.id}>
        <span className="font-semibold">{item.code}</span> · Setter: {item.activeLecturer?.fullName || item.activeLecturer?.email || "Unassigned"} · Moderator: {item.examLecturer?.fullName || item.examLecturer?.email || "Unassigned"}
        {item.moderationLecturers.map(({ userId }) => {
          const user = settings.users?.find(lecturer => lecturer.id === userId);
          return <div key={userId} className="flex items-center gap-2">{user?.fullName || user?.email || "Course lecturer"}
            <button type="button" className={button} disabled={busy} onClick={() => void save({ action: "COURSE_LECTURER", moduleId: item.id, userId, assigned: false })}>Remove</button></div>;
        })}
      </li>)}</ul>
    </details>
  </section>;
}
