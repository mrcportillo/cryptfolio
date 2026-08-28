"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { createPagedRequestGate } from "@/lib/client-operation-guard";

type CoinPickerProps = {
  name: string;
  label: string;
  options: CoinOption[];
  initialValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  error?: string;
  disabled?: boolean;
};

export default function CoinPicker({
  name,
  label,
  options,
  initialValue = "",
  value: controlledValue,
  onValueChange,
  error,
  disabled = false,
}: CoinPickerProps) {
  const mountedRef = useRef(false);
  const requestGate = useRef(createPagedRequestGate()).current;
  const [query, setQuery] = useState("");
  const [loadedOptions, setLoadedOptions] = useState(options);
  const [internalValue, setInternalValue] = useState(initialValue);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const value = controlledValue ?? internalValue;
  const setValue = (nextValue: string) => {
    if (disabled) return;
    setInternalValue(nextValue);
    onValueChange?.(nextValue);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGate.abort();
    };
  }, [requestGate]);

  useEffect(() => {
    if (!disabled) return;
    requestGate.abort();
    setLoading(false);
  }, [disabled, requestGate]);
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
    if (disabled) return;
    const request = requestGate.begin();
    if (!request) return;
    setLoading(true);
    setLoadError(null);
    let advance = false;

    try {
      const response = await fetch(
        `/api/coin/list?pageSize=100&page=${request.page}`,
        { signal: request.controller.signal },
      );
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
      if (
        !mountedRef.current ||
        request.controller.signal.aborted ||
        !requestGate.isCurrent(request)
      ) {
        return;
      }
      setLoadedOptions((current) => {
        const merged = new Map(current.map((option) => [option.value, option]));
        additionalOptions.forEach((option) => merged.set(option.value, option));
        return Array.from(merged.values());
      });
      setHasMore(additionalOptions.length === 100);
      advance = true;
    } catch {
      if (
        mountedRef.current &&
        requestGate.isCurrent(request) &&
        !request.controller.signal.aborted
      ) {
        setLoadError("We could not load more coins. Please try again.");
      }
    } finally {
      if (requestGate.finish(request, advance) && mountedRef.current) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${name}-search`}>{label}</Label>
      <Input
        id={`${name}-search`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
        placeholder="Search coins"
        autoComplete="off"
        aria-describedby={error ? `${name}-error` : undefined}
      />
      <Select value={value} onValueChange={setValue} disabled={disabled}>
        <SelectTrigger
          id={name}
          aria-label={`${label} selection`}
          aria-describedby={error ? `${name}-error` : undefined}
          aria-invalid={Boolean(error)}
        >
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
        disabled={disabled || loading || !hasMore}
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
