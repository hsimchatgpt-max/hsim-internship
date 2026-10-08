"use client";
import { useRouter } from "next/navigation";
import { deleteIntern, setInternStatus } from "@/actions/interns";
import { INTERN_STATUSES } from "@/lib/constants";
import { useUi } from "./Providers";
import { Button, LinkButton } from "./ui";
import { useRun } from "./useRun";

export function InternActions({ id, name, status }: { id: number; name: string; status: string }) {
  const { run, pending } = useRun();
  const ui = useUi();
  const router = useRouter();

  async function changeStatus(next: string) {
    if (next === status) return;
    const ok = await ui.confirm({
      title: `Change status to ${next}?`,
      message: next === "Active" ? `${name} will appear in daily attendance again.`
        : `${name} will no longer appear in daily attendance. All existing attendance, tasks and reviews are kept.`,
      confirmLabel: `Mark ${next}`,
    });
    if (ok) await run(() => setInternStatus(id, next));
  }

  async function remove() {
    const ok = await ui.confirm({
      title: "Delete intern?",
      message: <>This permanently deletes <strong>{name}</strong>. It only works for interns with no attendance, leave, task, review or issued-certificate history — otherwise mark them as Left to keep the records.</>,
      confirmLabel: "Delete intern", danger: true,
    });
    if (ok) await run(() => deleteIntern(id), () => router.push("/interns"));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="status-select">Change status</label>
      <select id="status-select" className="input w-auto" value={status} disabled={pending} onChange={(e) => changeStatus(e.target.value)}>
        {INTERN_STATUSES.map((s) => <option key={s}>{s}</option>)}
      </select>
      <LinkButton variant="secondary" href={`/interns/${id}/edit`}>Edit</LinkButton>
      <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={remove} disabled={pending}>Delete</Button>
    </div>
  );
}
