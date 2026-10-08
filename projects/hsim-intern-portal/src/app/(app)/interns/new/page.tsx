import type { Metadata } from "next";
import { InternForm } from "@/components/InternForm";
import { PageHeader } from "@/components/ui";
import { listTrainers, nextHsimId } from "@/lib/queries/interns";

export const metadata: Metadata = { title: "Add intern" };

export default async function NewInternPage() {
  const [suggestedId, trainers] = await Promise.all([nextHsimId(), listTrainers()]);
  return (
    <>
      <PageHeader title="Add intern" />
      <InternForm suggestedId={suggestedId} trainers={trainers} />
    </>
  );
}
