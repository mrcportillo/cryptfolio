"use client";
import { useState, type InputHTMLAttributes } from "react";

// Keep edited values when a server action returns a validation error.
export default function InsightNumberInput({
  initialValue,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange"
> & { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <input
      {...props}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
