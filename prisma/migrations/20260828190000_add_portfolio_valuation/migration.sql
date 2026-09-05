-- Expand-only daily valuation foundation. Historical revisions and their
-- evidence are append-only; logical headers retain the one mutable active
-- pointer and explicit lifecycle state.

CREATE TYPE "SnapshotKind" AS ENUM ('DAILY', 'ADOPTION_BASELINE');
CREATE TYPE "SnapshotLifecycleStatus" AS ENUM ('COMPLETE', 'INCOMPLETE', 'STALE');
CREATE TYPE "SnapshotRevisionProvenance" AS ENUM (
  'SCHEDULED',
  'MANUAL',
  'REPAIR',
  'ADOPTION_BASELINE'
);
CREATE TYPE "SnapshotValuationStatus" AS ENUM ('COMPLETE', 'INCOMPLETE');
CREATE TYPE "SnapshotReconciliationStatus" AS ENUM (
  'COMPLETE',
  'INCOMPLETE',
  'NOT_APPLICABLE'
);
CREATE TYPE "SnapshotPriceQuality" AS ENUM (
  'OBSERVED',
  'STALE_FALLBACK',
  'HISTORICAL_ESTIMATE',
  'MISSING'
);
CREATE TYPE "SnapshotPriceMissingReason" AS ENUM (
  'MISSING_CREDENTIAL',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'UNKNOWN_COIN',
  'INVALID_RESPONSE',
  'NO_ACCEPTABLE_OBSERVATION'
);

ALTER TABLE "User"
  ADD COLUMN "ledgerRevision" BIGINT NOT NULL DEFAULT 0;

-- Existing movement history is the initial tuple version. Only equality and
-- monotonicity matter to capture/activation, but starting at the real count
-- makes the audit value meaningful from the first valuation revision.
UPDATE "User" owner
SET "ledgerRevision" = (
  SELECT count(*)::bigint
  FROM "AssetMovement" movement
  WHERE movement."userId" = owner."id"
);

ALTER TABLE "User"
  ADD CONSTRAINT "User_nonnegative_ledger_revision_check" CHECK (
    "ledgerRevision" >= 0
  );

CREATE TABLE "PortfolioSnapshot" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "SnapshotKind" NOT NULL,
  "reportingDate" DATE NOT NULL,
  "lifecycleStatus" "SnapshotLifecycleStatus" NOT NULL DEFAULT 'INCOMPLETE',
  "activeRevisionNumber" INTEGER,
  "staleAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PortfolioSnapshot_active_revision_number_check" CHECK (
    "activeRevisionNumber" IS NULL OR "activeRevisionNumber" > 0
  ),
  CONSTRAINT "PortfolioSnapshot_active_lifecycle_shape_check" CHECK (
    ("lifecycleStatus" = 'INCOMPLETE' OR "activeRevisionNumber" IS NOT NULL)
    AND
    (
      ("lifecycleStatus" = 'STALE' AND "staleAt" IS NOT NULL)
      OR
      ("lifecycleStatus" <> 'STALE' AND "staleAt" IS NULL)
    )
  ),
  CONSTRAINT "PortfolioSnapshot_finite_reporting_date_check" CHECK (
    isfinite("reportingDate")
  ),
  CONSTRAINT "PortfolioSnapshot_finite_stale_at_check" CHECK (
    "staleAt" IS NULL OR isfinite("staleAt")
  ),
  CONSTRAINT "PortfolioSnapshot_finite_created_at_check" CHECK (
    isfinite("createdAt")
  )
);

