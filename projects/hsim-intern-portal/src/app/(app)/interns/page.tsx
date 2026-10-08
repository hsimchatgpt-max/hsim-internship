import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar, SearchFilter, SelectFilter } from "@/components/Filters";
import { Badge, EmptyState, ExportButtons, LinkButton, PageHeader, Pagination } from "@/components/ui";
import { DEPARTMENTS, INTERN_STATUSES } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { href, oneOf, pageParam, str, type SearchParams } from "@/lib/params";
import { listBatches, listInterns } from "@/lib/queries/interns";

export const metadata: Metadata = { title: "Interns" };
const PAGE_SIZE = 25;

export default async function InternsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = {
    q: str(sp.q), department: oneOf(sp.department, DEPARTMENTS), status: oneOf(sp.status, INTERN_STATUSES), batch: str(sp.batch),
    page: pageParam(sp.page), pageSize: PAGE_SIZE,
  };
  const [{ rows, total }, batches] = await Promise.all([listInterns(filters), listBatches()]);
  const filtered = !!(filters.q || filters.department || filters.status || filters.batch);
  const exportHref = href("/api/export/interns", { q: filters.q, department: filters.department, status: filters.status, batch: filters.batch });

  return (
    <>
      <PageHeader title="Interns" subtitle={`${total} intern${total === 1 ? "" : "s"}${filtered ? " match your filters" : ""}`}
        actions={<><ExportButtons to={exportHref} /><LinkButton href="/interns/new">Add intern</LinkButton></>} />
      <FilterBar>
        <SearchFilter placeholder="Search name, HSIM ID, email, phone" />
        <SelectFilter param="department" label="All departments" options={DEPARTMENTS} />
        <SelectFilter param="status" label="All statuses" options={INTERN_STATUSES} />
        <SelectFilter param="batch" label="All batches" options={batches} />
      </FilterBar>

      {rows.length === 0 ? (
        filtered ? <EmptyState title="No interns match your filters." hint="Try clearing the search or filters." />
          : <EmptyState title="No interns added yet. Add your first intern to get started." action={<LinkButton href="/interns/new">Add intern</LinkButton>} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>HSIM ID</th><th>Name</th><th>Department</th><th>Batch</th><th>Trainer</th><th>Joined</th><th>Ends</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs">{r.hsim_id}</td>
                    <td><Link href={`/interns/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.full_name}</Link><div className="text-xs text-slate-500">{r.email}</div></td>
                    <td><Badge>{r.department}</Badge></td>
                    <td>{r.batch}</td>
                    <td>{r.trainer}</td>
                    <td className="whitespace-nowrap">{formatDate(r.joining_date)}</td>
                    <td className="whitespace-nowrap">{formatDate(r.end_date)}</td>
                    <td><Badge>{r.status}</Badge></td>
                    <td className="whitespace-nowrap text-right">
                      <Link href={`/interns/${r.id}`} className="text-sm font-medium text-brand-700 hover:underline">View</Link>
                      <span className="mx-1.5 text-slate-300">|</span>
                      <Link href={`/interns/${r.id}/edit`} className="text-sm font-medium text-brand-700 hover:underline">Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={filters.page} total={total} pageSize={PAGE_SIZE} hrefFor={(p) => href("/interns", { q: filters.q, department: filters.department, status: filters.status, batch: filters.batch, page: p })} />
        </>
      )}
    </>
  );
}
