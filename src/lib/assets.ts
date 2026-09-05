type ValuableAsset = {
  approximateMarketValue: number | null;
};

export function sortAssetsByValue<T extends ValuableAsset>(
  assets: readonly T[],
): T[] {
  return [...assets].sort(
    (firstAsset, secondAsset) =>
      (secondAsset.approximateMarketValue ?? 0) -
      (firstAsset.approximateMarketValue ?? 0),
  );
}
