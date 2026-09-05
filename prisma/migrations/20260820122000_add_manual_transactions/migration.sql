-- Expand the immutable ledger for manual transactions. Legacy quantities and
-- archives remain in place for pre-adoption users and rollback evidence.

CREATE TYPE "AssetMovementRole" AS ENUM ('PRINCIPAL', 'FEE');

ALTER TABLE "UserAsset"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "ledgerInitialAssetName" VARCHAR(80);

ALTER TABLE "PortfolioEvent"
  ADD COLUMN "actualValueUsd" DECIMAL(65,30),
  ADD COLUMN "note" VARCHAR(500),
  ADD COLUMN "replacementForEventId" TEXT;

ALTER TABLE "AssetMovement"
  ADD COLUMN "role" "AssetMovementRole" NOT NULL DEFAULT 'PRINCIPAL';

CREATE INDEX "UserAsset_userId_archivedAt_date_idx"
  ON "UserAsset"("userId", "archivedAt", "date");

CREATE UNIQUE INDEX "PortfolioEvent_replacementForEventId_userId_key"
  ON "PortfolioEvent"("replacementForEventId", "userId");

CREATE UNIQUE INDEX "AssetMovement_portfolioEventId_userAssetId_role_key"
  ON "AssetMovement"("portfolioEventId", "userAssetId", "role");

ALTER TABLE "PortfolioEvent"
  ADD CONSTRAINT "PortfolioEvent_replacementForEventId_userId_fkey"
  FOREIGN KEY ("replacementForEventId", "userId")
  REFERENCES "PortfolioEvent"("id", "userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PortfolioEvent"
  ADD CONSTRAINT "PortfolioEvent_actual_value_sign_check" CHECK (
    "actualValueUsd" IS NULL
    OR ("kind" = 'REVERSAL' AND "actualValueUsd" <= 0)
    OR ("kind" <> 'REVERSAL' AND "actualValueUsd" > 0)
  ),
  ADD CONSTRAINT "PortfolioEvent_replacement_shape_check" CHECK (
    "replacementForEventId" IS NULL
    OR "kind" NOT IN ('OPENING_BALANCE', 'REVERSAL')
  ),
  ADD CONSTRAINT "PortfolioEvent_not_self_replacement_check" CHECK (
    "replacementForEventId" IS NULL OR "id" <> "replacementForEventId"
  ),
  ADD CONSTRAINT "PortfolioEvent_note_length_check" CHECK (
    "note" IS NULL OR char_length("note") <= 500
  ),
  ADD CONSTRAINT "PortfolioEvent_opening_actual_value_check" CHECK (
    "kind" <> 'OPENING_BALANCE' OR "actualValueUsd" IS NULL
  ),
  ADD CONSTRAINT "PortfolioEvent_finite_actual_value_check" CHECK (
    "actualValueUsd" IS NULL
    OR lower("actualValueUsd"::text) NOT IN ('nan', 'infinity', '-infinity')
  ),
  ADD CONSTRAINT "PortfolioEvent_finite_external_flow_check" CHECK (
    "externalFlowUsd" IS NULL
    OR lower("externalFlowUsd"::text) NOT IN ('nan', 'infinity', '-infinity')
  ),
  ADD CONSTRAINT "PortfolioEvent_finite_fee_check" CHECK (
    "feeUsd" IS NULL
    OR lower("feeUsd"::text) NOT IN ('nan', 'infinity', '-infinity')
  ),
  ADD CONSTRAINT "PortfolioEvent_finite_occurred_at_check" CHECK (
    isfinite("occurredAt")
  ),
  ADD CONSTRAINT "PortfolioEvent_finite_created_at_check" CHECK (
    isfinite("createdAt")
  );

ALTER TABLE "AssetMovement"
  ADD CONSTRAINT "AssetMovement_finite_quantity_check" CHECK (
    lower("quantityDelta"::text) NOT IN ('nan', 'infinity', '-infinity')
  ),
  ADD CONSTRAINT "AssetMovement_finite_unit_price_check" CHECK (
    "unitPriceUsd" IS NULL
    OR lower("unitPriceUsd"::text) NOT IN ('nan', 'infinity', '-infinity')
  ),
  ADD CONSTRAINT "AssetMovement_finite_created_at_check" CHECK (
    isfinite("createdAt")
  );

ALTER TABLE "User"
  ADD CONSTRAINT "User_finite_ledger_adopted_at_check" CHECK (
    "ledgerAdoptedAt" IS NULL OR isfinite("ledgerAdoptedAt")
  );

ALTER TABLE "UserAsset"
  ADD CONSTRAINT "UserAsset_finite_amount_check" CHECK (
    lower("amount"::text) NOT IN ('nan', 'infinity', '-infinity')
  ),
  ADD CONSTRAINT "UserAsset_finite_date_check" CHECK (isfinite("date")),
  ADD CONSTRAINT "UserAsset_finite_archived_at_check" CHECK (
    "archivedAt" IS NULL OR isfinite("archivedAt")
  );

ALTER TABLE "AssetArchive"
  ADD CONSTRAINT "AssetArchive_finite_amount_check" CHECK (
    lower("amount"::text) NOT IN ('nan', 'infinity', '-infinity')
  ),
  ADD CONSTRAINT "AssetArchive_finite_date_check" CHECK (isfinite("date"));

-- The opening v1 fingerprint deliberately excludes movement role. Existing
-- opening rows receive PRINCIPAL through the column default, so v1 evidence is
-- byte-for-byte stable while the opening shape becomes more explicit.
CREATE OR REPLACE FUNCTION "assert_opening_event_movement"(target_event_id TEXT)
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
              AND "role" = 'PRINCIPAL'
              AND "quantityDelta" > 0
        )
    INTO movement_count, matching_movement_count
    FROM "AssetMovement"
    WHERE "portfolioEventId" = target_event_id;

    IF movement_count <> 1 OR matching_movement_count <> 1 THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'PortfolioEvent_exactly_one_opening_movement_check',
            MESSAGE = format(
                'Opening event %s requires exactly one positive principal movement for position %s',
                target_event_id,
                opening_asset_id
            );
    END IF;
