"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { login } from "@/actions/auth";
import { TextField } from "@/components/fields";
import { Button } from "@/components/ui";
import { formToObject } from "@/components/useRun";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const r = await login(formToObject(e.currentTarget));
      if (r.ok) { router.push("/"); router.refresh(); return; }
      setError(r.message);
    } catch {
      setError("Could not reach the server. Please try again.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <TextField name="email" label="Email" type="email" autoComplete="username" required autoFocus />
      <TextField name="password" label="Password" type="password" autoComplete="current-password" required />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
