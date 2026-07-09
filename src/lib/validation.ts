import type { FieldErrors } from "@/types/action";

export const MAX_ASSET_NAME_LENGTH = 80;
export const MAX_ASSET_AMOUNT = 1e30;

export type AssetFormValues = {
  id?: string;
  assetId: string;
  assetName: string;
  amount: number;
};

export type AssetValidationResult = {
  values?: AssetFormValues;
  fieldErrors?: FieldErrors;
};

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isValidCoinId(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function validateAssetFormData(
  formData: FormData,
  options: { requireId?: boolean; requireCoin?: boolean } = {},
): AssetValidationResult {
  const { requireId = false, requireCoin = true } = options;
  const fieldErrors: FieldErrors = {};
  const id = readString(formData, "id");
  const assetId = readString(formData, "coin");
  const assetName = readString(formData, "name");
  const amountValue = readString(formData, "amount");
  const amount = Number(amountValue);

  if (requireId && (!id || id.length > 64)) {
    fieldErrors.id = "The asset identifier is invalid.";
  }

  if (requireCoin && (!assetId || !isValidCoinId(assetId))) {
    fieldErrors.coin = "Select a valid coin.";
  }

  if (!assetName) {
    fieldErrors.name = "Enter an alias.";
  } else if (assetName.length > MAX_ASSET_NAME_LENGTH) {
    fieldErrors.name = `Use ${MAX_ASSET_NAME_LENGTH} characters or fewer.`;
  }

  if (
    !amountValue ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > MAX_ASSET_AMOUNT
  ) {
    fieldErrors.amount = "Enter a finite amount greater than zero.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  return {
    values: {
      ...(id ? { id } : {}),
      assetId,
      assetName,
      amount,
    },
  };
}