CREATE TABLE "PortfolioSnapshotRevision" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "cutoffAt" TIMESTAMP(3) NOT NULL,
  "ledgerRevision" BIGINT NOT NULL,
  "provenance" "SnapshotRevisionProvenance" NOT NULL,
  "valuationStatus" "SnapshotValuationStatus" NOT NULL,
  "reconciliationStatus" "SnapshotReconciliationStatus" NOT NULL,
  "totalValueUsd" DECIMAL(65,30),
  "knownValueUsd" DECIMAL(65,30) NOT NULL,
  "netExternalFlowUsd" DECIMAL(65,30),
  "feesUsd" DECIMAL(65,30),
  "priceMovementUsd" DECIMAL(65,30),
  "eventValuationAdjustmentUsd" DECIMAL(65,30),
  "marketMovementUsd" DECIMAL(65,30),
  "actor" VARCHAR(160) NOT NULL,
  "reason" VARCHAR(500),
  "priceRetrievedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PortfolioSnapshotRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PortfolioSnapshotRevision_positive_revision_check" CHECK (
    "revision" > 0
  ),
  CONSTRAINT "PortfolioSnapshotRevision_nonnegative_ledger_revision_check" CHECK (
    "ledgerRevision" >= 0
  ),
  CONSTRAINT "PortfolioSnapshotRevision_nonnegative_values_check" CHECK (
    ("totalValueUsd" IS NULL OR "totalValueUsd" >= 0)
    AND "knownValueUsd" >= 0
  ),
  CONSTRAINT "PortfolioSnapshotRevision_valuation_shape_check" CHECK (
    ("valuationStatus" = 'COMPLETE' AND "totalValueUsd" IS NOT NULL)
    OR
    ("valuationStatus" = 'INCOMPLETE' AND "totalValueUsd" IS NULL)
  ),
  CONSTRAINT "PortfolioSnapshotRevision_reconciliation_shape_check" CHECK (
    (
      "reconciliationStatus" = 'COMPLETE'
      AND "netExternalFlowUsd" IS NOT NULL
      AND "feesUsd" IS NOT NULL
      AND "priceMovementUsd" IS NOT NULL
      AND "eventValuationAdjustmentUsd" IS NOT NULL
      AND "marketMovementUsd" IS NOT NULL
    )
    OR
    "reconciliationStatus" = 'INCOMPLETE'
    OR
    (
      "reconciliationStatus" = 'NOT_APPLICABLE'
      AND "netExternalFlowUsd" IS NULL
      AND "feesUsd" IS NULL
      AND "priceMovementUsd" IS NULL
      AND "eventValuationAdjustmentUsd" IS NULL
      AND "marketMovementUsd" IS NULL
    )
  ),
  CONSTRAINT "PortfolioSnapshotRevision_repair_reason_shape_check" CHECK (
    (
      "provenance" = 'REPAIR'
      AND "reason" IS NOT NULL
      AND char_length(btrim("reason")) BETWEEN 1 AND 500
    )
    OR
    ("provenance" <> 'REPAIR' AND "reason" IS NULL)
  ),
  CONSTRAINT "PortfolioSnapshotRevision_actor_shape_check" CHECK (
    char_length(btrim("actor")) BETWEEN 1 AND 160
  ),
  CONSTRAINT "PortfolioSnapshotRevision_finite_numeric_check" CHECK (
    ("totalValueUsd" IS NULL OR lower("totalValueUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
    AND lower("knownValueUsd"::text) NOT IN ('nan', 'infinity', '-infinity')
    AND ("netExternalFlowUsd" IS NULL OR lower("netExternalFlowUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
    AND ("feesUsd" IS NULL OR lower("feesUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
    AND ("priceMovementUsd" IS NULL OR lower("priceMovementUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
    AND ("eventValuationAdjustmentUsd" IS NULL OR lower("eventValuationAdjustmentUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
    AND ("marketMovementUsd" IS NULL OR lower("marketMovementUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
  ),
  CONSTRAINT "PortfolioSnapshotRevision_finite_timestamp_check" CHECK (
    isfinite("cutoffAt")
    AND isfinite("priceRetrievedAt")
    AND isfinite("createdAt")
  )
);

CREATE TABLE "PositionSnapshot" (
  "id" TEXT NOT NULL,
  "snapshotRevisionId" TEXT NOT NULL,
  "userAssetId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assetId" VARCHAR(160) NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL,
  "priceUsd" DECIMAL(65,30),
  "valueUsd" DECIMAL(65,30),
  "priceObservedAt" TIMESTAMP(3),
  "priceQuality" "SnapshotPriceQuality" NOT NULL,
  "missingReason" "SnapshotPriceMissingReason",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PositionSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PositionSnapshot_asset_id_shape_check" CHECK (
    char_length(btrim("assetId")) BETWEEN 1 AND 160
  ),
  CONSTRAINT "PositionSnapshot_nonnegative_values_check" CHECK (
    "quantity" > 0
    AND ("priceUsd" IS NULL OR "priceUsd" > 0)
    AND ("valueUsd" IS NULL OR "valueUsd" >= 0)
  ),
  CONSTRAINT "PositionSnapshot_price_shape_check" CHECK (
    (
      "priceQuality" = 'MISSING'
      AND "priceUsd" IS NULL
      AND "valueUsd" IS NULL
      AND "priceObservedAt" IS NULL
      AND "missingReason" IS NOT NULL
    )
    OR
    (
      "priceQuality" <> 'MISSING'
      AND "priceUsd" IS NOT NULL
      AND "valueUsd" IS NOT NULL
      AND "priceObservedAt" IS NOT NULL
      AND "missingReason" IS NULL
    )
  ),
  CONSTRAINT "PositionSnapshot_value_product_check" CHECK (
    "valueUsd" IS NULL
    OR "valueUsd" = round("quantity" * "priceUsd", 30)
  ),
  CONSTRAINT "PositionSnapshot_finite_numeric_check" CHECK (
    lower("quantity"::text) NOT IN ('nan', 'infinity', '-infinity')
    AND ("priceUsd" IS NULL OR lower("priceUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
    AND ("valueUsd" IS NULL OR lower("valueUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
  ),
  CONSTRAINT "PositionSnapshot_finite_timestamp_check" CHECK (
    ("priceObservedAt" IS NULL OR isfinite("priceObservedAt"))
    AND isfinite("createdAt")
  )
);

CREATE TABLE "CoinSnapshotContribution" (
  "id" TEXT NOT NULL,
  "snapshotRevisionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assetId" VARCHAR(160) NOT NULL,
  "externalFlowUsd" DECIMAL(65,30),
  "feesUsd" DECIMAL(65,30),
  "priceMovementUsd" DECIMAL(65,30),
  "eventValuationAdjustmentUsd" DECIMAL(65,30),
  "marketMovementUsd" DECIMAL(65,30),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CoinSnapshotContribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoinSnapshotContribution_asset_id_shape_check" CHECK (
    char_length(btrim("assetId")) BETWEEN 1 AND 160
  ),
  CONSTRAINT "CoinSnapshotContribution_market_components_check" CHECK (
    "marketMovementUsd" IS NULL
    OR "priceMovementUsd" IS NULL
    OR "eventValuationAdjustmentUsd" IS NULL
    OR abs(
      "marketMovementUsd"
      - "priceMovementUsd"
      - "eventValuationAdjustmentUsd"
    ) <= 0.00000001
  ),
  CONSTRAINT "CoinSnapshotContribution_finite_numeric_check" CHECK (
    ("externalFlowUsd" IS NULL OR lower("externalFlowUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
    AND ("feesUsd" IS NULL OR lower("feesUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
    AND ("priceMovementUsd" IS NULL OR lower("priceMovementUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
    AND ("eventValuationAdjustmentUsd" IS NULL OR lower("eventValuationAdjustmentUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
    AND ("marketMovementUsd" IS NULL OR lower("marketMovementUsd"::text) NOT IN ('nan', 'infinity', '-infinity'))
  ),
  CONSTRAINT "CoinSnapshotContribution_finite_created_at_check" CHECK (
    isfinite("createdAt")
  )
);

CREATE TABLE "SnapshotRecalculationRequest" (
  "userId" TEXT NOT NULL,
  "earliestAffectedAt" TIMESTAMP(3) NOT NULL,
  "ledgerRevision" BIGINT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SnapshotRecalculationRequest_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "SnapshotRecalculationRequest_nonnegative_ledger_revision_check" CHECK (
    "ledgerRevision" >= 0
  ),
  CONSTRAINT "SnapshotRecalculationRequest_finite_timestamp_check" CHECK (
    isfinite("earliestAffectedAt") AND isfinite("requestedAt")
  )
);

CREATE UNIQUE INDEX "PortfolioSnapshot_id_userId_key"
  ON "PortfolioSnapshot"("id", "userId");
CREATE UNIQUE INDEX "PortfolioSnapshot_id_userId_activeRevisionNumber_key"
  ON "PortfolioSnapshot"("id", "userId", "activeRevisionNumber");
CREATE UNIQUE INDEX "PortfolioSnapshot_userId_kind_reportingDate_key"
  ON "PortfolioSnapshot"("userId", "kind", "reportingDate");
CREATE INDEX "PortfolioSnapshot_userId_lifecycleStatus_reportingDate_idx"
  ON "PortfolioSnapshot"("userId", "lifecycleStatus", "reportingDate");

CREATE UNIQUE INDEX "PortfolioSnapshotRevision_id_userId_key"
  ON "PortfolioSnapshotRevision"("id", "userId");
CREATE UNIQUE INDEX "PortfolioSnapshotRevision_snapshotId_userId_revision_key"
  ON "PortfolioSnapshotRevision"("snapshotId", "userId", "revision");
CREATE INDEX "PortfolioSnapshotRevision_userId_cutoffAt_idx"
  ON "PortfolioSnapshotRevision"("userId", "cutoffAt");
CREATE INDEX "PortfolioSnapshotRevision_snapshotId_revision_idx"
  ON "PortfolioSnapshotRevision"("snapshotId", "revision");

CREATE UNIQUE INDEX "PositionSnapshot_snapshotRevisionId_userAssetId_key"
  ON "PositionSnapshot"("snapshotRevisionId", "userAssetId");
CREATE INDEX "PositionSnapshot_userId_userAssetId_snapshotRevisionId_idx"
  ON "PositionSnapshot"("userId", "userAssetId", "snapshotRevisionId");
CREATE INDEX "PositionSnapshot_snapshotRevisionId_assetId_idx"
  ON "PositionSnapshot"("snapshotRevisionId", "assetId");

CREATE UNIQUE INDEX "CoinSnapshotContribution_snapshotRevisionId_assetId_key"
  ON "CoinSnapshotContribution"("snapshotRevisionId", "assetId");
CREATE INDEX "CoinSnapshotContribution_userId_assetId_snapshotRevisionId_idx"
  ON "CoinSnapshotContribution"("userId", "assetId", "snapshotRevisionId");

CREATE INDEX "SnapshotRecalculationRequest_earliestAffectedAt_requestedAt_idx"
  ON "SnapshotRecalculationRequest"("earliestAffectedAt", "requestedAt");

ALTER TABLE "PortfolioSnapshot"
  ADD CONSTRAINT "PortfolioSnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PortfolioSnapshotRevision"
  ADD CONSTRAINT "PortfolioSnapshotRevision_snapshotId_userId_fkey"
  FOREIGN KEY ("snapshotId", "userId")
  REFERENCES "PortfolioSnapshot"("id", "userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The cycle is intentional: a header owns all revisions, while its active
-- pointer must resolve to a revision owned by that exact same header/user.
ALTER TABLE "PortfolioSnapshot"
  ADD CONSTRAINT "PortfolioSnapshot_id_userId_activeRevisionNumber_fkey"
  FOREIGN KEY ("id", "userId", "activeRevisionNumber")
  REFERENCES "PortfolioSnapshotRevision"("snapshotId", "userId", "revision")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "PositionSnapshot"
  ADD CONSTRAINT "PositionSnapshot_snapshotRevisionId_userId_fkey"
  FOREIGN KEY ("snapshotRevisionId", "userId")
  REFERENCES "PortfolioSnapshotRevision"("id", "userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PositionSnapshot"
  ADD CONSTRAINT "PositionSnapshot_userAssetId_userId_fkey"
  FOREIGN KEY ("userAssetId", "userId")
  REFERENCES "UserAsset"("id", "userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CoinSnapshotContribution"
  ADD CONSTRAINT "CoinSnapshotContribution_snapshotRevisionId_userId_fkey"
  FOREIGN KEY ("snapshotRevisionId", "userId")
  REFERENCES "PortfolioSnapshotRevision"("id", "userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SnapshotRecalculationRequest"
  ADD CONSTRAINT "SnapshotRecalculationRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "snapshot_daily_cutoff_utc"(target_date DATE)
RETURNS TIMESTAMP(3)
LANGUAGE sql
STABLE
SET search_path FROM CURRENT
AS $$
  SELECT (
    (target_date + 1)::timestamp AT TIME ZONE 'America/Argentina/Salta'
  ) AT TIME ZONE 'UTC'
$$;

CREATE FUNCTION "protect_snapshot_header"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_header_immutable_check',
      MESSAGE = 'Logical snapshot headers cannot be deleted';
  END IF;

  IF OLD."id" IS DISTINCT FROM NEW."id"
     OR OLD."userId" IS DISTINCT FROM NEW."userId"
     OR OLD."kind" IS DISTINCT FROM NEW."kind"
     OR OLD."reportingDate" IS DISTINCT FROM NEW."reportingDate"
     OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_header_immutable_check',
      MESSAGE = 'Snapshot identity and reporting boundary are immutable';
  END IF;

  IF OLD."activeRevisionNumber" IS DISTINCT FROM NEW."activeRevisionNumber" THEN
    IF NEW."activeRevisionNumber" IS NULL
       OR NEW."activeRevisionNumber" <> coalesce(OLD."activeRevisionNumber", 0) + 1
       OR NEW."lifecycleStatus" = 'STALE'
       OR NEW."staleAt" IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'PortfolioSnapshot_active_revision_sequence_check',
        MESSAGE = 'A snapshot can only activate its next immutable revision';
    END IF;
  ELSIF OLD."lifecycleStatus" IS DISTINCT FROM NEW."lifecycleStatus" THEN
    IF NEW."lifecycleStatus" <> 'STALE'
       OR OLD."activeRevisionNumber" IS NULL
       OR NEW."staleAt" IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'PortfolioSnapshot_lifecycle_transition_check',
        MESSAGE = 'Leaving a non-stale lifecycle requires a new active revision';
    END IF;
  ELSIF OLD."staleAt" IS DISTINCT FROM NEW."staleAt" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_lifecycle_transition_check',
      MESSAGE = 'Staleness metadata cannot change without a lifecycle transition';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "PortfolioSnapshot_header_guard"
BEFORE UPDATE OR DELETE ON "PortfolioSnapshot"
FOR EACH ROW
EXECUTE FUNCTION "protect_snapshot_header"();

CREATE FUNCTION "protect_snapshot_revision"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  active_number INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshotRevision_immutable_check',
      MESSAGE = 'Snapshot revisions are immutable; append a repair revision';
  END IF;

  SELECT header."activeRevisionNumber"
  INTO active_number
  FROM "PortfolioSnapshot" header
  WHERE header."id" = NEW."snapshotId"
    AND header."userId" = NEW."userId"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'PortfolioSnapshotRevision_snapshotId_userId_fkey',
      MESSAGE = 'Snapshot revision owner/header does not exist';
  END IF;

  IF NEW."revision" <> coalesce(active_number, 0) + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshotRevision_sequence_check',
      MESSAGE = 'Snapshot revision must be the next inactive revision';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "PortfolioSnapshotRevision_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "PortfolioSnapshotRevision"
FOR EACH ROW
EXECUTE FUNCTION "protect_snapshot_revision"();

CREATE FUNCTION "enforce_inserted_snapshot_revision_activation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  active_number INTEGER;
BEGIN
  SELECT header."activeRevisionNumber"
  INTO active_number
  FROM "PortfolioSnapshot" header
  WHERE header."id" = NEW."snapshotId"
    AND header."userId" = NEW."userId";

  IF active_number IS NULL OR active_number < NEW."revision" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshotRevision_activation_check',
      MESSAGE = 'A new snapshot revision must be activated in the same transaction';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "PortfolioSnapshotRevision_activation_check"
AFTER INSERT ON "PortfolioSnapshotRevision"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_inserted_snapshot_revision_activation"();

CREATE FUNCTION "protect_snapshot_evidence"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  evidence_revision INTEGER;
  active_number INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = TG_TABLE_NAME || '_immutable_check',
      MESSAGE = TG_TABLE_NAME || ' records are immutable';
  END IF;

  SELECT revision."revision", header."activeRevisionNumber"
  INTO evidence_revision, active_number
  FROM "PortfolioSnapshotRevision" revision
  JOIN "PortfolioSnapshot" header
    ON header."id" = revision."snapshotId"
   AND header."userId" = revision."userId"
  WHERE revision."id" = NEW."snapshotRevisionId"
    AND revision."userId" = NEW."userId"
  FOR UPDATE OF header;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = TG_TABLE_NAME || '_snapshot_revision_owner_fkey',
      MESSAGE = 'Snapshot evidence revision/owner does not exist';
  END IF;

  IF active_number IS NOT NULL AND evidence_revision <= active_number THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = TG_TABLE_NAME || '_sealed_revision_check',
      MESSAGE = 'Evidence cannot be added to an active or superseded revision';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "PositionSnapshot_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "PositionSnapshot"
FOR EACH ROW
EXECUTE FUNCTION "protect_snapshot_evidence"();
CREATE TRIGGER "CoinSnapshotContribution_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "CoinSnapshotContribution"
FOR EACH ROW
EXECUTE FUNCTION "protect_snapshot_evidence"();

CREATE FUNCTION "assert_active_snapshot_revision"(
  target_snapshot_id TEXT,
  target_user_id TEXT
)
RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  header "PortfolioSnapshot"%ROWTYPE;
  active "PortfolioSnapshotRevision"%ROWTYPE;
  owner_adopted_at TIMESTAMP(3);
  owner_ledger_revision BIGINT;
  expected_cutoff TIMESTAMP(3);
  expected_reporting_date DATE;
  known_sum NUMERIC(65,30);
  missing_count BIGINT;
  previous_revision_id TEXT;
  previous_total NUMERIC(65,30);
  previous_cutoff TIMESTAMP(3);
  previous_kind "SnapshotKind";
  period_unknown_count BIGINT;
  period_flow NUMERIC(65,30);
  period_fees NUMERIC(65,30);
  contribution_count BIGINT;
  incomplete_contribution_count BIGINT;
  contribution_flow NUMERIC(65,30);
  contribution_fees NUMERIC(65,30);
  contribution_price NUMERIC(65,30);
  contribution_adjustment NUMERIC(65,30);
  contribution_market NUMERIC(65,30);
  tolerance CONSTANT NUMERIC(65,30) := 0.00000001;
BEGIN
  SELECT * INTO header
  FROM "PortfolioSnapshot"
  WHERE "id" = target_snapshot_id
    AND "userId" = target_user_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF header."activeRevisionNumber" IS NULL THEN
    IF header."lifecycleStatus" <> 'INCOMPLETE' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'PortfolioSnapshot_active_revision_integrity_check',
        MESSAGE = 'Only an incomplete logical snapshot may lack an active revision';
    END IF;
    RETURN;
  END IF;

  SELECT * INTO active
  FROM "PortfolioSnapshotRevision"
  WHERE "snapshotId" = header."id"
    AND "userId" = header."userId"
    AND "revision" = header."activeRevisionNumber";

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'PortfolioSnapshot_id_userId_activeRevisionNumber_fkey',
      MESSAGE = 'Active revision does not belong to the logical snapshot owner';
  END IF;

  SELECT "ledgerAdoptedAt", "ledgerRevision"
  INTO owner_adopted_at, owner_ledger_revision
  FROM "User"
  WHERE "id" = header."userId";

  IF owner_adopted_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_adoption_boundary_check',
      MESSAGE = 'Valuation snapshots require an adopted ledger';
  END IF;

  IF header."kind" = 'DAILY' THEN
    expected_cutoff := "snapshot_daily_cutoff_utc"(header."reportingDate");
    IF active."cutoffAt" IS DISTINCT FROM expected_cutoff
       OR active."cutoffAt" <= owner_adopted_at
       OR active."provenance" = 'ADOPTION_BASELINE'
       OR active."reconciliationStatus" = 'NOT_APPLICABLE' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'PortfolioSnapshot_daily_boundary_check',
        MESSAGE = 'Daily snapshots require the fixed exclusive Salta cutoff after adoption';
    END IF;
  ELSE
    expected_reporting_date := (
      (owner_adopted_at AT TIME ZONE 'UTC')
      AT TIME ZONE 'America/Argentina/Salta'
    )::date;
    IF active."cutoffAt" IS DISTINCT FROM owner_adopted_at
       OR header."reportingDate" IS DISTINCT FROM expected_reporting_date
       OR NOT (
         (active."revision" = 1 AND active."provenance" = 'ADOPTION_BASELINE')
         OR
         (active."revision" > 1 AND active."provenance" = 'REPAIR')
       )
       OR active."reconciliationStatus" <> 'NOT_APPLICABLE' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'PortfolioSnapshot_adoption_baseline_boundary_check',
        MESSAGE = 'Adoption baseline revisions require the inclusive adoption instant, local date, and explicit repair provenance after revision one';
    END IF;
  END IF;

  -- A stale header deliberately points at evidence captured before a later
  -- backdated movement. Its immutable revision remains valid audit history but
  -- must not be revalidated against the new ledger.
  IF header."lifecycleStatus" = 'STALE' THEN
    RETURN;
  END IF;

  IF active."ledgerRevision" <> owner_ledger_revision THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_ledger_revision_check',
      MESSAGE = 'Snapshot activation raced with a ledger movement';
  END IF;

  IF active."cutoffAt" > active."priceRetrievedAt" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_price_retrieval_boundary_check',
      MESSAGE = 'Snapshot prices must be retrieved at or after the valuation cutoff';
  END IF;

  IF EXISTS (
    WITH holdings AS (
      SELECT movement."userAssetId", sum(movement."quantityDelta") AS quantity
      FROM "AssetMovement" movement
      JOIN "PortfolioEvent" event
        ON event."id" = movement."portfolioEventId"
       AND event."userId" = movement."userId"
      WHERE movement."userId" = header."userId"
        AND (
          (header."kind" = 'DAILY' AND event."occurredAt" < active."cutoffAt")
          OR
          (header."kind" = 'ADOPTION_BASELINE' AND event."occurredAt" <= active."cutoffAt")
        )
      GROUP BY movement."userAssetId"
    )
    SELECT 1
    FROM "PositionSnapshot" line
    JOIN "UserAsset" position
      ON position."id" = line."userAssetId"
     AND position."userId" = line."userId"
    LEFT JOIN holdings
      ON holdings."userAssetId" = line."userAssetId"
    WHERE line."snapshotRevisionId" = active."id"
      AND (
        line."userId" <> header."userId"
        OR line."assetId" IS DISTINCT FROM position."assetId"
        OR holdings.quantity IS NULL
        OR holdings.quantity <= 0
        OR line."quantity" IS DISTINCT FROM holdings.quantity
      )
  ) OR EXISTS (
    WITH holdings AS (
      SELECT movement."userAssetId", sum(movement."quantityDelta") AS quantity
      FROM "AssetMovement" movement
      JOIN "PortfolioEvent" event
        ON event."id" = movement."portfolioEventId"
       AND event."userId" = movement."userId"
      WHERE movement."userId" = header."userId"
        AND (
          (header."kind" = 'DAILY' AND event."occurredAt" < active."cutoffAt")
          OR
          (header."kind" = 'ADOPTION_BASELINE' AND event."occurredAt" <= active."cutoffAt")
        )
      GROUP BY movement."userAssetId"
      HAVING sum(movement."quantityDelta") > 0
    )
    SELECT 1
    FROM holdings
    WHERE NOT EXISTS (
      SELECT 1
      FROM "PositionSnapshot" line
      WHERE line."snapshotRevisionId" = active."id"
        AND line."userId" = header."userId"
        AND line."userAssetId" = holdings."userAssetId"
        AND line."quantity" = holdings.quantity
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_position_quantity_check',
      MESSAGE = 'Snapshot positions must exactly match positive ledger holdings at the cutoff';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PositionSnapshot" line
    WHERE line."snapshotRevisionId" = active."id"
      AND line."priceQuality" <> 'MISSING'
      AND (
        line."priceObservedAt" > active."cutoffAt"
        OR line."priceObservedAt" > active."priceRetrievedAt"
        OR line."priceObservedAt" < active."cutoffAt" - interval '2 hours'
        OR (
          line."priceQuality" = 'OBSERVED'
          AND line."priceObservedAt" < active."cutoffAt" - interval '15 minutes'
        )
        OR (
          line."priceQuality" = 'STALE_FALLBACK'
          AND line."priceObservedAt" >= active."cutoffAt" - interval '15 minutes'
        )
        OR (
          active."provenance" = 'SCHEDULED'
          AND line."priceQuality" NOT IN ('OBSERVED', 'STALE_FALLBACK')
        )
        OR (
          active."provenance" <> 'SCHEDULED'
          AND line."priceQuality" <> 'HISTORICAL_ESTIMATE'
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_price_quality_check',
      MESSAGE = 'Persisted price quality does not match its cutoff age and provenance';
  END IF;

  SELECT
    coalesce(sum(line."valueUsd") FILTER (WHERE line."valueUsd" IS NOT NULL), 0),
    count(*) FILTER (WHERE line."priceQuality" = 'MISSING')
  INTO known_sum, missing_count
  FROM "PositionSnapshot" line
  WHERE line."snapshotRevisionId" = active."id";

  IF active."knownValueUsd" IS DISTINCT FROM known_sum
     OR (
       active."valuationStatus" = 'COMPLETE'
       AND (
         missing_count <> 0
         OR active."totalValueUsd" IS DISTINCT FROM known_sum
       )
     )
     OR (
       active."valuationStatus" = 'INCOMPLETE'
       AND missing_count = 0
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_valuation_total_check',
      MESSAGE = 'Snapshot total/known subtotal does not match position price coverage';
  END IF;

  IF header."lifecycleStatus" = 'COMPLETE' AND (
    active."valuationStatus" <> 'COMPLETE'
    OR (
      header."kind" = 'DAILY'
      AND active."reconciliationStatus" <> 'COMPLETE'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_lifecycle_revision_status_check',
      MESSAGE = 'A complete header requires complete valuation and reconciliation';
  ELSIF header."lifecycleStatus" = 'INCOMPLETE'
        AND active."valuationStatus" = 'COMPLETE'
        AND active."reconciliationStatus" IN ('COMPLETE', 'NOT_APPLICABLE') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_lifecycle_revision_status_check',
      MESSAGE = 'Complete active evidence cannot be labelled incomplete';
  END IF;

  IF header."kind" = 'ADOPTION_BASELINE' THEN
    IF EXISTS (
      SELECT 1
      FROM "CoinSnapshotContribution" contribution
      WHERE contribution."snapshotRevisionId" = active."id"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'PortfolioSnapshot_baseline_contribution_check',
        MESSAGE = 'Adoption baseline has no pre-adoption contribution period';
    END IF;
    RETURN;
  END IF;

  IF active."reconciliationStatus" <> 'COMPLETE' THEN
    RETURN;
  END IF;

  IF abs(
    active."marketMovementUsd"
    - active."priceMovementUsd"
    - active."eventValuationAdjustmentUsd"
  ) > tolerance THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_market_movement_components_check',
      MESSAGE = 'Market movement does not reconcile to price movement plus event valuation adjustment';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE "externalFlowUsd" IS NULL
         OR "feesUsd" IS NULL
         OR "priceMovementUsd" IS NULL
         OR "eventValuationAdjustmentUsd" IS NULL
         OR "marketMovementUsd" IS NULL
    ),
    coalesce(sum("externalFlowUsd"), 0),
    coalesce(sum("feesUsd"), 0),
    coalesce(sum("priceMovementUsd"), 0),
    coalesce(sum("eventValuationAdjustmentUsd"), 0),
    coalesce(sum("marketMovementUsd"), 0)
  INTO
    contribution_count,
    incomplete_contribution_count,
    contribution_flow,
    contribution_fees,
    contribution_price,
    contribution_adjustment,
    contribution_market
  FROM "CoinSnapshotContribution"
  WHERE "snapshotRevisionId" = active."id";

  IF incomplete_contribution_count <> 0
     OR abs(contribution_flow - active."netExternalFlowUsd") > tolerance
     OR abs(contribution_fees - active."feesUsd") > tolerance
     OR abs(contribution_price - active."priceMovementUsd") > tolerance
     OR abs(contribution_adjustment - active."eventValuationAdjustmentUsd") > tolerance
     OR abs(contribution_market - active."marketMovementUsd") > tolerance THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_coin_contribution_check',
      MESSAGE = 'Per-coin contributions do not reconcile to revision totals';
  END IF;

  SELECT revision."id", revision."totalValueUsd", revision."cutoffAt", previous_header."kind"
  INTO previous_revision_id, previous_total, previous_cutoff, previous_kind
  FROM "PortfolioSnapshot" previous_header
  JOIN "PortfolioSnapshotRevision" revision
    ON revision."snapshotId" = previous_header."id"
   AND revision."userId" = previous_header."userId"
   AND revision."revision" = previous_header."activeRevisionNumber"
  WHERE previous_header."userId" = header."userId"
    AND previous_header."id" <> header."id"
    AND previous_header."lifecycleStatus" = 'COMPLETE'
    AND revision."totalValueUsd" IS NOT NULL
    AND revision."cutoffAt" < active."cutoffAt"
  ORDER BY revision."cutoffAt" DESC, previous_header."id" DESC
  LIMIT 1;

  IF previous_revision_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_period_reconciliation_check',
      MESSAGE = 'A complete daily reconciliation requires a prior complete valuation';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE event."externalFlowUsd" IS NULL OR event."feeUsd" IS NULL
    ),
    coalesce(sum(event."externalFlowUsd"), 0),
    coalesce(sum(event."feeUsd"), 0)
  INTO period_unknown_count, period_flow, period_fees
  FROM "PortfolioEvent" event
  WHERE event."userId" = header."userId"
    AND (
      (previous_kind = 'ADOPTION_BASELINE' AND event."occurredAt" > previous_cutoff)
      OR
      (previous_kind <> 'ADOPTION_BASELINE' AND event."occurredAt" >= previous_cutoff)
    )
    AND event."occurredAt" < active."cutoffAt";

  IF period_unknown_count <> 0
     OR abs(period_flow - active."netExternalFlowUsd") > tolerance
     OR abs(period_fees - active."feesUsd") > tolerance THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_period_event_totals_check',
      MESSAGE = 'Complete flow and fee totals must match known ledger events in the period';
  END IF;

  IF EXISTS (
    WITH period_events AS (
      SELECT event.*
      FROM "PortfolioEvent" event
      WHERE event."userId" = header."userId"
        AND (
          (previous_kind = 'ADOPTION_BASELINE' AND event."occurredAt" > previous_cutoff)
          OR
          (previous_kind <> 'ADOPTION_BASELINE' AND event."occurredAt" >= previous_cutoff)
        )
        AND event."occurredAt" < active."cutoffAt"
    ), flow_event_assets AS (
      SELECT
        event."id",
        event."externalFlowUsd",
        min(position."assetId") AS "assetId",
        count(DISTINCT position."assetId") AS asset_count
      FROM period_events event
      LEFT JOIN "AssetMovement" movement
        ON movement."portfolioEventId" = event."id"
       AND movement."userId" = event."userId"
       AND movement."role" = 'PRINCIPAL'
      LEFT JOIN "UserAsset" position
        ON position."id" = movement."userAssetId"
       AND position."userId" = movement."userId"
      WHERE event."externalFlowUsd" <> 0
      GROUP BY event."id", event."externalFlowUsd"
    ), fee_event_assets AS (
      SELECT
        event."id",
        event."feeUsd",
        min(position."assetId") AS "assetId",
        count(DISTINCT position."assetId") AS asset_count
      FROM period_events event
      LEFT JOIN "AssetMovement" movement
        ON movement."portfolioEventId" = event."id"
       AND movement."userId" = event."userId"
       AND movement."role" = 'FEE'
      LEFT JOIN "UserAsset" position
        ON position."id" = movement."userAssetId"
       AND position."userId" = movement."userId"
      WHERE event."feeUsd" <> 0
      GROUP BY event."id", event."feeUsd"
    ), flow_by_asset AS (
      SELECT "assetId", sum("externalFlowUsd") AS amount
      FROM flow_event_assets
      GROUP BY "assetId"
    ), fees_by_asset AS (
      SELECT "assetId", sum("feeUsd") AS amount
      FROM fee_event_assets
      GROUP BY "assetId"
    )
    SELECT 1
    FROM flow_event_assets
    WHERE asset_count <> 1
    UNION ALL
    SELECT 1
    FROM fee_event_assets
    WHERE asset_count <> 1
    UNION ALL
    SELECT 1
    FROM "CoinSnapshotContribution" contribution
    LEFT JOIN flow_by_asset flow
      ON flow."assetId" = contribution."assetId"
    LEFT JOIN fees_by_asset fees
      ON fees."assetId" = contribution."assetId"
    WHERE contribution."snapshotRevisionId" = active."id"
      AND (
        abs(contribution."externalFlowUsd" - coalesce(flow.amount, 0)) > tolerance
        OR abs(contribution."feesUsd" - coalesce(fees.amount, 0)) > tolerance
      )
    UNION ALL
    SELECT 1
    FROM flow_by_asset flow
    WHERE NOT EXISTS (
      SELECT 1
      FROM "CoinSnapshotContribution" contribution
      WHERE contribution."snapshotRevisionId" = active."id"
        AND contribution."assetId" = flow."assetId"
    )
    UNION ALL
    SELECT 1
    FROM fees_by_asset fees
    WHERE NOT EXISTS (
      SELECT 1
      FROM "CoinSnapshotContribution" contribution
      WHERE contribution."snapshotRevisionId" = active."id"
        AND contribution."assetId" = fees."assetId"
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_coin_event_allocation_check',
      MESSAGE = 'Per-coin flow and fee contributions must match ledger event allocation';
  END IF;

  IF abs(
       active."totalValueUsd"
       - previous_total
       - active."netExternalFlowUsd"
       + active."feesUsd"
       - active."marketMovementUsd"
     ) > tolerance THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'PortfolioSnapshot_period_reconciliation_check',
      MESSAGE = 'Daily total change does not reconcile against the prior complete valuation';
  END IF;
END;
$$;

CREATE FUNCTION "enforce_active_snapshot_revision"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  PERFORM "assert_active_snapshot_revision"(NEW."id", NEW."userId");
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "PortfolioSnapshot_active_revision_integrity_check"
AFTER INSERT OR UPDATE ON "PortfolioSnapshot"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_active_snapshot_revision"();

-- Validate each activation immediately while its captured ledger version is
-- still current. The deferred check remains necessary for the final commit
-- state and catches later changes in the same transaction.
CREATE TRIGGER "PortfolioSnapshot_active_revision_immediate_check"
AFTER UPDATE OF "activeRevisionNumber" ON "PortfolioSnapshot"
FOR EACH ROW
WHEN (OLD."activeRevisionNumber" IS DISTINCT FROM NEW."activeRevisionNumber")
EXECUTE FUNCTION "enforce_active_snapshot_revision"();

CREATE FUNCTION "invalidate_snapshots_for_movement"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  event_occurred_at TIMESTAMP(3);
  current_ledger_revision BIGINT;
  affected_count BIGINT;
BEGIN
  SELECT event."occurredAt"
  INTO event_occurred_at
  FROM "PortfolioEvent" event
  WHERE event."id" = NEW."portfolioEventId"
    AND event."userId" = NEW."userId";

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'AssetMovement_portfolioEventId_userId_fkey',
      MESSAGE = 'Movement event/owner does not exist';
  END IF;

  UPDATE "User"
  SET "ledgerRevision" = "ledgerRevision" + 1
  WHERE "id" = NEW."userId"
  RETURNING "ledgerRevision" INTO current_ledger_revision;

  UPDATE "PortfolioSnapshot" header
  SET
    "lifecycleStatus" = 'STALE',
    "staleAt" = coalesce(header."staleAt", CURRENT_TIMESTAMP)
  FROM "PortfolioSnapshotRevision" revision
  WHERE header."userId" = NEW."userId"
    AND header."activeRevisionNumber" IS NOT NULL
    AND revision."snapshotId" = header."id"
    AND revision."userId" = header."userId"
    AND revision."revision" = header."activeRevisionNumber"
    AND (
      (header."kind" = 'DAILY' AND event_occurred_at < revision."cutoffAt")
      OR
      (header."kind" = 'ADOPTION_BASELINE' AND event_occurred_at <= revision."cutoffAt")
    );

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count > 0 THEN
    INSERT INTO "SnapshotRecalculationRequest" (
      "userId",
      "earliestAffectedAt",
      "ledgerRevision",
      "requestedAt"
    ) VALUES (
      NEW."userId",
      event_occurred_at,
      current_ledger_revision,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("userId") DO UPDATE SET
      "earliestAffectedAt" = least(
        "SnapshotRecalculationRequest"."earliestAffectedAt",
        EXCLUDED."earliestAffectedAt"
      ),
      "ledgerRevision" = greatest(
        "SnapshotRecalculationRequest"."ledgerRevision",
        EXCLUDED."ledgerRevision"
      ),
      "requestedAt" = EXCLUDED."requestedAt";
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AssetMovement_snapshot_invalidation"
AFTER INSERT ON "AssetMovement"
FOR EACH ROW
EXECUTE FUNCTION "invalidate_snapshots_for_movement"();

-- A repair (or filling a gap) changes the starting point of later attribution,
-- even when the ledger itself has not changed. Keep those reports out of reads
-- until they have been recalculated against the new boundary.
CREATE FUNCTION "invalidate_later_snapshot_periods"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  revised_cutoff TIMESTAMP(3);
  affected_count BIGINT;
BEGIN
  SELECT "cutoffAt" INTO revised_cutoff
  FROM "PortfolioSnapshotRevision"
  WHERE "snapshotId" = NEW."id" AND "userId" = NEW."userId"
    AND "revision" = NEW."activeRevisionNumber";

  UPDATE "PortfolioSnapshot" header
  SET "lifecycleStatus" = 'STALE',
      "staleAt" = coalesce(header."staleAt", CURRENT_TIMESTAMP)
  FROM "PortfolioSnapshotRevision" revision
  WHERE header."userId" = NEW."userId" AND header."kind" = 'DAILY'
    AND revision."snapshotId" = header."id" AND revision."userId" = header."userId"
    AND revision."revision" = header."activeRevisionNumber"
    AND revision."cutoffAt" > revised_cutoff;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count > 0 THEN
    INSERT INTO "SnapshotRecalculationRequest" ("userId", "earliestAffectedAt", "ledgerRevision")
    SELECT NEW."userId", revised_cutoff, "ledgerRevision" FROM "User" WHERE "id" = NEW."userId"
    ON CONFLICT ("userId") DO UPDATE SET
      "earliestAffectedAt" = least("SnapshotRecalculationRequest"."earliestAffectedAt", EXCLUDED."earliestAffectedAt"),
      "ledgerRevision" = greatest("SnapshotRecalculationRequest"."ledgerRevision", EXCLUDED."ledgerRevision"),
      "requestedAt" = CURRENT_TIMESTAMP;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "PortfolioSnapshot_invalidate_later_periods"
AFTER UPDATE OF "activeRevisionNumber" ON "PortfolioSnapshot"
FOR EACH ROW
WHEN (OLD."activeRevisionNumber" IS DISTINCT FROM NEW."activeRevisionNumber")
EXECUTE FUNCTION "invalidate_later_snapshot_periods"();
