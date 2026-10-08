import type { Metadata } from "next";
import { CertificatesManager } from "@/components/CertificatesManager";
import { FilterBar, SearchFilter, SelectFilter } from "@/components/Filters";
import { PageHeader } from "@/components/ui";
import { CERT_STATUSES } from "@/lib/constants";
import { oneOf, str, type SearchParams } from "@/lib/params";
import { listCertificates } from "@/lib/queries/certificates";

export const metadata: Metadata = { title: "Certificates" };

export default async function CertificatesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const rows = await listCertificates({ q: str(sp.q), status: oneOf(sp.status, CERT_STATUSES), internStatus: oneOf(sp.internship, ["Active", "Completed"] as const) });
  return (
    <>
      <PageHeader title="Certificates" subtitle="Certificates are never issued automatically — mark eligibility, then issue explicitly." />
      <FilterBar>
        <SearchFilter placeholder="Search intern or HSIM ID" />
        <SelectFilter param="internship" label="All internships" options={["Active", "Completed"]} />
        <SelectFilter param="status" label="All certificate statuses" options={CERT_STATUSES} />
      </FilterBar>
      <CertificatesManager rows={rows} />
    </>
  );
}
