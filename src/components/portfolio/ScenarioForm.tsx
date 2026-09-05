"use client";
import { useState } from "react";
import type { Shock } from "@/services/portfolio-insights/domain";
import InsightForm from "./InsightForm";

export default function ScenarioForm({
  scenario,
  coins,
  creationKey = "",
}: {
  scenario?: { id: string; name: string; shocks: Shock[] };
  coins: string[];
  creationKey?: string;
}) {
  const [key] = useState(creationKey);
  const [name, setName] = useState(scenario?.name ?? "");
  const [rows, setRows] = useState(
    scenario?.shocks ?? [{ assetId: coins[0] ?? "", percent: "-20" }],
  );
  return (
    <InsightForm label={scenario ? "Save changes" : "Save scenario"}>
      <input type="hidden" name="kind" value="scenario" />
      <input type="hidden" name="scenarioId" value={scenario?.id ?? ""} />
      <input type="hidden" name="creationKey" value={key} />
      <label className="block text-sm font-medium">
        Scenario name
        <input
          name="name"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="A difficult week"
          className="mt-1 block w-full rounded-md border border-primary-200 p-2"
        />
      </label>
      <p className="text-xs text-slate-600">
        Each shock changes a coin price by −100% to +1,000%. Other coins keep
        their current prices.
      </p>
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-2 rounded-lg bg-primary-50 p-3"
          >
            <label className="min-w-0 text-sm">
              Coin ID
              <input
                name="assetId"
                required
                maxLength={160}
                value={row.assetId}
                onChange={(event) =>
                  setRows(
                    rows.map((value, i) =>
                      i === index
                        ? { ...value, assetId: event.target.value }
                        : value,
                    ),
                  )
                }
                placeholder="bitcoin"
                className="mt-1 w-full rounded border border-primary-200 p-2"
              />
            </label>
            <label className="text-sm">
              Shock %
              <input
                name="percent"
                type="number"
                required
                min="-100"
                max="1000"
                step="0.01"
                value={row.percent}
                onChange={(event) =>
                  setRows(
                    rows.map((value, i) =>
                      i === index
                        ? { ...value, percent: event.target.value }
                        : value,
                    ),
                  )
                }
                className="mt-1 w-full rounded border border-primary-200 p-2"
              />
            </label>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                className="col-span-2 justify-self-end text-xs font-medium underline"
                aria-label={`Remove shock ${index + 1}`}
              >
                Remove shock
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <button
          type="button"
          disabled={rows.length >= 20}
          onClick={() => setRows([...rows, { assetId: "", percent: "-20" }])}
          className="rounded border border-primary-200 px-3 py-2 text-sm font-medium text-primary-900 disabled:opacity-50"
        >
          Add coin shock
        </button>
        <span>
          Current coins:{" "}
          {coins.length ? coins.join(", ") : "No positive holdings"}
        </span>
      </div>
    </InsightForm>
  );
}
