"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import CoinFilter from "@/app/home/CoinFilter";
import type { CoinOption } from "@/types/coin";

type AssetsHeaderProps = {
  coinOptions: CoinOption[];
};

export default function AssetsHeader({ coinOptions }: AssetsHeaderProps) {
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
    <div className="mb-2 flex items-center gap-4">
      <h1 className="text-3xl font-semibold text-primary-950">Assets</h1>
      <CoinFilter
        coinOptions={coinOptions}
        onFilterChange={handleFilterChange}
        selectedCoinFilter={currentFilter}
      />
      <div className="flex-1" />
      <div>
        <Button asChild>
          <Link href="/assets/new" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New asset
          </Link>
        </Button>
      </div>
    </div>
  );
}

