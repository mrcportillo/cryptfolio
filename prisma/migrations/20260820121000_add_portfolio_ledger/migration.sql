-- Expand-only ledger foundation. Legacy amounts and archives intentionally remain.

-- CreateEnum
CREATE TYPE "PortfolioEventKind" AS ENUM (
    'OPENING_BALANCE',
    'BUY',
    'SELL',
    'TRANSFER_IN',
    'TRANSFER_OUT',
    'SWAP',
    'FEE',
    'REVERSAL'
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "ledgerAdoptedAt" TIMESTAMP(3);

-- CreateIndex required by composite owner-scoped foreign keys
CREATE UNIQUE INDEX "UserAsset_id_userId_key" ON "UserAsset"("id", "userId");

-- CreateTable
CREATE TABLE "PortfolioEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PortfolioEventKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "externalFlowUsd" DECIMAL(65,30),
    "feeUsd" DECIMAL(65,30),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "openingForUserAssetId" TEXT,
    "reversalOfEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PortfolioEvent_opening_shape_check" CHECK (
        ("kind" = 'OPENING_BALANCE' AND "openingForUserAssetId" IS NOT NULL)
        OR
        ("kind" <> 'OPENING_BALANCE' AND "openingForUserAssetId" IS NULL)
    ),
    CONSTRAINT "PortfolioEvent_opening_zero_flow_check" CHECK (
        "kind" <> 'OPENING_BALANCE'
        OR (
            "externalFlowUsd" IS NOT NULL
            AND "externalFlowUsd" = 0
            AND "feeUsd" IS NOT NULL
            AND "feeUsd" = 0
        )
    ),
    CONSTRAINT "PortfolioEvent_reversal_shape_check" CHECK (
        ("kind" = 'REVERSAL' AND "reversalOfEventId" IS NOT NULL)
        OR
        ("kind" <> 'REVERSAL' AND "reversalOfEventId" IS NULL)
    ),
    CONSTRAINT "PortfolioEvent_fee_sign_check" CHECK (
        "kind" = 'REVERSAL' OR "feeUsd" IS NULL OR "feeUsd" >= 0
    ),
    CONSTRAINT "PortfolioEvent_not_self_reversal_check" CHECK (
        "reversalOfEventId" IS NULL OR "id" <> "reversalOfEventId"
    )
);

-- CreateTable
CREATE TABLE "AssetMovement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "portfolioEventId" TEXT NOT NULL,
    "userAssetId" TEXT NOT NULL,
    "quantityDelta" DECIMAL(65,30) NOT NULL,
    "unitPriceUsd" DECIMAL(65,30),
    "priceEstimated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetMovement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssetMovement_nonzero_quantity_check" CHECK ("quantityDelta" <> 0),
    CONSTRAINT "AssetMovement_positive_unit_price_check" CHECK (
        "unitPriceUsd" IS NULL OR "unitPriceUsd" > 0
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioEvent_id_userId_key" ON "PortfolioEvent"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioEvent_userId_idempotencyKey_key" ON "PortfolioEvent"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioEvent_openingForUserAssetId_userId_key" ON "PortfolioEvent"("openingForUserAssetId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioEvent_reversalOfEventId_userId_key" ON "PortfolioEvent"("reversalOfEventId", "userId");

-- CreateIndex
CREATE INDEX "PortfolioEvent_userId_occurredAt_id_idx" ON "PortfolioEvent"("userId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "AssetMovement_userId_userAssetId_createdAt_id_idx" ON "AssetMovement"("userId", "userAssetId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AssetMovement_userId_portfolioEventId_idx" ON "AssetMovement"("userId", "portfolioEventId");

-- AddForeignKey
ALTER TABLE "PortfolioEvent" ADD CONSTRAINT "PortfolioEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioEvent" ADD CONSTRAINT "PortfolioEvent_openingForUserAssetId_userId_fkey" FOREIGN KEY ("openingForUserAssetId", "userId") REFERENCES "UserAsset"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioEvent" ADD CONSTRAINT "PortfolioEvent_reversalOfEventId_userId_fkey" FOREIGN KEY ("reversalOfEventId", "userId") REFERENCES "PortfolioEvent"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMovement" ADD CONSTRAINT "AssetMovement_portfolioEventId_userId_fkey" FOREIGN KEY ("portfolioEventId", "userId") REFERENCES "PortfolioEvent"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMovement" ADD CONSTRAINT "AssetMovement_userAssetId_userId_fkey" FOREIGN KEY ("userAssetId", "userId") REFERENCES "UserAsset"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Opening events are complete only when exactly one movement points to the
-- opening position. Deferred constraint triggers allow the event and movement
-- to be inserted in either order inside one transaction, then validate the
-- final transaction state before commit.
CREATE FUNCTION "assert_opening_event_movement"(target_event_id TEXT)
RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    opening_kind "PortfolioEventKind";
    opening_user_id TEXT;
    opening_asset_id TEXT;
    movement_count BIGINT;
    matching_movement_count BIGINT;
BEGIN
    SELECT "kind", "userId", "openingForUserAssetId"
    INTO opening_kind, opening_user_id, opening_asset_id
    FROM "PortfolioEvent"
    WHERE "id" = target_event_id;

    IF NOT FOUND OR opening_kind <> 'OPENING_BALANCE' THEN
        RETURN;
    END IF;

    SELECT
        count(*),
        count(*) FILTER (
            WHERE "userId" = opening_user_id
              AND "userAssetId" = opening_asset_id
        )
    INTO movement_count, matching_movement_count
    FROM "AssetMovement"
    WHERE "portfolioEventId" = target_event_id;

    IF movement_count <> 1 OR matching_movement_count <> 1 THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'PortfolioEvent_exactly_one_opening_movement_check',
            MESSAGE = format(
                'Opening event %s requires exactly one movement for position %s',
                target_event_id,
                opening_asset_id
            );
    END IF;
END;
$$;

CREATE FUNCTION "enforce_opening_event_movement"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
    IF TG_TABLE_NAME = 'PortfolioEvent' THEN
        IF TG_OP <> 'DELETE' THEN
            PERFORM "assert_opening_event_movement"(NEW."id");
        END IF;

        IF TG_OP = 'UPDATE' AND OLD."id" IS DISTINCT FROM NEW."id" THEN
            PERFORM "assert_opening_event_movement"(OLD."id");
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            PERFORM "assert_opening_event_movement"(OLD."portfolioEventId");
        END IF;

        IF TG_OP <> 'DELETE' AND (
            TG_OP = 'INSERT'
            OR OLD."portfolioEventId" IS DISTINCT FROM NEW."portfolioEventId"
            OR OLD."userAssetId" IS DISTINCT FROM NEW."userAssetId"
            OR OLD."userId" IS DISTINCT FROM NEW."userId"
        ) THEN
            PERFORM "assert_opening_event_movement"(NEW."portfolioEventId");
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "PortfolioEvent_exactly_one_opening_movement_check"
AFTER INSERT OR UPDATE OR DELETE ON "PortfolioEvent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_opening_event_movement"();

CREATE CONSTRAINT TRIGGER "AssetMovement_exactly_one_opening_movement_check"
AFTER INSERT OR UPDATE OR DELETE ON "AssetMovement"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_opening_event_movement"();
