"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createReview, deleteReview, updateReview } from "@/actions/performance";
import { RATING_FIELDS } from "@/lib/constants";
import { formatDate, todayISO } from "@/lib/dates";
import type { ReviewRow } from "@/lib/queries/performance";
import { FormActions, SelectField, TextAreaField, TextField } from "./fields";
import { Modal } from "./Modal";
import { useUi } from "./Providers";
import { Badge, Button, EmptyState } from "./ui";
import { formToObject, useRun } from "./useRun";

interface Opt { id: number; hsim_id: string; full_name: string }
const RATING_OPTIONS = [5, 4, 3, 2, 1].map((n) => ({ value: n, label: `${n} — ${["", "Poor", "Fair", "Good", "Very good", "Excellent"][n]}` }));

export function ReviewsManager({ reviews, interns, autoOpen, presetIntern }: { reviews: ReviewRow[]; interns: Opt[]; autoOpen: boolean; presetIntern?: number }) {
  const [form, setForm] = useState<{ review?: ReviewRow } | null>(autoOpen ? {} : null);
  const router = useRouter();
  const sp = useSearchParams();
  const ui = useUi();
  const { run } = useRun();

  function closeForm() {
    setForm(null);
    if (sp.get("new")) router.replace("/performance");
  }
  async function remove(r: ReviewRow) {
    if (await ui.confirm({ title: "Delete review?", message: `Delete ${r.full_name}'s review from ${formatDate(r.review_date)}?`, confirmLabel: "Delete review", danger: true })) await run(() => deleteReview(r.id));
  }

  return (
    <>
      <div className="mb-3 flex justify-end"><Button onClick={() => setForm({})}>Add review</Button></div>
      {reviews.length === 0 ? <EmptyState title="No performance reviews yet." hint="Record periodic reviews to track each intern's progress." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>Intern</th><th>Department</th><th title="Work quality">WQ</th><th title="Learning progress">LP</th><th title="Task completion">TC</th><th title="Punctuality">PU</th><th title="Communication">CM</th><th>Overall</th><th>Feedback</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{reviews.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{formatDate(r.review_date)}</td>
              <td className="whitespace-nowrap">{r.full_name}<div className="text-xs text-slate-500">{r.hsim_id}</div></td>
              <td><Badge>{r.department}</Badge></td>
              <td>{r.work_quality}</td><td>{r.learning_progress}</td><td>{r.task_completion}</td><td>{r.punctuality}</td><td>{r.communication}</td>
              <td className="font-semibold text-brand-700">{r.overall_rating.toFixed(1)}</td>
              <td className="max-w-xs truncate text-slate-600" title={r.feedback ?? ""}>{r.feedback}</td>
              <td className="whitespace-nowrap text-right"><Button variant="ghost" onClick={() => setForm({ review: r })}>Edit</Button><Button variant="ghost" className="text-red-600" onClick={() => remove(r)}>Delete</Button></td>
            </tr>))}</tbody></table></div>
      )}
      <ReviewForm open={!!form} review={form?.review} interns={interns} presetIntern={presetIntern} onClose={closeForm} />
    </>
  );
}

function ReviewForm({ open, review, interns, presetIntern, onClose }: { open: boolean; review?: ReviewRow; interns: Opt[]; presetIntern?: number; onClose: () => void }) {
  const { run, pending } = useRun();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const opts = interns.map((i) => ({ value: i.id, label: `${i.hsim_id} — ${i.full_name}` }));
  if (review && !interns.some((i) => i.id === review.intern_id)) opts.push({ value: review.intern_id, label: `${review.hsim_id} — ${review.full_name}` });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = formToObject(e.currentTarget);
    const r = await run(() => (review ? updateReview(review.id, d) : createReview(d)), onClose);
    setErrors(r.ok ? {} : r.errors ?? {});
  }

  return (
    <Modal open={open} onClose={onClose} title={review ? "Edit review" : "Add performance review"} wide>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <SelectField name="intern_id" label="Intern" placeholder="Select intern" options={opts} errors={errors} required defaultValue={review?.intern_id ?? presetIntern ?? ""} />
        <TextField name="review_date" label="Review date" type="date" errors={errors} required defaultValue={review?.review_date ?? todayISO()} />
        {RATING_FIELDS.map(([k, label]) => (
          <SelectField key={k} name={k} label={label} placeholder="Rate 1–5" options={RATING_OPTIONS} errors={errors} required defaultValue={review?.[k] ?? ""} />
        ))}
        <TextAreaField name="feedback" label="Trainer feedback" errors={errors} defaultValue={review?.feedback ?? ""} className="sm:col-span-2" />
        <p className="text-xs text-slate-500 sm:col-span-2">Overall rating is the average of the five ratings, calculated automatically.</p>
        <div className="sm:col-span-2"><FormActions><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save review"}</Button></FormActions></div>
      </form>
    </Modal>
  );
}
