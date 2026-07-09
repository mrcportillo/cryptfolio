"use client";
import { useCallback, useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Buttons from "@/components/forms/Buttons";
import FieldError from "@/components/forms/FieldError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AssetActionState } from "@/types/action";
import { initialAssetActionState } from "@/types/action";

type AutoCloseOnSubmitProps = {
  onClose: () => void;
  state: AssetActionState;
};

const AutoCloseOnSubmit = ({ onClose, state }: AutoCloseOnSubmitProps) => {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }

    if (
      wasPending.current &&
      !state.error &&
      Object.keys(state.fieldErrors ?? {}).length === 0
    ) {
      wasPending.current = false;
      onClose();
      router.refresh();
    }
  }, [pending, onClose, router, state]);

  return null;
};

type AssetEditPanelProps = {
  assetId: string;
  assetName: string;
  coinId: string;
  coinName: string;
  amount: number;
  formAction: (
    previousState: AssetActionState,
    formData: FormData,
  ) => Promise<AssetActionState>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function AssetEditPanel({
  assetId,
  assetName,
  coinId,
  coinName,
  amount,
  formAction,
  open,
  onOpenChange,
}: AssetEditPanelProps) {
  const [state, action] = useFormState(formAction, initialAssetActionState);
  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit asset</SheetTitle>
        </SheetHeader>
        <form className="mt-6 flex flex-col gap-4" action={action}>
          <AutoCloseOnSubmit onClose={handleClose} state={state} />
          {state.error ? (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {state.error}
            </p>
          ) : null}
          <input type="hidden" name="id" value={assetId} />
          <input type="hidden" name="coin" value={coinId} />
          <div className="grid gap-2">
            <Label htmlFor="name">Alias</Label>
            <Input
              id="name"
              name="name"
              type="text"
              required
              maxLength={80}
              defaultValue={assetName}
              aria-invalid={Boolean(state.fieldErrors?.name)}
            />
            <FieldError message={state.fieldErrors?.name} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="coin">Coin</Label>
            <Input
              id="coin"
              value={coinName}
              readOnly
              aria-describedby="coin-help"
            />
            <p id="coin-help" className="text-xs text-muted-foreground">
              The coin cannot be changed after an asset is created.
            </p>
          </div>
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
              defaultValue={amount}
              aria-invalid={Boolean(state.fieldErrors?.amount)}
            />
            <FieldError message={state.fieldErrors?.amount} />
          </div>
          <Buttons
            cancelLabel="Cancel"
            confirmLabel="Save"
            onCancel={handleClose}
          />
        </form>
      </SheetContent>
    </Sheet>
  );
}
