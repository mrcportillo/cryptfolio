"use client";
import { useFormStatus } from "react-dom";

export default function Buttons({ cancelLabel, confirmLabel }) {
  const { pending } = useFormStatus();

  return (
    <div className="ml-auto mt-3">
      <button className=" w-40 rounded-md bg-red-800 p-2 text-white">
        {cancelLabel}
      </button>
      <input
        className={`ml-2 w-40 cursor-pointer rounded-md bg-green-800 p-2 text-white ${pending && "cursor-not-allowed opacity-50"}`}
        type="submit"
        value={confirmLabel}
        disabled={pending}
      />
    </div>
  );
}
