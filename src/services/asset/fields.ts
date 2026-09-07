// Columns available both before and after the additive portfolio migrations.
export const legacyAssetFields = {
  id: true,
  userId: true,
  assetId: true,
  assetName: true,
  amount: true,
  date: true,
} as const;
