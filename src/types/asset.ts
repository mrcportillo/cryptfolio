import type { UserAsset } from "@prisma/client";

export type AssetWithPrice = Pick<
  UserAsset,
  "id" | "assetId" | "assetName" | "date"
> & {
  amount: string;
  coinName: string;
  price: number | null;
  approximateMarketValue: number | null;
};
