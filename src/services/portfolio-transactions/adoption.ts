import type { PrismaClient } from "@prisma/client";

/** Read the rollout marker without requiring the additive ledger migration. */
export async function readLedgerAdoption(
  client: Pick<PrismaClient, "$queryRaw">,
  userId: string,
): Promise<Date | null> {
  // JSON extraction returns NULL when the legacy User row has no such field.
  // Do not catch arbitrary database errors or use legacy quantities for an
  // adopted owner: a broken ledger must never look like an unadopted portfolio.
  const users = await client.$queryRaw<Array<{ ledgerAdoptedAt: Date | null }>>`
    SELECT (to_jsonb(owner)->>'ledgerAdoptedAt')::timestamp(3) AS "ledgerAdoptedAt"
    FROM "User" AS owner
    WHERE owner."id" = ${userId}
  `;
  return users[0]?.ledgerAdoptedAt ?? null;
}
