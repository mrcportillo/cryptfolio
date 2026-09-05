"use client";
import { useFormState, useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { savePortfolioInsight } from "@/app/actions/portfolio-insights";

function Fields({ label, children }: { label: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <fieldset disabled={pending} className="min-w-0 space-y-3">
      {children}
      <button className="rounded-md bg-primary-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Saving…" : label}
      </button>
    </fieldset>
  );
}
export default function InsightForm({
  children,
  label = "Save",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [state, action] = useFormState(savePortfolioInsight, {
    ok: false,
    message: "",
  });
  return (
    <form action={action} className="space-y-3">
      <Fields label={label}>{children}</Fields>
      <div className="flex flex-wrap items-center gap-3">
        <p
          role="status"
          aria-live="polite"
          className={
            state.ok ? "text-sm text-emerald-800" : "text-sm text-rose-800"
          }
        >
          {state.message}
        </p>
      </div>
    </form>
  );
}
