"use client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useFormStatus } from "react-dom";

type ButtonsProps = {
  cancelLabel: string;
  confirmLabel: string;
};

export default function Buttons({ cancelLabel, confirmLabel }: ButtonsProps) {
  const { pending } = useFormStatus();

  return (
    <div className="ml-auto mt-3 flex">
      <Button asChild variant="outline">
        <Link href="/">{cancelLabel}</Link>
      </Button>
      <div className="ml-2">
        <Button type="submit" disabled={pending}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
