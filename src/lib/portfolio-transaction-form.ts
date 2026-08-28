import type { TransactionFormValues } from "./portfolio-transaction-intent.ts";
import {
  absoluteDecimal,
  formatPortfolioInputDate,
} from "./portfolio-transaction-ui.ts";
import {
  isEconomicEventKind,
  type StoredLedgerEvent,
} from "../services/portfolio-transactions/domain.ts";

export function transactionFormValuesFromEvent(
  event: StoredLedgerEvent,
): TransactionFormValues {
  if (!isEconomicEventKind(event.kind)) {
    throw new Error("Only economic events can be corrected.");
  }
  const principals = event.movements.filter(
    (movement) => movement.role === "PRINCIPAL",
  );
  const feeMovement = event.movements.find(
    (movement) => movement.role === "FEE",
  );
  const swapFrom = principals.find((movement) =>
    movement.quantityDelta.startsWith("-"),
  );
  const swapTo = principals.find(
    (movement) => !movement.quantityDelta.startsWith("-"),
  );
  const principal = principals[0];

  return {
    kind: event.kind,
    occurredLocal: formatPortfolioInputDate(event.occurredAt),
    note: event.note ?? "",
    actualValueUsd: event.actualValueUsd
      ? absoluteDecimal(event.actualValueUsd)
      : "",
    positionMode: "existing",
    positionId: principal?.userAssetId ?? "",
    quantity: principal ? absoluteDecimal(principal.quantityDelta) : "",
    swapFromId: swapFrom?.userAssetId ?? "",
    swapFromQuantity: swapFrom ? absoluteDecimal(swapFrom.quantityDelta) : "",
    swapToMode: "existing",
    swapToId: swapTo?.userAssetId ?? "",
    swapToQuantity: swapTo ? absoluteDecimal(swapTo.quantityDelta) : "",
    newAssetId: "",
    newAssetName: "",
    feeEnabled: Boolean(feeMovement),
    feePositionId: feeMovement?.userAssetId ?? "",
    feeQuantity: feeMovement ? absoluteDecimal(feeMovement.quantityDelta) : "",
    feeValueUsd:
      feeMovement && event.feeUsd ? absoluteDecimal(event.feeUsd) : "",
  };
}
