type ValuableAsset = {
  amount: number;
  price: number | null;
};

export function sortAssetsByValue<T extends ValuableAsset>(
  assets: readonly T[],
): T[] {
  return [...assets].sort(
    (firstAsset, secondAsset) =>
      (secondAsset.price ?? 0) * secondAsset.amount -
      (firstAsset.price ?? 0) * firstAsset.amount,
  );
}
