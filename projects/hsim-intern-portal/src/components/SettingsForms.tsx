"use client";
import { useRef, useState } from "react";
import { changePassword, saveProfile, saveSettings } from "@/actions/settings";
import type { AppSettings } from "@/lib/settings";
import { TextField } from "./fields";
import { Button, Card } from "./ui";
import { formToObject, useRun } from "./useRun";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <Card className="max-w-2xl"><h2 className="text-base font-semibold text-slate-900">{title}</h2>{description && <p className="mb-4 mt-0.5 text-sm text-slate-500">{description}</p>}{children}</Card>;
}

export function SettingsForms({ settings, admin }: { settings: AppSettings; admin: { name: string; email: string } }) {
  const { run, pending } = useRun();
  const [e1, setE1] = useState<Record<string, string>>({});
  const [e2, setE2] = useState<Record<string, string>>({});
  const [e3, setE3] = useState<Record<string, string>>({});
  const pwForm = useRef<HTMLFormElement>(null);

  return (
    <div className="space-y-4">
      <Section title="Portal preferences">
        <form noValidate className="grid gap-4 sm:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => saveSettings(formToObject(e.currentTarget))); setE1(r.ok ? {} : r.errors ?? {}); }}>
          <TextField name="institute_name" label="Institute name" defaultValue={settings.instituteName} errors={e1} className="sm:col-span-3" required />
          <TextField name="attendance_threshold" label="Low attendance threshold (%)" type="number" min={1} max={100} defaultValue={settings.attendanceThreshold} errors={e1} hint="Interns below this are flagged." required />
          <TextField name="ending_soon_days" label="Ending-soon reminder (days)" type="number" min={1} max={90} defaultValue={settings.endingSoonDays} errors={e1} required />
          <div className="sm:col-span-3"><Button type="submit" disabled={pending}>Save preferences</Button></div>
        </form>
      </Section>
      <Section title="Admin profile">
        <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => saveProfile(formToObject(e.currentTarget))); setE2(r.ok ? {} : r.errors ?? {}); }}>
          <TextField name="name" label="Name" defaultValue={admin.name} errors={e2} required />
          <TextField name="email" label="Email (used to sign in)" type="email" defaultValue={admin.email} errors={e2} required />
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}>Save profile</Button></div>
        </form>
      </Section>
      <Section title="Change password" description="Use at least 10 characters.">
        <form ref={pwForm} noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => changePassword(formToObject(e.currentTarget)), () => pwForm.current?.reset());
          setE3(r.ok ? {} : r.errors ?? {});
        }}>
          <TextField name="current_password" label="Current password" type="password" autoComplete="current-password" errors={e3} required />
          <TextField name="new_password" label="New password" type="password" autoComplete="new-password" errors={e3} required />
          <div className="sm:col-span-2"><Button type="submit" disabled={pending}>Change password</Button></div>
        </form>
      </Section>
    </div>
  );
}
