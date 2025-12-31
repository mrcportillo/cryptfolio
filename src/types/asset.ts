import type { UserAsset } from "@prisma/client";

export type AssetWithPrice = UserAsset & {
  price: number;
};
