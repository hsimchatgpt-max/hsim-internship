"use client";
import clsx from "clsx";
import {
  Award, CalendarCheck, CalendarOff, ClipboardList, FileBarChart, LayoutDashboard, LogOut, Menu, Settings, Star, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { logout } from "@/actions/auth";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/interns", label: "Interns", icon: Users },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/leaves", label: "Leaves", icon: CalendarOff },
  { href: "/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/performance", label: "Performance", icon: Star },
  { href: "/certificates", label: "Certificates", icon: Award },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Brand() {
  return (
    <div className="px-5 py-5">
      <p className="text-lg font-bold leading-tight text-white">HSIM Intern Portal</p>
      <p className="mt-0.5 text-xs font-medium tracking-wide text-accent">Manage. Track. Grow.</p>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 px-3 pb-4">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link key={href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
            className={clsx("flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white")}>
            <Icon size={18} aria-hidden />{label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ adminName, instituteName, children }: { adminName: string; instituteName: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => setOpen(false), [pathname]);

  async function signOut() {
    await logout();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 flex-col bg-ink lg:flex" aria-label="Sidebar">
        <div className="sticky top-0 flex h-screen flex-col overflow-y-auto"><Brand /><NavLinks /></div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col overflow-y-auto bg-ink">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 rounded p-1 text-slate-300 hover:bg-white/10"><X size={20} /></button>
            <Brand /><NavLinks onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"><Menu size={20} /></button>
            <span className="text-sm font-semibold text-slate-700">{instituteName}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-600 sm:inline">{adminName}</span>
            <button type="button" onClick={signOut} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
              <LogOut size={15} aria-hidden />Log out
            </button>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
