import type { PrismaClient } from "@prisma/client";

export async function persistSessionUser(
  client: Pick<PrismaClient, "$queryRaw">,
  user: { id: string; name: string; email: string },
) {
  // Explicit legacy columns keep login working before additive migrations.
  // Prisma upsert would also insert its new ledgerRevision default.
  await client.$queryRaw`
    INSERT INTO "User" ("id", "name", "email")
    VALUES (${user.id}, ${user.name}, ${user.email})
    ON CONFLICT ("id") DO UPDATE
    SET "name" = EXCLUDED."name", "email" = EXCLUDED."email"
    RETURNING "id"
  `;
}
