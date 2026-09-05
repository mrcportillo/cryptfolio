"use server";
import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import prisma from "@/services/prisma/client";
import {
  saveImpactThreshold,
  saveAllocationTarget,
  saveScenario,
  archiveScenario,
} from "@/services/portfolio-insights/store";

export type InsightActionState = { ok: boolean; message: string };
export async function savePortfolioInsight(
  _previous: InsightActionState,
  form: FormData,
): Promise<InsightActionState> {
  const user = await requireCurrentUser();
  const field = (key: string) => {
    const value = form.get(key);
    if (typeof value !== "string" || value.length > 10000)
      throw new Error("Invalid form value.");
    return value;
  };
  try {
    const kind = field("kind");
    if (kind === "threshold")
      await saveImpactThreshold(prisma, user.id, field("minimumImpactUsd"));
    else if (kind === "allocation")
      await saveAllocationTarget(
        prisma,
        user.id,
        field("positionId"),
        field("minimumPct"),
        field("maximumPct"),
      );
    else if (kind === "scenario") {
      const shocks = form
        .getAll("assetId")
        .map((assetId, index) => ({
          assetId,
          percent: form.getAll("percent")[index],
        }));
      await saveScenario(
        prisma,
        user.id,
        field("scenarioId") || null,
        field("name"),
        shocks,
        field("creationKey"),
      );
    } else if (kind === "archive")
      await archiveScenario(prisma, user.id, field("scenarioId"));
    else throw new Error("Unknown portfolio action.");
    revalidatePath("/home");
    revalidatePath("/trend");
    revalidatePath("/scenarios");
    return {
      ok: true,
      message: kind === "archive" ? "Scenario archived." : "Saved.",
    };
  } catch (error) {
    // Validation errors are plain Error instances; Prisma diagnostics stay server-side.
    return {
      ok: false,
      message:
        error instanceof Error && error.constructor === Error
          ? error.message
          : "Unable to save. Refresh and try again.",
    };
  }
}
