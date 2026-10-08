import type { Metadata } from "next";
import { FilterBar, SearchFilter, SelectFilter } from "@/components/Filters";
import { TasksManager } from "@/components/TasksManager";
import { PageHeader, StatCard } from "@/components/ui";
import { DEPARTMENTS, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import { intParam, oneOf, str, type SearchParams } from "@/lib/params";
import { internOptions } from "@/lib/queries/interns";
import { listTasks, taskCounts } from "@/lib/queries/tasks";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const status = str(sp.status) === "Overdue" ? "Overdue" : oneOf(sp.status, TASK_STATUSES);
  const [tasks, counts, interns] = await Promise.all([
    listTasks({ q: str(sp.q), status, department: oneOf(sp.department, DEPARTMENTS), priority: oneOf(sp.priority, TASK_PRIORITIES) }),
    taskCounts(),
    internOptions({ activeOnly: true }),
  ]);
  return (
    <>
      <PageHeader title="Tasks" subtitle="Practical work assigned to interns." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total" value={counts.total} />
        <StatCard label="Not started" value={counts.notStarted} href="/tasks?status=Not+Started" />
        <StatCard label="In progress" value={counts.inProgress} href="/tasks?status=In+Progress" />
        <StatCard label="Completed" value={counts.completed} tone="good" href="/tasks?status=Completed" />
        <StatCard label="Overdue" value={counts.overdue} tone={counts.overdue ? "warn" : undefined} href="/tasks?status=Overdue" />
      </div>
      <FilterBar>
        <SearchFilter placeholder="Search task, intern or HSIM ID" />
        <SelectFilter param="status" label="All statuses" options={[...TASK_STATUSES, "Overdue"]} />
        <SelectFilter param="department" label="All departments" options={DEPARTMENTS} />
        <SelectFilter param="priority" label="All priorities" options={TASK_PRIORITIES} />
      </FilterBar>
      <TasksManager tasks={tasks} interns={interns} autoOpen={str(sp.new) === "1"} presetIntern={intParam(sp.intern)} />
    </>
  );
}
