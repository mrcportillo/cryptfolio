"use client";

import { useFormState } from "react-dom";
import { create } from "@/app/actions/asset";
import Buttons from "@/components/forms/Buttons";
import CoinPicker from "@/components/forms/CoinPicker";
import FieldError from "@/components/forms/FieldError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CoinOption } from "@/types/coin";
import { initialAssetActionState } from "@/types/action";

type NewAssetFormProps = {
  coinOptions: CoinOption[];
  loadError?: string;
};

export default function NewAssetForm({
  coinOptions,
  loadError,
}: NewAssetFormProps) {
  const [state, formAction] = useFormState(create, initialAssetActionState);

  return (
    <form className="flex flex-col gap-4" action={formAction}>
      {loadError ? (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}
      {state.error ? (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="name">Alias</Label>
        <Input
          id="name"
          name="name"
          type="text"
          maxLength={80}
          required
          aria-invalid={Boolean(state.fieldErrors?.name)}
        />
        <FieldError message={state.fieldErrors?.name} />
      </div>
      <CoinPicker
        name="coin"
        label="Coin"
        options={coinOptions}
        error={state.fieldErrors?.coin}
      />
      <div className="grid gap-2">
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          inputMode="decimal"
          min="0.000000000000000001"
          step="any"
          required
          aria-invalid={Boolean(state.fieldErrors?.amount)}
        />
        <FieldError message={state.fieldErrors?.amount} />
      </div>
      <Buttons
        cancelLabel="Cancel"
        confirmLabel="Save"
        cancelHref="/home"
        disabled={coinOptions.length === 0 || Boolean(loadError)}
      />
    </form>
  );
}
