"use server";
import { fail, guard, guardAdmin, refresh, unexpected, type ActionResult } from "@/lib/action";
import { isUniqueViolation, query, queryOne } from "@/lib/db";
import { certificateIssueSchema } from "@/lib/validation";

export async function setEligibility(internId: number, eligible: boolean): Promise<ActionResult> {
  const denied = await guardAdmin();
  if (denied) return denied;
  try {
    if (!eligible) {
      const c = await queryOne<{ status: string }>("SELECT status FROM certificates WHERE intern_id = $1", [internId]);
      if (c?.status === "Issued") return fail("This certificate is already issued. Revert it to Pending first.");
    }
    await query(
      `INSERT INTO certificates (intern_id, eligibility) VALUES ($1, $2)
       ON CONFLICT (intern_id) DO UPDATE SET eligibility = EXCLUDED.eligibility, updated_at = now()`,
      [internId, eligible],
    );
    refresh();
    return { ok: true, message: eligible ? "Marked as eligible." : "Marked as not eligible." };
  } catch (e) {
    return unexpected(e);
  }
}

/** Explicitly issues a certificate. Never happens automatically. */
export async function issueCertificate(input: unknown): Promise<ActionResult> {
  const g = await guard(certificateIssueSchema, input);
  if ("result" in g) return g.result;
  const d = g.data;
  try {
    const cur = await queryOne<{ eligibility: boolean }>("SELECT eligibility FROM certificates WHERE intern_id = $1", [d.intern_id]);
    if (!cur?.eligibility) return fail("Mark the intern as eligible before issuing a certificate.");
    await query(
      `UPDATE certificates SET status = 'Issued', issue_date = $2, certificate_number = $3, certificate_url = $4, updated_at = now()
        WHERE intern_id = $1`,
      [d.intern_id, d.issue_date, d.certificate_number, d.certificate_url],
    );
    refresh();
    return { ok: true, message: "Certificate marked as issued." };
  } catch (e) {
    if (isUniqueViolation(e, "certificates_number_key")) return fail("Duplicate certificate number.", { certificate_number: "This number is already used" });
    return unexpected(e);
  }
}

export async function revertCertificate(internId: number): Promise<ActionResult> {
  const denied = await guardAdmin();
  if (denied) return denied;
  try {
    await query(
      "UPDATE certificates SET status='Pending', issue_date=NULL, certificate_number=NULL, certificate_url=NULL, updated_at=now() WHERE intern_id=$1",
      [internId],
    );
    refresh();
    return { ok: true, message: "Certificate reverted to Pending." };
  } catch (e) {
    return unexpected(e);
  }
}

export async function deleteCertificateRecord(internId: number): Promise<ActionResult> {
  const denied = await guardAdmin();
  if (denied) return denied;
  try {
    await query("DELETE FROM certificates WHERE intern_id = $1", [internId]);
    refresh();
    return { ok: true, message: "Certificate record deleted." };
  } catch (e) {
    return unexpected(e);
  }
}
