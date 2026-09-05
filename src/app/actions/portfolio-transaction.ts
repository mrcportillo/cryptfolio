"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import prisma from "@/services/prisma/client";
import { type RecordTransactionIntent } from "@/services/portfolio-transactions/domain";
import {
  createPortfolioTransactionActionHandlers,
  type TransactionActionResult,
} from "@/services/portfolio-transactions/action-handlers";
import { createPostgresTransactionStore } from "@/services/portfolio-transactions/postgres";
import {
  correctTransaction,
  recordTransaction,
  reverseTransaction,
  type CorrectionInput,
} from "@/services/portfolio-transactions/service";

export type { TransactionActionResult };

function refreshPortfolio(eventIds: string[]) {
  revalidatePath("/home");
  revalidatePath("/transactions");
  eventIds.forEach((eventId) => revalidatePath(`/transactions/${eventId}`));
}

const transactionStore = createPostgresTransactionStore(prisma);
const transactionActions = createPortfolioTransactionActionHandlers({
  requireCurrentUser,
  recordTransaction: (userId, intent) =>
    recordTransaction(transactionStore, userId, intent),
  reverseTransaction: (userId, eventId, idempotencyKey) =>
    reverseTransaction(transactionStore, userId, eventId, idempotencyKey),
  correctTransaction: (userId, input) =>
    correctTransaction(transactionStore, userId, input),
  refreshPortfolio,
  logServerError,
});

export async function recordPortfolioTransaction(
  intent: RecordTransactionIntent,
): Promise<TransactionActionResult> {
  return transactionActions.record(intent);
}

export async function reversePortfolioTransaction(
  eventId: string,
  idempotencyKey: string,
): Promise<TransactionActionResult> {
  return transactionActions.reverse(eventId, idempotencyKey);
}

export async function correctPortfolioTransaction(
  input: CorrectionInput,
): Promise<TransactionActionResult> {
  return transactionActions.correct(input);
}
