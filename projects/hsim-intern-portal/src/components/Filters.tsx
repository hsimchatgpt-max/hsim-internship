"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** Writes a filter value into the URL query string (resetting pagination). */
function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
}

export function SearchFilter({ placeholder = "Search…", param = "q" }: { placeholder?: string; param?: string }) {
  const sp = useSearchParams();
  const setParam = useSetParam();
  const current = sp.get(param) ?? "";
  const [value, setValue] = useState(current);

  useEffect(() => setValue(current), [current]);
  useEffect(() => {
    if (value === current) return;
    const t = setTimeout(() => setParam(param, value.trim()), 300); // debounce
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input type="search" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder}
      aria-label={placeholder} className="input w-full sm:w-64" />
  );
}

export function SelectFilter({ param, label, options }: { param: string; label: string; options: readonly (string | { value: string; label: string })[] }) {
  const sp = useSearchParams();
  const setParam = useSetParam();
  return (
    <select aria-label={label} value={sp.get(param) ?? ""} onChange={(e) => setParam(param, e.target.value)} className="input w-auto min-w-0 flex-1 sm:flex-none">
      <option value="">{label}</option>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        return <option key={v} value={v}>{typeof o === "string" ? o : o.label}</option>;
      })}
    </select>
  );
}

export function DateFilter({ param, label }: { param: string; label: string }) {
  const sp = useSearchParams();
  const setParam = useSetParam();
  return (
    <label className="flex items-center gap-1.5 text-sm text-slate-600">
      {label}
      <input type="date" value={sp.get(param) ?? ""} onChange={(e) => setParam(param, e.target.value)} className="input w-auto" />
    </label>
  );
}

/** Wraps filter controls; collapses behind a toggle on small screens. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="mb-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 sm:hidden">
        {open ? "Hide filters" : "Show filters"}
      </button>
      <div className={`${open ? "flex" : "hidden"} flex-wrap items-center gap-2 sm:flex`}>{children}</div>
    </div>
  );
}
