import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-white">HSIM Intern Portal</h1>
          <p className="mt-1 text-sm font-medium tracking-wide text-accent">Manage. Track. Grow.</p>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-xl">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Admin sign in</h2>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
