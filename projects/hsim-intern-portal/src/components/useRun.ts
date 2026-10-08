"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { ActionResult } from "@/lib/action";
import { useUi } from "./Providers";

/** Runs a server action with pending state, toast feedback, session-expiry handling and a data refresh. */
export function useRun() {
  const ui = useUi();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <T,>(fn: () => Promise<ActionResult<T>>, onOk?: (r: Extract<ActionResult<T>, { ok: true }>) => void): Promise<ActionResult<T>> => {
      setPending(true);
      try {
        const r = await fn();
        if (r.ok) {
          ui.success(r.message);
          router.refresh();
          onOk?.(r);
        } else if (r.message.startsWith("Your session has expired")) {
          router.push("/login");
        } else if (!r.errors && !r.conflicts) {
          ui.error(r.message);
        }
        return r;
      } catch {
        const r: ActionResult<never> = { ok: false, message: "Could not reach the server. Check your connection and try again." };
        ui.error(r.message);
        return r;
      } finally {
        setPending(false);
      }
    },
    [ui, router],
  );
  return { run, pending };
}

/** Converts a form's fields into a plain object (empty strings preserved; validated on the server). */
export function formToObject(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries([...new FormData(form).entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
}
