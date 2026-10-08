import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Field } from "./ui";

type Errors = Record<string, string> | undefined;

export function TextField({ name, label, errors, hint, className, ...p }: { name: string; label: string; errors?: Errors; hint?: string; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = `f-${name}`;
  return (
    <Field label={label} htmlFor={id} error={errors?.[name]} hint={hint} className={className}>
      <input id={id} name={name} className="input" aria-invalid={!!errors?.[name]} aria-describedby={errors?.[name] ? `${id}-error` : undefined} {...p} />
    </Field>
  );
}

export function SelectField({ name, label, errors, options, placeholder, className, ...p }: { name: string; label: string; errors?: Errors; options: readonly (string | { value: string | number; label: string })[]; placeholder?: string; className?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = `f-${name}`;
  return (
    <Field label={label} htmlFor={id} error={errors?.[name]} className={className}>
      <select id={id} name={name} className="input" aria-invalid={!!errors?.[name]} aria-describedby={errors?.[name] ? `${id}-error` : undefined} {...p}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          return <option key={v} value={v}>{typeof o === "string" ? o : o.label}</option>;
        })}
      </select>
    </Field>
  );
}

export function TextAreaField({ name, label, errors, className, ...p }: { name: string; label: string; errors?: Errors; className?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = `f-${name}`;
  return (
    <Field label={label} htmlFor={id} error={errors?.[name]} className={className}>
      <textarea id={id} name={name} rows={3} className="input" aria-invalid={!!errors?.[name]} aria-describedby={errors?.[name] ? `${id}-error` : undefined} {...p} />
    </Field>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap justify-end gap-2">{children}</div>;
}
