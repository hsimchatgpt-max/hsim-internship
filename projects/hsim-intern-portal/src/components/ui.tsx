import clsx from "clsx";
import { AlertTriangle, CalendarOff, Check, Clock, X } from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/50",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-400",
};
const BTN = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed";

export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={clsx(BTN, VARIANTS[variant], className)} {...p} />;
}

export function LinkButton({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={clsx(BTN, VARIANTS[variant], className)} {...p} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("rounded-lg border border-slate-200 bg-white p-4 sm:p-5", className)}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 max-w-md text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: string; href?: string; tone?: "warn" | "good" }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold", tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-700" : "text-slate-900")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </>
  );
  const cls = "block rounded-lg border border-slate-200 bg-white p-4";
  return href ? <Link href={href} className={clsx(cls, "hover:border-brand-500")}>{body}</Link> : <div className={cls}>{body}</div>;
}

const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";

/** Status badges always pair colour with an icon and a text label (never colour alone). */
export function AttendanceBadge({ status }: { status: string | null }) {
  if (!status) return <span className={clsx(PILL, "bg-slate-100 text-slate-500")}>Not marked</span>;
  const map: Record<string, [string, ReactNode]> = {
    Present: ["bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200", <Check key="i" size={12} aria-hidden />],
    Absent: ["bg-red-50 text-red-800 ring-1 ring-red-200", <X key="i" size={12} aria-hidden />],
    Leave: ["bg-sky-50 text-sky-800 ring-1 ring-sky-200", <CalendarOff key="i" size={12} aria-hidden />],
    "Half Day": ["bg-amber-50 text-amber-800 ring-1 ring-amber-200", <Clock key="i" size={12} aria-hidden />],
  };
  const [cls, icon] = map[status] ?? ["bg-slate-100 text-slate-600", null];
  return <span className={clsx(PILL, cls)}>{icon}{status}</span>;
}

const TONES: Record<string, string> = {
  Active: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  Completed: "bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200",
  Left: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  Pending: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  Approved: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  Rejected: "bg-red-50 text-red-800 ring-1 ring-red-200",
  Issued: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  "Not Started": "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  "In Progress": "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
  Low: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  Medium: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  High: "bg-red-50 text-red-800 ring-1 ring-red-200",
  Overdue: "bg-red-50 text-red-800 ring-1 ring-red-200",
  SEO: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
  "Social Media": "bg-pink-50 text-pink-800 ring-1 ring-pink-200",
};

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={clsx(PILL, TONES[tone ?? String(children)] ?? "bg-slate-100 text-slate-600")}>{children}</span>;
}

export function OverdueBadge() {
  return <span className={clsx(PILL, TONES.Overdue)}><AlertTriangle size={12} aria-hidden />Overdue</span>;
}

export function Field({ label, error, hint, children, htmlFor, className }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

export function Pagination({ page, total, pageSize, hrefFor }: { page: number; total: number; pageSize: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>Page {page} of {pages} · {total} records</span>
      <span className="flex gap-2">
        {page > 1 && <LinkButton variant="secondary" href={hrefFor(page - 1)}>Previous</LinkButton>}
        {page < pages && <LinkButton variant="secondary" href={hrefFor(page + 1)}>Next</LinkButton>}
      </span>
    </nav>
  );
}
