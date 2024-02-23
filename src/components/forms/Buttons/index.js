"use client";
import Button from "@/components/Button";
import Link from "next/link";
import { useFormStatus } from "react-dom";

export default function Buttons({ cancelLabel, confirmLabel }) {
  const { pending } = useFormStatus();

  return (
    <div className="ml-auto mt-3 flex">
      <Link href="/">
        <Button outline>{cancelLabel}</Button>
      </Link>
      <div className="ml-2">
        <Button type="submit" disabled={pending}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
