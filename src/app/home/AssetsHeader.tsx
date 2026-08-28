"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { NotebookPen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import CoinFilter from "@/app/home/CoinFilter";
import type { CoinOption } from "@/types/coin";

type AssetsHeaderProps = {
  coinOptions: CoinOption[];
  ledgerAdopted: boolean;
};

export default function AssetsHeader({
  coinOptions,
  ledgerAdopted,
}: AssetsHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentFilter = searchParams.get("coin") || "all";

  const handleFilterChange = (coinId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (coinId === "all") {
      params.delete("coin");
    } else {
      params.set("coin", coinId);
    }
    router.push(`?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-4">
      <h1 className="text-3xl font-semibold text-primary-950">Assets</h1>
      <CoinFilter
        coinOptions={coinOptions}
        onFilterChange={handleFilterChange}
        selectedCoinFilter={currentFilter}
      />
      <div className="flex-1 basis-full sm:basis-0" />
      <div className="flex flex-wrap gap-2">
        {ledgerAdopted ? (
          <>
            <Button asChild variant="outline">
              <Link
                href="/transactions/new?kind=TRANSFER_IN&position=new"
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New position
              </Link>
            </Button>
            <Button asChild>
              <Link
                href="/transactions/new"
                className="flex items-center gap-2"
              >
                <NotebookPen className="h-4 w-4" aria-hidden="true" />
                Record transaction
              </Link>
            </Button>
          </>
        ) : (
          <Button asChild>
            <Link href="/assets/new" className="flex items-center gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New asset
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
