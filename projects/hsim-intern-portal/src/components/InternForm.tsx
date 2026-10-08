"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createIntern, updateIntern } from "@/actions/interns";
import { DEPARTMENTS, INTERN_STATUSES } from "@/lib/constants";
import { addMonths } from "@/lib/dates";
import type { Intern } from "@/lib/queries/interns";
import { FormActions, SelectField, TextAreaField, TextField } from "./fields";
import { Card, LinkButton, Button } from "./ui";
import { formToObject, useRun } from "./useRun";

export function InternForm({ intern, suggestedId, trainers }: { intern?: Intern; suggestedId?: string; trainers: string[] }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [joining, setJoining] = useState(intern?.joining_date ?? "");
  const [months, setMonths] = useState(String(intern?.internship_duration_months ?? 3));
  const [end, setEnd] = useState(intern?.end_date ?? "");
  const [endTouched, setEndTouched] = useState(!!intern);

  function recompute(j: string, m: string) {
    const n = parseInt(m, 10);
    if (!endTouched && j && n > 0) setEnd(addMonths(j, n));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = formToObject(e.currentTarget);
    const r = await run(() => (intern ? updateIntern(intern.id, data) : createIntern(data)), (r) => router.push(`/interns/${r.data!.id}`));
    setErrors(r.ok ? {} : r.errors ?? {});
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="hsim_id" label="HSIM ID" defaultValue={intern?.hsim_id ?? suggestedId} errors={errors} required maxLength={30} />
          <TextField name="full_name" label="Full name" defaultValue={intern?.full_name} errors={errors} required />
          <TextField name="phone" label="Phone number" type="tel" defaultValue={intern?.phone} errors={errors} required />
          <TextField name="email" label="Email" type="email" defaultValue={intern?.email} errors={errors} required />
          <SelectField name="department" label="Department" options={DEPARTMENTS} placeholder="Select department" defaultValue={intern?.department ?? ""} errors={errors} required />
          <TextField name="batch" label="Batch" defaultValue={intern?.batch} placeholder="e.g. Oct 2026" errors={errors} required />
          <TextField name="joining_date" label="Joining date" type="date" value={joining} errors={errors} required
            onChange={(e) => { setJoining(e.target.value); recompute(e.target.value, months); }} />
          <TextField name="internship_duration_months" label="Internship duration (months)" type="number" min={1} max={36} value={months} errors={errors} required
            onChange={(e) => { setMonths(e.target.value); recompute(joining, e.target.value); }} />
          <TextField name="end_date" label="End date" type="date" value={end} errors={errors} required hint="Calculated from joining date + duration; you can change it."
            onChange={(e) => { setEnd(e.target.value); setEndTouched(true); }} />
          <TextField name="trainer" label="Assigned trainer / mentor" defaultValue={intern?.trainer} errors={errors} list="trainers" required />
          <datalist id="trainers">{trainers.map((t) => <option key={t} value={t} />)}</datalist>
          <SelectField name="status" label="Status" options={INTERN_STATUSES} defaultValue={intern?.status ?? "Active"} errors={errors} required />
          <TextAreaField name="notes" label="Notes (optional)" defaultValue={intern?.notes ?? ""} errors={errors} className="sm:col-span-2" />
        </div>
        <FormActions>
          <LinkButton variant="secondary" href={intern ? `/interns/${intern.id}` : "/interns"}>Cancel</LinkButton>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : intern ? "Save changes" : "Add intern"}</Button>
        </FormActions>
      </Card>
    </form>
  );
}