END;
$$;

CREATE FUNCTION "assert_ledger_adoption_boundary"(
    target_user_id TEXT,
    target_adoption_at TIMESTAMP(3)
)
RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "UserAsset" position
        WHERE position."userId" = target_user_id
          AND (
              position."amount"::text IN ('NaN', 'Infinity', '-Infinity')
              OR position."amount" < 0
          )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'User_ledger_adoption_boundary_check',
            MESSAGE = 'Ledger adoption requires finite, nonnegative legacy positions';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "UserAsset" position
        WHERE position."userId" = target_user_id
          AND position."date" > target_adoption_at
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'User_ledger_adoption_boundary_check',
            MESSAGE = 'Ledger adoption cannot precede a legacy position timestamp';
    END IF;

    -- Every positive legacy position must have one exact opening at the new
    -- boundary. The numeric cast also rejects values that cannot be represented
    -- by the ledger precision.
    IF EXISTS (
        SELECT 1
        FROM "UserAsset" position
        WHERE position."userId" = target_user_id
          AND position."amount" > 0
          AND NOT EXISTS (
              SELECT 1
              FROM "PortfolioEvent" event
              WHERE event."userId" = target_user_id
                AND event."kind" = 'OPENING_BALANCE'
                AND event."openingForUserAssetId" = position."id"
                AND event."occurredAt" = target_adoption_at
                AND event."actualValueUsd" IS NULL
                AND event."externalFlowUsd" = 0
                AND event."feeUsd" = 0
                AND event."note" IS NULL
                AND event."idempotencyKey" = 'opening:v1:' || position."id"
                AND (
                    SELECT count(*)
                    FROM "AssetMovement" movement
                    WHERE movement."portfolioEventId" = event."id"
                      AND movement."userId" = target_user_id
                      AND movement."userAssetId" = position."id"
                      AND movement."role" = 'PRINCIPAL'
                      AND movement."quantityDelta" = position."amount"::text::numeric(65,30)
                      AND movement."quantityDelta" > 0
                      AND movement."unitPriceUsd" IS NULL
                      AND movement."priceEstimated" = false
                ) = 1
                AND (
                    SELECT count(*)
                    FROM "AssetMovement" movement
                    WHERE movement."portfolioEventId" = event."id"
                ) = 1
          )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'User_ledger_adoption_boundary_check',
            MESSAGE = 'Ledger adoption is missing an exact positive opening balance';
    END IF;

    -- Zero positions must not receive openings, and every opening must be one
    -- of the exact positive-position records accepted above.
    IF EXISTS (
        SELECT 1
        FROM "PortfolioEvent" event
        WHERE event."userId" = target_user_id
          AND event."kind" = 'OPENING_BALANCE'
          AND NOT EXISTS (
              SELECT 1
              FROM "UserAsset" position
              WHERE position."id" = event."openingForUserAssetId"
                AND position."userId" = target_user_id
                AND position."amount" > 0
                AND event."occurredAt" = target_adoption_at
                AND event."actualValueUsd" IS NULL
                AND event."externalFlowUsd" = 0
                AND event."feeUsd" = 0
                AND event."note" IS NULL
                AND event."idempotencyKey" = 'opening:v1:' || position."id"
                AND (
                    SELECT count(*)
                    FROM "AssetMovement" movement
                    WHERE movement."portfolioEventId" = event."id"
                      AND movement."userId" = target_user_id
                      AND movement."userAssetId" = position."id"
                      AND movement."role" = 'PRINCIPAL'
                      AND movement."quantityDelta" = position."amount"::text::numeric(65,30)
                      AND movement."quantityDelta" > 0
                      AND movement."unitPriceUsd" IS NULL
                      AND movement."priceEstimated" = false
                ) = 1
                AND (
                    SELECT count(*)
                    FROM "AssetMovement" movement
                    WHERE movement."portfolioEventId" = event."id"
                ) = 1
          )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'User_ledger_adoption_boundary_check',
            MESSAGE = 'Ledger adoption contains an unexpected or malformed opening balance';
    END IF;
END;
$$;

CREATE FUNCTION "guard_ledger_adoption_boundary"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."ledgerAdoptedAt" IS NOT NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'User_ledger_adoption_boundary_check',
                MESSAGE = 'A user must be created before its ledger can be adopted';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD."ledgerAdoptedAt" IS NOT NULL
       AND NEW."ledgerAdoptedAt" IS DISTINCT FROM OLD."ledgerAdoptedAt" THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'User_ledger_adoption_boundary_immutable_check',
            MESSAGE = 'The ledger adoption boundary is immutable once set';
    END IF;

    IF OLD."ledgerAdoptedAt" IS NULL AND NEW."ledgerAdoptedAt" IS NOT NULL THEN
        -- Capture the mutable display alias used by the v1 legacy fingerprint.
        -- Later alias edits remain allowed without making retries look like a
        -- different cutover or weakening idempotency-key reuse checks.
        UPDATE "UserAsset"
        SET "ledgerInitialAssetName" = "assetName"
        WHERE "userId" = NEW."id"
          AND "ledgerInitialAssetName" IS NULL;

        PERFORM "assert_ledger_adoption_boundary"(NEW."id", NEW."ledgerAdoptedAt");
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "User_ledger_adoption_boundary_guard"
BEFORE INSERT OR UPDATE ON "User"
FOR EACH ROW
EXECUTE FUNCTION "guard_ledger_adoption_boundary"();

CREATE FUNCTION "assert_manual_event_semantics"(target_event_id TEXT)
RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    target "PortfolioEvent"%ROWTYPE;
    original "PortfolioEvent"%ROWTYPE;
    principal_count BIGINT;
    positive_principal_count BIGINT;
    negative_principal_count BIGINT;
    fee_count BIGINT;
    negative_fee_count BIGINT;
    movement_count BIGINT;
    original_movement_count BIGINT;
    owner_adopted_at TIMESTAMP(3);
BEGIN
    SELECT * INTO target
    FROM "PortfolioEvent"
    WHERE "id" = target_event_id;

    IF NOT FOUND OR target."kind" = 'OPENING_BALANCE' THEN
        RETURN;
    END IF;

    SELECT "ledgerAdoptedAt" INTO owner_adopted_at
    FROM "User"
    WHERE "id" = target."userId";

    IF owner_adopted_at IS NULL OR target."occurredAt" < owner_adopted_at THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
            MESSAGE = format('Manual event %s is outside the adopted ledger boundary', target_event_id);
    END IF;

    SELECT
        count(*),
        count(*) FILTER (WHERE "role" = 'PRINCIPAL'),
        count(*) FILTER (WHERE "role" = 'PRINCIPAL' AND "quantityDelta" > 0),
        count(*) FILTER (WHERE "role" = 'PRINCIPAL' AND "quantityDelta" < 0),
        count(*) FILTER (WHERE "role" = 'FEE'),
        count(*) FILTER (WHERE "role" = 'FEE' AND "quantityDelta" < 0)
    INTO
        movement_count,
        principal_count,
        positive_principal_count,
        negative_principal_count,
        fee_count,
        negative_fee_count
    FROM "AssetMovement"
    WHERE "portfolioEventId" = target_event_id
      AND "userId" = target."userId";

    IF target."kind" = 'REVERSAL' THEN
        SELECT * INTO original
        FROM "PortfolioEvent"
        WHERE "id" = target."reversalOfEventId"
          AND "userId" = target."userId";

        IF NOT FOUND OR original."kind" IN ('OPENING_BALANCE', 'REVERSAL') THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
                MESSAGE = format('Event %s cannot reverse the requested event', target_event_id);
        END IF;

        IF target."occurredAt" IS DISTINCT FROM original."occurredAt"
           OR target."externalFlowUsd" IS DISTINCT FROM -original."externalFlowUsd"
           OR target."feeUsd" IS DISTINCT FROM -original."feeUsd"
           OR target."actualValueUsd" IS DISTINCT FROM -original."actualValueUsd"
           OR target."replacementForEventId" IS NOT NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
                MESSAGE = format('Reversal %s does not exactly negate event %s', target_event_id, original."id");
        END IF;

        SELECT count(*) INTO original_movement_count
        FROM "AssetMovement"
        WHERE "portfolioEventId" = original."id"
          AND "userId" = original."userId";

        IF movement_count <> original_movement_count OR EXISTS (
            SELECT 1
            FROM "AssetMovement" source
            WHERE source."portfolioEventId" = original."id"
              AND source."userId" = original."userId"
              AND NOT EXISTS (
                  SELECT 1
                  FROM "AssetMovement" inverse
                  WHERE inverse."portfolioEventId" = target."id"
                    AND inverse."userId" = target."userId"
                    AND inverse."userAssetId" = source."userAssetId"
                    AND inverse."role" = source."role"
                    AND inverse."quantityDelta" = -source."quantityDelta"
                    AND inverse."unitPriceUsd" IS NOT DISTINCT FROM source."unitPriceUsd"
                    AND inverse."priceEstimated" = source."priceEstimated"
              )
        ) THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
                MESSAGE = format('Reversal %s movements do not exactly negate event %s', target_event_id, original."id");
        END IF;

        RETURN;
    END IF;

    IF target."reversalOfEventId" IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
            MESSAGE = format('Economic event %s cannot carry a reversal link', target_event_id);
    END IF;

    IF fee_count = 0 AND target."feeUsd" IS DISTINCT FROM 0::numeric THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
            MESSAGE = format('Event %s without a fee movement requires feeUsd zero', target_event_id);
    ELSIF fee_count = 1 AND (
        negative_fee_count <> 1
        OR (target."feeUsd" IS NOT NULL AND target."feeUsd" <= 0)
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
            MESSAGE = format('Event %s has an invalid fee shape', target_event_id);
    ELSIF fee_count > 1 THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
            MESSAGE = format('Event %s has more than one fee movement', target_event_id);
    END IF;

    CASE target."kind"
        WHEN 'BUY', 'TRANSFER_IN' THEN
            IF principal_count <> 1 OR positive_principal_count <> 1
               OR target."externalFlowUsd" IS DISTINCT FROM target."actualValueUsd" THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
                    MESSAGE = format('Inbound event %s has an invalid shape', target_event_id);
            END IF;
        WHEN 'SELL', 'TRANSFER_OUT' THEN
            IF principal_count <> 1 OR negative_principal_count <> 1
               OR target."externalFlowUsd" IS DISTINCT FROM -target."actualValueUsd" THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
                    MESSAGE = format('Outbound event %s has an invalid shape', target_event_id);
            END IF;
        WHEN 'SWAP' THEN
            IF principal_count <> 2
               OR positive_principal_count <> 1
               OR negative_principal_count <> 1
               OR target."externalFlowUsd" IS DISTINCT FROM 0::numeric THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
                    MESSAGE = format('Swap event %s has an invalid shape', target_event_id);
            END IF;
        WHEN 'FEE' THEN
            IF principal_count <> 0 OR fee_count <> 1
               OR target."actualValueUsd" IS NOT NULL
               OR target."externalFlowUsd" IS DISTINCT FROM 0::numeric THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23514',
                    CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
                    MESSAGE = format('Fee event %s has an invalid shape', target_event_id);
            END IF;
        ELSE
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
                MESSAGE = format('Unsupported manual event kind for %s', target_event_id);
    END CASE;

    IF target."replacementForEventId" IS NOT NULL THEN
        SELECT * INTO original
        FROM "PortfolioEvent"
        WHERE "id" = target."replacementForEventId"
          AND "userId" = target."userId";

        IF NOT FOUND OR original."kind" <> target."kind"
           OR original."kind" IN ('OPENING_BALANCE', 'REVERSAL')
           OR NOT EXISTS (
               SELECT 1
               FROM "PortfolioEvent" inverse
               WHERE inverse."userId" = target."userId"
                 AND inverse."kind" = 'REVERSAL'
                 AND inverse."reversalOfEventId" = original."id"
           ) THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'PortfolioEvent_manual_semantics_check',
                MESSAGE = format('Replacement %s is not paired with a valid reversal', target_event_id);
        END IF;
    END IF;
END;
$$;

CREATE FUNCTION "enforce_manual_event_semantics"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
    IF TG_TABLE_NAME = 'PortfolioEvent' THEN
        PERFORM "assert_manual_event_semantics"(NEW."id");
    ELSE
        PERFORM "assert_manual_event_semantics"(NEW."portfolioEventId");
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "PortfolioEvent_manual_semantics_check"
AFTER INSERT ON "PortfolioEvent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_manual_event_semantics"();

CREATE CONSTRAINT TRIGGER "AssetMovement_manual_semantics_check"
AFTER INSERT ON "AssetMovement"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_manual_event_semantics"();

-- A row lock alone is not enough when a SERIALIZABLE application transaction
-- takes its snapshot before waiting for a READ COMMITTED raw writer. Updating
-- the owner row creates a tuple-version conflict: a stale Serializable writer
-- must abort and retry, while a raw writer waits before its movement exists.
CREATE FUNCTION "serialize_ledger_owner_write"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
    UPDATE "User"
    SET "ledgerAdoptedAt" = "ledgerAdoptedAt"
    WHERE "id" = NEW."userId";

    RETURN NEW;
END;
$$;

CREATE TRIGGER "AssetMovement_owner_write_serialization"
BEFORE INSERT ON "AssetMovement"
FOR EACH ROW
EXECUTE FUNCTION "serialize_ledger_owner_write"();

CREATE FUNCTION "assert_nonnegative_asset_timeline"(
    target_user_id TEXT,
    target_user_asset_id TEXT
)
RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
    IF EXISTS (
        WITH boundary_delta AS (
            SELECT
                event."occurredAt",
                sum(movement."quantityDelta") AS quantity_delta
            FROM "AssetMovement" movement
            JOIN "PortfolioEvent" event
              ON event."id" = movement."portfolioEventId"
             AND event."userId" = movement."userId"
            WHERE movement."userId" = target_user_id
              AND movement."userAssetId" = target_user_asset_id
            GROUP BY event."occurredAt"
        ), timeline AS (
            SELECT sum(quantity_delta) OVER (
                ORDER BY "occurredAt"
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS balance
            FROM boundary_delta
        )
        SELECT 1 FROM timeline WHERE balance < 0
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'AssetMovement_nonnegative_timeline_check',
            MESSAGE = format(
                'Ledger history would make position %s negative',
                target_user_asset_id
            );
    END IF;
END;
$$;

CREATE FUNCTION "enforce_nonnegative_asset_timeline"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
    -- Serialize every ledger writer on the same owner row. A lock acquired
    -- here by a raw/default-isolation writer also waits for application
    -- writers, which lock the owner before inserting movements.
    PERFORM 1
    FROM "User"
    WHERE "id" = NEW."userId"
    FOR UPDATE;

    PERFORM "assert_nonnegative_asset_timeline"(NEW."userId", NEW."userAssetId");
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "AssetMovement_nonnegative_timeline_check"
AFTER INSERT ON "AssetMovement"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_nonnegative_asset_timeline"();

CREATE FUNCTION "protect_adopted_legacy_position"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    owner_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."userId" ELSE NEW."userId" END;
    adopted_at TIMESTAMP(3);
    locked_owner RECORD;
    touches_adopted_owner BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD."userId" IS DISTINCT FROM NEW."userId" THEN
        -- Write-lock both sides in a stable order. Direct writers create a
        -- tuple-version conflict for any stale Serializable cutover attempt.
        touches_adopted_owner := false;
        FOR locked_owner IN
            SELECT "id"
            FROM "User"
            WHERE "id" IN (OLD."userId", NEW."userId")
            ORDER BY "id"
        LOOP
            IF pg_trigger_depth() = 1 THEN
                UPDATE "User"
                SET "ledgerAdoptedAt" = "ledgerAdoptedAt"
                WHERE "id" = locked_owner."id"
                RETURNING "ledgerAdoptedAt" INTO adopted_at;
            ELSE
                SELECT "ledgerAdoptedAt" INTO adopted_at
                FROM "User"
                WHERE "id" = locked_owner."id"
                FOR UPDATE;
            END IF;
            touches_adopted_owner :=
                touches_adopted_owner OR adopted_at IS NOT NULL;
        END LOOP;

        IF coalesce(touches_adopted_owner, false) THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'UserAsset_adopted_legacy_fields_frozen_check',
                MESSAGE = 'Legacy position identity, amount, and timestamp are frozen after adoption';
        END IF;
    END IF;

    IF TG_OP <> 'UPDATE' OR OLD."userId" IS NOT DISTINCT FROM NEW."userId" THEN
        IF pg_trigger_depth() = 1 THEN
            UPDATE "User"
            SET "ledgerAdoptedAt" = "ledgerAdoptedAt"
            WHERE "id" = owner_id
            RETURNING "ledgerAdoptedAt" INTO adopted_at;
        ELSE
            -- Adoption captures initial aliases through this trigger. The
            -- outer User update already owns the row, so avoid a nested write.
            SELECT "ledgerAdoptedAt" INTO adopted_at
            FROM "User"
            WHERE "id" = owner_id
            FOR UPDATE;
        END IF;
    END IF;

    IF adopted_at IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'UserAsset_adopted_history_protection_check',
            MESSAGE = 'Adopted positions must be archived, not deleted';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."amount" IS DISTINCT FROM 0::double precision THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'UserAsset_adopted_legacy_fields_frozen_check',
                MESSAGE = 'New adopted positions must not seed the legacy Float amount';
        END IF;
        IF NEW."ledgerInitialAssetName" IS NULL
           OR NEW."ledgerInitialAssetName" IS DISTINCT FROM NEW."assetName" THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'UserAsset_adopted_ledger_seed_check',
                MESSAGE = 'New adopted positions must preserve their initial alias';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD."id" IS DISTINCT FROM NEW."id"
       OR OLD."userId" IS DISTINCT FROM NEW."userId"
       OR OLD."assetId" IS DISTINCT FROM NEW."assetId"
       OR OLD."amount" IS DISTINCT FROM NEW."amount"
       OR OLD."date" IS DISTINCT FROM NEW."date"
       OR OLD."ledgerInitialAssetName" IS DISTINCT FROM NEW."ledgerInitialAssetName" THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'UserAsset_adopted_legacy_fields_frozen_check',
            MESSAGE = 'Legacy position identity, amount, and timestamp are frozen after adoption';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "UserAsset_adopted_legacy_fields_frozen"
BEFORE INSERT OR UPDATE OR DELETE ON "UserAsset"
FOR EACH ROW
EXECUTE FUNCTION "protect_adopted_legacy_position"();

CREATE FUNCTION "protect_adopted_asset_archive"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    position_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."userAssetId" ELSE NEW."userAssetId" END;
    owner_id TEXT;
    adopted_at TIMESTAMP(3);
    locked_owner RECORD;
    touches_adopted_owner BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD."userAssetId" IS DISTINCT FROM NEW."userAssetId" THEN
        touches_adopted_owner := false;
        FOR locked_owner IN
            SELECT DISTINCT owner."id"
            FROM "UserAsset" position
            JOIN "User" owner ON owner."id" = position."userId"
            WHERE position."id" IN (OLD."userAssetId", NEW."userAssetId")
            ORDER BY owner."id"
        LOOP
            IF pg_trigger_depth() = 1 THEN
                UPDATE "User"
                SET "ledgerAdoptedAt" = "ledgerAdoptedAt"
                WHERE "id" = locked_owner."id"
                RETURNING "ledgerAdoptedAt" INTO adopted_at;
            ELSE
                SELECT "ledgerAdoptedAt" INTO adopted_at
                FROM "User"
                WHERE "id" = locked_owner."id"
                FOR UPDATE;
            END IF;
            touches_adopted_owner :=
                touches_adopted_owner OR adopted_at IS NOT NULL;
        END LOOP;

        IF coalesce(touches_adopted_owner, false) THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'AssetArchive_adopted_history_frozen_check',
                MESSAGE = 'Legacy asset archives are frozen after adoption';
        END IF;
    END IF;

    IF TG_OP <> 'UPDATE'
       OR OLD."userAssetId" IS NOT DISTINCT FROM NEW."userAssetId" THEN
        SELECT "userId" INTO owner_id
        FROM "UserAsset"
        WHERE "id" = position_id;

        IF pg_trigger_depth() = 1 THEN
            UPDATE "User"
            SET "ledgerAdoptedAt" = "ledgerAdoptedAt"
            WHERE "id" = owner_id
            RETURNING "ledgerAdoptedAt" INTO adopted_at;
        ELSE
            SELECT "ledgerAdoptedAt" INTO adopted_at
            FROM "User"
            WHERE "id" = owner_id
            FOR UPDATE;
        END IF;
    END IF;

    IF adopted_at IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'AssetArchive_adopted_history_frozen_check',
            MESSAGE = 'Legacy asset archives are frozen after adoption';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "AssetArchive_adopted_history_frozen"
BEFORE INSERT OR UPDATE OR DELETE ON "AssetArchive"
FOR EACH ROW
EXECUTE FUNCTION "protect_adopted_asset_archive"();

CREATE FUNCTION "protect_immutable_ledger_record"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = TG_TABLE_NAME || '_immutable_check',
        MESSAGE = TG_TABLE_NAME || ' records are immutable; use a reversal';
END;
$$;

CREATE TRIGGER "PortfolioEvent_immutable"
BEFORE UPDATE OR DELETE ON "PortfolioEvent"
FOR EACH ROW
EXECUTE FUNCTION "protect_immutable_ledger_record"();

CREATE TRIGGER "AssetMovement_immutable"
BEFORE UPDATE OR DELETE ON "AssetMovement"
FOR EACH ROW
EXECUTE FUNCTION "protect_immutable_ledger_record"();
