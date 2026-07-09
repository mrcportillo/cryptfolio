"use client";

import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { CoinOption } from "@/types/coin";

type CoinPickerProps = {
  name: string;
  label: string;
  options: CoinOption[];
  initialValue?: string;
  error?: string;
};

export default function CoinPicker({
  name,
  label,
  options,
  initialValue = "",
  error,
}: CoinPickerProps) {
  const [query, setQuery] = useState("");
  const [loadedOptions, setLoadedOptions] = useState(options);
  const [value, setValue] = useState(initialValue);
  const [nextPage, setNextPage] = useState(2);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return loadedOptions;
    }

    return loadedOptions.filter((option) =>
      `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery),
    );
  }, [loadedOptions, query]);

  const loadMore = async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch(`/api/coin/list?pageSize=100&page=${nextPage}`);
      if (!response.ok) {
        throw new Error("Could not load more coins");
      }

      const additionalCoins = (await response.json()) as Array<{
        id: string;
        name: string;
      }>;
      const additionalOptions: CoinOption[] = additionalCoins.map((coin) => ({
        value: coin.id,
        label: coin.name,
      }));
      setLoadedOptions((current) => {
        const merged = new Map(current.map((option) => [option.value, option]));
        additionalOptions.forEach((option) => merged.set(option.value, option));
        return Array.from(merged.values());
      });
      setHasMore(additionalOptions.length === 100);
      setNextPage((page) => page + 1);
    } catch {
      setLoadError("We could not load more coins. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${name}-search`}>{label}</Label>
      <Input
        id={`${name}-search`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search coins"
        autoComplete="off"
        aria-describedby={error ? `${name}-error` : undefined}
      />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger id={name} aria-invalid={Boolean(error)}>
          <SelectValue placeholder="Select a coin" />
        </SelectTrigger>
        <SelectContent>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))
          ) : (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No coins match your search.
            </div>
          )}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={loadMore}
        disabled={loading || !hasMore}
      >
        {loading
          ? "Loading coins..."
          : hasMore
            ? "Load more coins"
            : "All coins loaded"}
      </Button>
      {loadError ? (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      ) : null}
      <input type="hidden" name={name} value={value} />
      {error ? (
        <p
          id={`${name}-error`}
          className="text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
