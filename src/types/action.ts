export type FieldErrors = Record<string, string>;

export type AssetActionState = {
  error?: string;
  fieldErrors?: FieldErrors;
};

export const initialAssetActionState: AssetActionState = {};
