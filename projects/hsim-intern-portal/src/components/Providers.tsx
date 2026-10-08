"use client";
import { CheckCircle2, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./ui";

interface Toast { id: number; kind: "success" | "error"; text: string }
interface ConfirmOpts { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }

interface Ctx {
  success: (t: string) => void;
  error: (t: string) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
}
const C = createContext<Ctx | null>(null);

export function useUi() {
  const c = useContext(C);
  if (!c) throw new Error("useUi must be used inside <Providers>");
  return c;
}

export function Providers({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })), []);
  const close = (v: boolean) => { dialog?.resolve(v); setDialog(null); };

  return (
    <C.Provider value={{ success: (t) => push("success", t), error: (t) => push("error", t), confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-3" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-lg items-start gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${t.kind === "error" ? "bg-red-700" : "bg-slate-900"}`}>
            {t.kind === "error" ? <XCircle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <Modal open={!!dialog} onClose={() => close(false)} title={dialog?.title ?? ""}>
        <div className="text-sm text-slate-600">{dialog?.message}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
          <Button variant={dialog?.danger ? "danger" : "primary"} onClick={() => close(true)}>{dialog?.confirmLabel ?? "Confirm"}</Button>
        </div>
      </Modal>
    </C.Provider>
  );
}
