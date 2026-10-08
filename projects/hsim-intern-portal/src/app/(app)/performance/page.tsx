import type { Metadata } from "next";
import { DateFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/Filters";
import { ReviewsManager } from "@/components/ReviewsManager";
import { LinkButton, PageHeader } from "@/components/ui";
import { DEPARTMENTS } from "@/lib/constants";
import { dateParam, href, intParam, oneOf, str, type SearchParams } from "@/lib/params";
import { internOptions } from "@/lib/queries/interns";
import { listReviews } from "@/lib/queries/performance";

export const metadata: Metadata = { title: "Performance" };

export default async function PerformancePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const f = { q: str(sp.q), department: oneOf(sp.department, DEPARTMENTS), from: dateParam(sp.from, ""), to: dateParam(sp.to, "") };
  const [reviews, interns] = await Promise.all([listReviews(f), internOptions({ activeOnly: true })]);
  return (
    <>
      <PageHeader title="Performance" subtitle="Periodic trainer reviews. Ratings are 1–5."
        actions={<LinkButton variant="secondary" prefetch={false} href={href("/api/export/performance", f)}>Export CSV</LinkButton>} />
      <FilterBar>
        <SearchFilter placeholder="Search intern or HSIM ID" />
        <SelectFilter param="department" label="All departments" options={DEPARTMENTS} />
        <DateFilter param="from" label="From" />
        <DateFilter param="to" label="To" />
      </FilterBar>
      <ReviewsManager reviews={reviews} interns={interns} autoOpen={str(sp.new) === "1"} presetIntern={intParam(sp.intern)} />
    </>
  );
}
