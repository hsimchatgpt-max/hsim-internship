import type { Metadata } from "next";
import { FilterBar, SearchFilter, SelectFilter } from "@/components/Filters";
import { LeavesManager } from "@/components/LeavesManager";
import { PageHeader } from "@/components/ui";
import { LEAVE_STATUSES } from "@/lib/constants";
import { intParam, oneOf, str, type SearchParams } from "@/lib/params";
import { internOptions } from "@/lib/queries/interns";
import { listLeaves } from "@/lib/queries/leaves";

export const metadata: Metadata = { title: "Leaves" };

export default async function LeavesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [leaves, interns] = await Promise.all([
    listLeaves({ status: oneOf(sp.status, LEAVE_STATUSES), q: str(sp.q) }),
    internOptions({ activeOnly: true }),
  ]);
  return (
    <>
      <PageHeader title="Leaves" subtitle="Leave requests and their effect on attendance." />
      <FilterBar>
        <SearchFilter placeholder="Search intern or HSIM ID" />
        <SelectFilter param="status" label="All statuses" options={LEAVE_STATUSES} />
      </FilterBar>
      <LeavesManager leaves={leaves} interns={interns} autoOpen={str(sp.new) === "1"} presetIntern={intParam(sp.intern)} />
    </>
  );
}
