"use client";
import { Button, Card } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  return (
    <Card className="mx-auto max-w-lg text-center">
      <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-1 text-sm text-slate-600">This page couldn&apos;t be loaded. Check your connection and the database, then try again.</p>
      <Button className="mt-4" onClick={reset}>Retry</Button>
    </Card>
  );
}
