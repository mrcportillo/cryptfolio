"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CoinOption } from "@/types/coin";

type CoinFilterProps = {
  coinOptions: CoinOption[];
  onFilterChange: (coinId: string) => void;
  selectedCoinFilter: string;
};

export default function CoinFilter({
  coinOptions,
  onFilterChange,
  selectedCoinFilter,
}: CoinFilterProps) {
  if (coinOptions.length === 0) {
    return null;
  }

  return (
    <Select value={selectedCoinFilter} onValueChange={onFilterChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Filter by coin" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All coins</SelectItem>
        {coinOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

