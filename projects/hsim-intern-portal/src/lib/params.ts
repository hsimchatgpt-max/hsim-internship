import { isValidISODate } from "./dates";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export type Resolved = Record<string, string | string[] | undefined>;

export const str = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";
export const dateParam = (v: string | string[] | undefined, fallback: string): string => {
  const s = str(v);
  return isValidISODate(s) ? s : fallback;
};
export const pageParam = (v: string | string[] | undefined): number => Math.max(1, parseInt(str(v), 10) || 1);
export const oneOf = <T extends string>(v: string | string[] | undefined, allowed: readonly T[]): T | "" => {
  const s = str(v);
  return (allowed as readonly string[]).includes(s) ? (s as T) : "";
};
export const intParam = (v: string | string[] | undefined): number | undefined => {
  const n = parseInt(str(v), 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Builds a URL with the given params, dropping empty values. */
export function href(path: string, params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
