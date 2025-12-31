"use client";
import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import Buttons from "@/components/forms/Buttons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CoinOption } from "@/types/coin";

type AutoCloseOnSubmitProps = {
  onClose: () => void;
};

const AutoCloseOnSubmit = ({ onClose }: AutoCloseOnSubmitProps) => {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }

    if (wasPending.current) {
      wasPending.current = false;
      onClose();
      router.refresh();
    }
  }, [pending, onClose, router]);

  return null;
};

type AssetEditPanelProps = {
  assetId: string;
  assetName: string;
  coinId: string;
  amount: number;
  coinOptions: CoinOption[];
  formAction: (formData: FormData) => void | Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function AssetEditPanel({
  assetId,
  assetName,
  coinId,
  amount,
  coinOptions,
  formAction,
  open,
  onOpenChange,
}: AssetEditPanelProps) {
  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>Edit asset</SheetTitle>
        </SheetHeader>
        <form className="mt-6 flex flex-col gap-4" action={formAction}>
          <AutoCloseOnSubmit onClose={handleClose} />
          <input type="hidden" name="id" value={assetId} />
          <div className="grid gap-2">
            <Label htmlFor="name">Alias</Label>
            <Input
              id="name"
              name="name"
              type="text"
              required
              defaultValue={assetName}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="coin">Coin</Label>
            <Select name="coin" defaultValue={coinId} disabled>
              <SelectTrigger id="coin">
                <SelectValue placeholder="Select a coin" />
              </SelectTrigger>
              <SelectContent>
                {coinOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              name="amount"
              type="d"
              step="any"
              required
              defaultValue={amount}
            />
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
