import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InternForm } from "@/components/InternForm";
import { PageHeader } from "@/components/ui";
import { getIntern, listTrainers } from "@/lib/queries/interns";

export const metadata: Metadata = { title: "Edit intern" };

export default async function EditInternPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const intern = Number.isInteger(id) ? await getIntern(id) : null;
  if (!intern) notFound();
  return (
    <>
      <PageHeader title={`Edit ${intern.full_name}`} subtitle={intern.hsim_id} />
      <InternForm intern={intern} trainers={await listTrainers()} />
    </>
  );
}
