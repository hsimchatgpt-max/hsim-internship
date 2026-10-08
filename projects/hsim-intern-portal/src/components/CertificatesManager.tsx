"use client";
import { useState } from "react";
import { deleteCertificateRecord, issueCertificate, revertCertificate, setEligibility } from "@/actions/certificates";
import { formatDate, todayISO } from "@/lib/dates";
import type { CertificateRow } from "@/lib/queries/certificates";
import { FormActions, TextField } from "./fields";
import { Modal } from "./Modal";
import { useUi } from "./Providers";
import { Badge, Button, EmptyState } from "./ui";
import { formToObject, useRun } from "./useRun";

export function CertificatesManager({ rows }: { rows: CertificateRow[] }) {
  const [issuing, setIssuing] = useState<CertificateRow | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ui = useUi();
  const { run, pending } = useRun();

  async function onIssue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!issuing) return;
    const r = await run(() => issueCertificate({ ...formToObject(e.currentTarget), intern_id: issuing.intern_id }), () => setIssuing(null));
    setErrors(r.ok ? {} : r.errors ?? {});
  }
  async function revert(r: CertificateRow) {
    if (await ui.confirm({ title: "Revert certificate to Pending?", message: `${r.full_name}'s certificate number, issue date and link will be cleared.`, confirmLabel: "Revert", danger: true })) await run(() => revertCertificate(r.intern_id));
  }
  async function remove(r: CertificateRow) {
    if (await ui.confirm({ title: "Delete certificate record?", message: `Delete the certificate record for ${r.full_name}${r.status === "Issued" ? ", including its issued details" : ""}?`, confirmLabel: "Delete record", danger: true })) await run(() => deleteCertificateRecord(r.intern_id));
  }

  if (!rows.length) return <EmptyState title="No interns found." hint="Completed and active interns appear here for certificate tracking." />;

  return (
    <>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>HSIM ID</th><th>Intern</th><th>Internship</th><th>Ends</th><th>Eligible</th><th>Certificate</th><th>Number</th><th>Issued</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.intern_id}>
            <td className="font-mono text-xs">{r.hsim_id}</td>
            <td className="font-medium">{r.full_name}<div className="text-xs font-normal text-slate-500">{r.department}</div></td>
            <td><Badge>{r.intern_status}</Badge></td>
            <td className="whitespace-nowrap">{formatDate(r.end_date)}</td>
            <td>{r.eligibility ? "Yes" : "No"}</td>
            <td><Badge>{r.status}</Badge></td>
            <td className="font-mono text-xs">{r.certificate_url ? <a className="text-brand-700 underline" href={r.certificate_url} target="_blank" rel="noopener noreferrer">{r.certificate_number}</a> : r.certificate_number ?? "—"}</td>
            <td className="whitespace-nowrap">{formatDate(r.issue_date)}</td>
            <td className="whitespace-nowrap text-right">
              {r.status === "Pending" && !r.eligibility && <Button variant="ghost" disabled={pending} onClick={() => run(() => setEligibility(r.intern_id, true))}>Mark eligible</Button>}
              {r.status === "Pending" && r.eligibility && <>
                <Button variant="ghost" disabled={pending} onClick={() => run(() => setEligibility(r.intern_id, false))}>Not eligible</Button>
                <Button variant="secondary" onClick={() => { setErrors({}); setIssuing(r); }}>Issue</Button>
              </>}
              {r.status === "Issued" && <Button variant="ghost" disabled={pending} onClick={() => revert(r)}>Revert</Button>}
              {r.has_record && <Button variant="ghost" className="text-red-600" disabled={pending} onClick={() => remove(r)}>Delete record</Button>}
            </td>
          </tr>))}</tbody></table></div>

      <Modal open={!!issuing} onClose={() => setIssuing(null)} title="Issue certificate">
        {issuing && (
          <form onSubmit={onIssue} noValidate className="space-y-4">
            <p className="text-sm text-slate-600">{issuing.full_name} ({issuing.hsim_id})</p>
            <TextField name="certificate_number" label="Certificate number" required errors={errors} defaultValue={`HSIM-CERT-${new Date().getFullYear()}-${issuing.hsim_id}`} />
            <TextField name="issue_date" label="Issue date" type="date" required errors={errors} defaultValue={todayISO()} />
            <TextField name="certificate_url" label="Certificate file / link (optional)" type="url" errors={errors} placeholder="https://…" />
            <FormActions><Button variant="secondary" onClick={() => setIssuing(null)}>Cancel</Button><Button type="submit" disabled={pending}>Mark as issued</Button></FormActions>
          </form>
        )}
      </Modal>
    </>
  );
}
