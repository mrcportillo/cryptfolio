import {
  LedgerValidationError,
  type RecordTransactionIntent,
} from "./domain.ts";
import type { CorrectionInput } from "./service.ts";

export type TransactionActionResult =
  | { ok: true; eventIds: string[] }
  | { ok: false; error: string; code?: string };

type ActionContext = Record<string, string | number | boolean | undefined>;

type MutationResult = {
  eventIds: string[];
  refreshEventIds: string[];
};

type PortfolioTransactionActionDependencies = {
  requireCurrentUser(): Promise<{ id: string }>;
  recordTransaction(
    userId: string,
    intent: RecordTransactionIntent,
  ): Promise<{ id: string }>;
  reverseTransaction(
    userId: string,
    eventId: string,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  correctTransaction(
    userId: string,
    input: CorrectionInput,
  ): Promise<{ reversal: { id: string }; replacement: { id: string } }>;
  refreshPortfolio(eventIds: string[]): Promise<void> | void;
  logServerError(
    operation: string,
    error: unknown,
    context?: ActionContext,
  ): void;
};

function validationFailure(
  error: LedgerValidationError,
): TransactionActionResult {
  return { ok: false, error: error.message, code: error.code };
}

function logWithoutMasking(
  dependencies: PortfolioTransactionActionDependencies,
  operation: string,
  error: unknown,
  context: ActionContext,
) {
  try {
    dependencies.logServerError(operation, error, context);
  } catch {
    // Logging must never replace the original write acknowledgement state.
  }
}

async function runMutation(
  dependencies: PortfolioTransactionActionDependencies,
  operation: string,
  context: ActionContext,
  mutate: () => Promise<MutationResult>,
): Promise<TransactionActionResult> {
  let result: MutationResult;
  try {
    result = await mutate();
  } catch (error) {
    if (error instanceof LedgerValidationError) {
      return validationFailure(error);
    }
    logWithoutMasking(dependencies, operation, error, context);
    throw error;
  }

  try {
    await dependencies.refreshPortfolio(result.refreshEventIds);
  } catch (error) {
    logWithoutMasking(dependencies, `${operation}.refresh`, error, {
      ...context,
      eventIds: result.refreshEventIds.join(","),
    });
  }

  return { ok: true, eventIds: result.eventIds };
}

export function createPortfolioTransactionActionHandlers(
  dependencies: PortfolioTransactionActionDependencies,
) {
  return {
    async record(
      intent: RecordTransactionIntent,
    ): Promise<TransactionActionResult> {
      const user = await dependencies.requireCurrentUser();
      return runMutation(
        dependencies,
        "portfolio-transaction.record",
        { userId: user.id },
        async () => {
          const event = await dependencies.recordTransaction(user.id, intent);
          return { eventIds: [event.id], refreshEventIds: [event.id] };
        },
      );
    },

    async reverse(
      eventId: string,
      idempotencyKey: string,
    ): Promise<TransactionActionResult> {
      const user = await dependencies.requireCurrentUser();
      return runMutation(
        dependencies,
        "portfolio-transaction.reverse",
        { userId: user.id, eventId },
        async () => {
          const event = await dependencies.reverseTransaction(
            user.id,
            eventId,
            idempotencyKey,
          );
          return {
            eventIds: [event.id],
            refreshEventIds: [eventId, event.id],
          };
        },
      );
    },

    async correct(input: CorrectionInput): Promise<TransactionActionResult> {
      const user = await dependencies.requireCurrentUser();
      return runMutation(
        dependencies,
        "portfolio-transaction.correct",
        { userId: user.id, eventId: input.eventId },
        async () => {
          const result = await dependencies.correctTransaction(user.id, input);
          return {
            eventIds: [result.reversal.id, result.replacement.id],
            refreshEventIds: [
              input.eventId,
              result.reversal.id,
              result.replacement.id,
            ],
          };
        },
      );
    },
  };
}
