import type { UserAsset } from "@prisma/client";

export type AssetWithPrice = Pick<
  UserAsset,
  "id" | "assetId" | "assetName" | "amount" | "date"
> & {
  coinName: string;
  price: number | null;
};
