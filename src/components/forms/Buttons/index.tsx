"use client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useFormStatus } from "react-dom";

type ButtonsProps = {
  cancelLabel: string;
  confirmLabel: string;
  cancelHref?: string;
  onCancel?: () => void;
};

export default function Buttons({
  cancelLabel,
  confirmLabel,
  cancelHref = "/",
  onCancel,
}: ButtonsProps) {
  const { pending } = useFormStatus();

  return (
    <div className="ml-auto mt-3 flex">
      {onCancel ? (
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
      ) : (
        <Button asChild variant="outline">
          <Link href={cancelHref}>{cancelLabel}</Link>
        </Button>
      )}
      <div className="ml-2">
        <Button type="submit" disabled={pending}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
