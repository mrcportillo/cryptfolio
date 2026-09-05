\set ON_ERROR_STOP on

\if :{?user_id}
\else
  \echo 'Missing -v user_id="auth0|..."'
  \quit 1
\endif
\if :{?adoption_at}
\else
  \echo 'Missing -v adoption_at="2026-08-20T15:30:00.000Z"'
  \quit 1
\endif
\if :{?expected_legacy_fingerprint}
\else
  \echo 'Missing -v expected_legacy_fingerprint="<dry-run sha256>"'
  \quit 1
\endif
\if :{?expected_archive_fingerprint}
\else
  \echo 'Missing -v expected_archive_fingerprint="<preflight sha256>"'
  \quit 1
\endif

BEGIN TRANSACTION READ ONLY;

SELECT set_config('cryptfolio.cutover_user_id', :'user_id', true);
SELECT set_config('cryptfolio.adoption_at', :'adoption_at', true);
SELECT set_config('cryptfolio.expected_legacy_fingerprint', :'expected_legacy_fingerprint', true);
SELECT set_config('cryptfolio.expected_archive_fingerprint', :'expected_archive_fingerprint', true);
\if :{?expected_opening_fingerprint}
  SELECT set_config('cryptfolio.expected_opening_fingerprint', :'expected_opening_fingerprint', true);
\else
  SELECT set_config('cryptfolio.expected_opening_fingerprint', '', true);
\endif

DO $$
DECLARE
  column_mismatches integer;
  index_mismatches integer;
  constraint_mismatches integer;
  trigger_mismatches integer;
  function_mismatches integer;
  ownership_mismatches integer;
  event_kinds text[];
  movement_roles text[];
BEGIN
  IF NOT has_schema_privilege(current_user, current_schema(), 'USAGE')
     OR NOT has_schema_privilege(current_user, current_schema(), 'CREATE') THEN
    RAISE EXCEPTION 'Current role % requires USAGE and CREATE on schema %', current_user, current_schema();
  END IF;

  SELECT count(*) INTO ownership_mismatches
  FROM pg_class table_record
  JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
  WHERE namespace_record.nspname = current_schema()
    AND table_record.relname IN (
      'User', 'UserAsset', 'AssetArchive', 'PortfolioEvent', 'AssetMovement'
    )
    AND (
      table_record.relkind <> 'r'
      OR NOT pg_has_role(current_user, table_record.relowner, 'USAGE')
    );

  IF ownership_mismatches <> 0 OR (
    SELECT count(*)
    FROM pg_class table_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
    WHERE namespace_record.nspname = current_schema()
      AND table_record.relname IN (
        'User', 'UserAsset', 'AssetArchive', 'PortfolioEvent', 'AssetMovement'
      )
      AND table_record.relkind = 'r'
  ) <> 5 THEN
    RAISE EXCEPTION 'Current role % must own, or be a member of the owner of, every ledger table', current_user;
  END IF;

  WITH expected(
    table_name,
    ordinal_position,
    column_name,
    udt_name,
    is_nullable,
    column_default,
    numeric_precision,
    numeric_scale,
    character_maximum_length,
    datetime_precision
  ) AS (
    VALUES
      ('User', 1, 'id', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('User', 2, 'name', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('User', 3, 'email', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('User', 4, 'ledgerAdoptedAt', 'timestamp', 'YES', NULL::text, NULL::integer, NULL::integer, NULL::integer, 3),
      ('User', 5, 'ledgerRevision', 'int8', 'NO', '0', 64, 0, NULL::integer, NULL::integer),
      ('UserAsset', 1, 'id', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 2, 'userId', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 3, 'assetId', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 4, 'assetName', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 5, 'amount', 'float8', 'NO', NULL::text, 53, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 6, 'date', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', NULL::integer, NULL::integer, NULL::integer, 3),
      ('UserAsset', 7, 'archivedAt', 'timestamp', 'YES', NULL::text, NULL::integer, NULL::integer, NULL::integer, 3),
      ('UserAsset', 8, 'ledgerInitialAssetName', 'varchar', 'YES', NULL::text, NULL::integer, NULL::integer, 80, NULL::integer),
      ('AssetArchive', 1, 'id', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('AssetArchive', 2, 'userAssetId', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('AssetArchive', 3, 'amount', 'float8', 'NO', NULL::text, 53, NULL::integer, NULL::integer, NULL::integer),
      ('AssetArchive', 4, 'date', 'timestamp', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, 3),
      ('PortfolioEvent', 1, 'id', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('PortfolioEvent', 2, 'userId', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('PortfolioEvent', 3, 'kind', 'PortfolioEventKind', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('PortfolioEvent', 4, 'occurredAt', 'timestamp', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, 3),
      ('PortfolioEvent', 5, 'externalFlowUsd', 'numeric', 'YES', NULL::text, 65, 30, NULL::integer, NULL::integer),
      ('PortfolioEvent', 6, 'feeUsd', 'numeric', 'YES', NULL::text, 65, 30, NULL::integer, NULL::integer),
      ('PortfolioEvent', 7, 'idempotencyKey', 'varchar', 'NO', NULL::text, NULL::integer, NULL::integer, 160, NULL::integer),
      ('PortfolioEvent', 8, 'openingForUserAssetId', 'text', 'YES', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('PortfolioEvent', 9, 'reversalOfEventId', 'text', 'YES', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('PortfolioEvent', 10, 'createdAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', NULL::integer, NULL::integer, NULL::integer, 3),
      ('PortfolioEvent', 11, 'actualValueUsd', 'numeric', 'YES', NULL::text, 65, 30, NULL::integer, NULL::integer),
      ('PortfolioEvent', 12, 'note', 'varchar', 'YES', NULL::text, NULL::integer, NULL::integer, 500, NULL::integer),
      ('PortfolioEvent', 13, 'replacementForEventId', 'text', 'YES', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('AssetMovement', 1, 'id', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('AssetMovement', 2, 'userId', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('AssetMovement', 3, 'portfolioEventId', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('AssetMovement', 4, 'userAssetId', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('AssetMovement', 5, 'quantityDelta', 'numeric', 'NO', NULL::text, 65, 30, NULL::integer, NULL::integer),
      ('AssetMovement', 6, 'unitPriceUsd', 'numeric', 'YES', NULL::text, 65, 30, NULL::integer, NULL::integer),
      ('AssetMovement', 7, 'priceEstimated', 'bool', 'NO', 'false', NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('AssetMovement', 8, 'createdAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', NULL::integer, NULL::integer, NULL::integer, 3),
      ('AssetMovement', 9, 'role', 'AssetMovementRole', 'NO', '''PRINCIPAL''::"AssetMovementRole"', NULL::integer, NULL::integer, NULL::integer, NULL::integer)
  ), actual AS (
    SELECT
      column_record.table_name,
      column_record.ordinal_position,
      column_record.column_name,
      column_record.udt_name,
      column_record.is_nullable,
      CASE
        WHEN column_record.column_default IS NULL THEN NULL
        ELSE regexp_replace(column_record.column_default, '\s+', '', 'g')
      END AS column_default,
      column_record.numeric_precision,
      column_record.numeric_scale,
      column_record.character_maximum_length,
      column_record.datetime_precision
    FROM information_schema.columns column_record
    WHERE column_record.table_schema = current_schema()
      AND column_record.table_name IN (
        'User', 'UserAsset', 'AssetArchive', 'PortfolioEvent', 'AssetMovement'
      )
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO column_mismatches FROM differences;

  WITH expected(
    index_name,
    table_name,
    is_unique,
    is_primary,
    is_exclusion,
    key_columns,
    access_method,
    has_no_expression,
    has_no_predicate,
    is_valid,
    is_ready
  ) AS (
    VALUES
      ('User_pkey', 'User', true, true, false, ARRAY['id']::text[], 'btree', true, true, true, true),
      ('User_email_key', 'User', true, false, false, ARRAY['email']::text[], 'btree', true, true, true, true),
      ('UserAsset_pkey', 'UserAsset', true, true, false, ARRAY['id']::text[], 'btree', true, true, true, true),
      ('UserAsset_userId_date_idx', 'UserAsset', false, false, false, ARRAY['userId', 'date']::text[], 'btree', true, true, true, true),
      ('UserAsset_assetId_idx', 'UserAsset', false, false, false, ARRAY['assetId']::text[], 'btree', true, true, true, true),
      ('UserAsset_id_userId_key', 'UserAsset', true, false, false, ARRAY['id', 'userId']::text[], 'btree', true, true, true, true),
      ('UserAsset_userId_archivedAt_date_idx', 'UserAsset', false, false, false, ARRAY['userId', 'archivedAt', 'date']::text[], 'btree', true, true, true, true),
      ('AssetArchive_pkey', 'AssetArchive', true, true, false, ARRAY['id']::text[], 'btree', true, true, true, true),
      ('AssetArchive_userAssetId_date_idx', 'AssetArchive', false, false, false, ARRAY['userAssetId', 'date']::text[], 'btree', true, true, true, true),
      ('PortfolioEvent_pkey', 'PortfolioEvent', true, true, false, ARRAY['id']::text[], 'btree', true, true, true, true),
      ('PortfolioEvent_id_userId_key', 'PortfolioEvent', true, false, false, ARRAY['id', 'userId']::text[], 'btree', true, true, true, true),
      ('PortfolioEvent_userId_idempotencyKey_key', 'PortfolioEvent', true, false, false, ARRAY['userId', 'idempotencyKey']::text[], 'btree', true, true, true, true),
      ('PortfolioEvent_openingForUserAssetId_userId_key', 'PortfolioEvent', true, false, false, ARRAY['openingForUserAssetId', 'userId']::text[], 'btree', true, true, true, true),
      ('PortfolioEvent_reversalOfEventId_userId_key', 'PortfolioEvent', true, false, false, ARRAY['reversalOfEventId', 'userId']::text[], 'btree', true, true, true, true),
      ('PortfolioEvent_replacementForEventId_userId_key', 'PortfolioEvent', true, false, false, ARRAY['replacementForEventId', 'userId']::text[], 'btree', true, true, true, true),
      ('PortfolioEvent_userId_occurredAt_id_idx', 'PortfolioEvent', false, false, false, ARRAY['userId', 'occurredAt', 'id']::text[], 'btree', true, true, true, true),
      ('AssetMovement_pkey', 'AssetMovement', true, true, false, ARRAY['id']::text[], 'btree', true, true, true, true),
      ('AssetMovement_userId_userAssetId_createdAt_id_idx', 'AssetMovement', false, false, false, ARRAY['userId', 'userAssetId', 'createdAt', 'id']::text[], 'btree', true, true, true, true),
      ('AssetMovement_userId_portfolioEventId_idx', 'AssetMovement', false, false, false, ARRAY['userId', 'portfolioEventId']::text[], 'btree', true, true, true, true),
      ('AssetMovement_portfolioEventId_userAssetId_role_key', 'AssetMovement', true, false, false, ARRAY['portfolioEventId', 'userAssetId', 'role']::text[], 'btree', true, true, true, true)
  ), actual AS (
    SELECT
      index_class.relname AS index_name,
      table_class.relname AS table_name,
      index_record.indisunique AS is_unique,
      index_record.indisprimary AS is_primary,
      index_record.indisexclusion AS is_exclusion,
      array_agg(attribute_record.attname::text ORDER BY key_record.position) AS key_columns,
      access_method.amname AS access_method,
      index_record.indexprs IS NULL AS has_no_expression,
      index_record.indpred IS NULL AS has_no_predicate,
      index_record.indisvalid AS is_valid,
      index_record.indisready AS is_ready
    FROM pg_index index_record
    JOIN pg_class index_class ON index_class.oid = index_record.indexrelid
    JOIN pg_class table_class ON table_class.oid = index_record.indrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid = table_class.relnamespace
    JOIN pg_am access_method ON access_method.oid = index_class.relam
    CROSS JOIN LATERAL unnest(index_record.indkey)
      WITH ORDINALITY AS key_record(attribute_number, position)
    JOIN pg_attribute attribute_record
      ON attribute_record.attrelid = table_class.oid
     AND attribute_record.attnum = key_record.attribute_number
    WHERE namespace_record.nspname = current_schema()
      AND table_class.relname IN (
        'User', 'UserAsset', 'AssetArchive', 'PortfolioEvent', 'AssetMovement'
      )
      AND key_record.position <= index_record.indnkeyatts
      AND index_record.indnkeyatts = index_record.indnatts
    GROUP BY
      index_class.relname,
      table_class.relname,
      index_record.indisunique,
      index_record.indisprimary,
      index_record.indisexclusion,
      access_method.amname,
      index_record.indexprs,
      index_record.indpred,
      index_record.indisvalid,
      index_record.indisready
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO index_mismatches FROM differences;

  WITH expected(table_name, constraint_name, definition) AS (
    VALUES
      ('User', 'User_pkey', 'PRIMARY KEY (id)'),
      ('User', 'User_nonnegative_ledger_revision_check', 'CHECK ("ledgerRevision" >= 0)'),
      ('User', 'User_finite_ledger_adopted_at_check', 'CHECK ("ledgerAdoptedAt" IS NULL OR isfinite("ledgerAdoptedAt"))'),
      ('UserAsset', 'UserAsset_pkey', 'PRIMARY KEY (id)'),
      ('UserAsset', 'UserAsset_userId_fkey', 'FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE'),
      ('UserAsset', 'UserAsset_finite_amount_check', 'CHECK (lower(amount::text) <> ALL (ARRAY[''nan''::text, ''infinity''::text, ''-infinity''::text]))'),
      ('UserAsset', 'UserAsset_finite_date_check', 'CHECK (isfinite(date))'),
      ('UserAsset', 'UserAsset_finite_archived_at_check', 'CHECK ("archivedAt" IS NULL OR isfinite("archivedAt"))'),
      ('AssetArchive', 'AssetArchive_pkey', 'PRIMARY KEY (id)'),
      ('AssetArchive', 'AssetArchive_userAssetId_fkey', 'FOREIGN KEY ("userAssetId") REFERENCES "UserAsset"(id) ON UPDATE CASCADE ON DELETE CASCADE'),
      ('AssetArchive', 'AssetArchive_finite_amount_check', 'CHECK (lower(amount::text) <> ALL (ARRAY[''nan''::text, ''infinity''::text, ''-infinity''::text]))'),
      ('AssetArchive', 'AssetArchive_finite_date_check', 'CHECK (isfinite(date))'),
      ('PortfolioEvent', 'PortfolioEvent_pkey', 'PRIMARY KEY (id)'),
      ('PortfolioEvent', 'PortfolioEvent_opening_shape_check', 'CHECK (kind = ''OPENING_BALANCE''::"PortfolioEventKind" AND "openingForUserAssetId" IS NOT NULL OR kind <> ''OPENING_BALANCE''::"PortfolioEventKind" AND "openingForUserAssetId" IS NULL)'),
      ('PortfolioEvent', 'PortfolioEvent_opening_zero_flow_check', 'CHECK (kind <> ''OPENING_BALANCE''::"PortfolioEventKind" OR "externalFlowUsd" IS NOT NULL AND "externalFlowUsd" = 0::numeric AND "feeUsd" IS NOT NULL AND "feeUsd" = 0::numeric)'),
      ('PortfolioEvent', 'PortfolioEvent_reversal_shape_check', 'CHECK (kind = ''REVERSAL''::"PortfolioEventKind" AND "reversalOfEventId" IS NOT NULL OR kind <> ''REVERSAL''::"PortfolioEventKind" AND "reversalOfEventId" IS NULL)'),
      ('PortfolioEvent', 'PortfolioEvent_fee_sign_check', 'CHECK (kind = ''REVERSAL''::"PortfolioEventKind" OR "feeUsd" IS NULL OR "feeUsd" >= 0::numeric)'),
      ('PortfolioEvent', 'PortfolioEvent_not_self_reversal_check', 'CHECK ("reversalOfEventId" IS NULL OR id <> "reversalOfEventId")'),
      ('PortfolioEvent', 'PortfolioEvent_actual_value_sign_check', 'CHECK ("actualValueUsd" IS NULL OR kind = ''REVERSAL''::"PortfolioEventKind" AND "actualValueUsd" <= 0::numeric OR kind <> ''REVERSAL''::"PortfolioEventKind" AND "actualValueUsd" > 0::numeric)'),
      ('PortfolioEvent', 'PortfolioEvent_replacement_shape_check', 'CHECK ("replacementForEventId" IS NULL OR (kind <> ALL (ARRAY[''OPENING_BALANCE''::"PortfolioEventKind", ''REVERSAL''::"PortfolioEventKind"])))'),
      ('PortfolioEvent', 'PortfolioEvent_not_self_replacement_check', 'CHECK ("replacementForEventId" IS NULL OR id <> "replacementForEventId")'),
      ('PortfolioEvent', 'PortfolioEvent_note_length_check', 'CHECK (note IS NULL OR char_length(note::text) <= 500)'),
      ('PortfolioEvent', 'PortfolioEvent_opening_actual_value_check', 'CHECK (kind <> ''OPENING_BALANCE''::"PortfolioEventKind" OR "actualValueUsd" IS NULL)'),
      ('PortfolioEvent', 'PortfolioEvent_finite_actual_value_check', 'CHECK ("actualValueUsd" IS NULL OR (lower("actualValueUsd"::text) <> ALL (ARRAY[''nan''::text, ''infinity''::text, ''-infinity''::text])))'),
      ('PortfolioEvent', 'PortfolioEvent_finite_external_flow_check', 'CHECK ("externalFlowUsd" IS NULL OR (lower("externalFlowUsd"::text) <> ALL (ARRAY[''nan''::text, ''infinity''::text, ''-infinity''::text])))'),
      ('PortfolioEvent', 'PortfolioEvent_finite_fee_check', 'CHECK ("feeUsd" IS NULL OR (lower("feeUsd"::text) <> ALL (ARRAY[''nan''::text, ''infinity''::text, ''-infinity''::text])))'),
      ('PortfolioEvent', 'PortfolioEvent_finite_occurred_at_check', 'CHECK (isfinite("occurredAt"))'),
      ('PortfolioEvent', 'PortfolioEvent_finite_created_at_check', 'CHECK (isfinite("createdAt"))'),
      ('PortfolioEvent', 'PortfolioEvent_userId_fkey', 'FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT'),
      ('PortfolioEvent', 'PortfolioEvent_openingForUserAssetId_userId_fkey', 'FOREIGN KEY ("openingForUserAssetId", "userId") REFERENCES "UserAsset"(id, "userId") ON UPDATE CASCADE ON DELETE RESTRICT'),
      ('PortfolioEvent', 'PortfolioEvent_reversalOfEventId_userId_fkey', 'FOREIGN KEY ("reversalOfEventId", "userId") REFERENCES "PortfolioEvent"(id, "userId") ON UPDATE CASCADE ON DELETE RESTRICT'),
      ('PortfolioEvent', 'PortfolioEvent_replacementForEventId_userId_fkey', 'FOREIGN KEY ("replacementForEventId", "userId") REFERENCES "PortfolioEvent"(id, "userId") ON UPDATE CASCADE ON DELETE RESTRICT'),
      ('PortfolioEvent', 'PortfolioEvent_exactly_one_opening_movement_check', 'TRIGGER DEFERRABLE INITIALLY DEFERRED'),
      ('PortfolioEvent', 'PortfolioEvent_manual_semantics_check', 'TRIGGER DEFERRABLE INITIALLY DEFERRED'),
      ('AssetMovement', 'AssetMovement_pkey', 'PRIMARY KEY (id)'),
      ('AssetMovement', 'AssetMovement_nonzero_quantity_check', 'CHECK ("quantityDelta" <> 0::numeric)'),
      ('AssetMovement', 'AssetMovement_positive_unit_price_check', 'CHECK ("unitPriceUsd" IS NULL OR "unitPriceUsd" > 0::numeric)'),
      ('AssetMovement', 'AssetMovement_finite_quantity_check', 'CHECK (lower("quantityDelta"::text) <> ALL (ARRAY[''nan''::text, ''infinity''::text, ''-infinity''::text]))'),
      ('AssetMovement', 'AssetMovement_finite_unit_price_check', 'CHECK ("unitPriceUsd" IS NULL OR (lower("unitPriceUsd"::text) <> ALL (ARRAY[''nan''::text, ''infinity''::text, ''-infinity''::text])))'),
      ('AssetMovement', 'AssetMovement_finite_created_at_check', 'CHECK (isfinite("createdAt"))'),
      ('AssetMovement', 'AssetMovement_portfolioEventId_userId_fkey', 'FOREIGN KEY ("portfolioEventId", "userId") REFERENCES "PortfolioEvent"(id, "userId") ON UPDATE CASCADE ON DELETE RESTRICT'),
      ('AssetMovement', 'AssetMovement_userAssetId_userId_fkey', 'FOREIGN KEY ("userAssetId", "userId") REFERENCES "UserAsset"(id, "userId") ON UPDATE CASCADE ON DELETE RESTRICT'),
      ('AssetMovement', 'AssetMovement_exactly_one_opening_movement_check', 'TRIGGER DEFERRABLE INITIALLY DEFERRED'),
      ('AssetMovement', 'AssetMovement_manual_semantics_check', 'TRIGGER DEFERRABLE INITIALLY DEFERRED'),
      ('AssetMovement', 'AssetMovement_nonnegative_timeline_check', 'TRIGGER DEFERRABLE INITIALLY DEFERRED')
  ), actual AS (
    SELECT
      table_record.relname AS table_name,
      constraint_record.conname AS constraint_name,
      regexp_replace(
        pg_get_constraintdef(constraint_record.oid, true),
        '\s+',
        ' ',
        'g'
      ) AS definition
    FROM pg_constraint constraint_record
    JOIN pg_class table_record ON table_record.oid = constraint_record.conrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
    WHERE namespace_record.nspname = current_schema()
      AND table_record.relname IN (
        'User', 'UserAsset', 'AssetArchive', 'PortfolioEvent', 'AssetMovement'
      )
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO constraint_mismatches FROM differences;

  WITH expected(
    trigger_name,
    table_name,
    is_deferrable,
    is_initially_deferred,
    enabled_state,
    function_name,
    is_row,
    is_after,
    fires_insert,
    fires_update,
    fires_delete,
    fires_truncate,
    is_instead_of,
    has_no_when,
    argument_count,
    definition
  ) AS (
    VALUES
      ('PortfolioEvent_exactly_one_opening_movement_check', 'PortfolioEvent', true, true, 'O'::"char", 'enforce_opening_event_movement', true, true, true, true, true, false, false, true, 0, 'CREATE CONSTRAINT TRIGGER "PortfolioEvent_exactly_one_opening_movement_check" AFTER INSERT OR DELETE OR UPDATE ON "PortfolioEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_opening_event_movement()'),
      ('AssetMovement_exactly_one_opening_movement_check', 'AssetMovement', true, true, 'O'::"char", 'enforce_opening_event_movement', true, true, true, true, true, false, false, true, 0, 'CREATE CONSTRAINT TRIGGER "AssetMovement_exactly_one_opening_movement_check" AFTER INSERT OR DELETE OR UPDATE ON "AssetMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_opening_event_movement()'),
      ('PortfolioEvent_manual_semantics_check', 'PortfolioEvent', true, true, 'O'::"char", 'enforce_manual_event_semantics', true, true, true, false, false, false, false, true, 0, 'CREATE CONSTRAINT TRIGGER "PortfolioEvent_manual_semantics_check" AFTER INSERT ON "PortfolioEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_manual_event_semantics()'),
      ('AssetMovement_manual_semantics_check', 'AssetMovement', true, true, 'O'::"char", 'enforce_manual_event_semantics', true, true, true, false, false, false, false, true, 0, 'CREATE CONSTRAINT TRIGGER "AssetMovement_manual_semantics_check" AFTER INSERT ON "AssetMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_manual_event_semantics()'),
      ('AssetMovement_nonnegative_timeline_check', 'AssetMovement', true, true, 'O'::"char", 'enforce_nonnegative_asset_timeline', true, true, true, false, false, false, false, true, 0, 'CREATE CONSTRAINT TRIGGER "AssetMovement_nonnegative_timeline_check" AFTER INSERT ON "AssetMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_nonnegative_asset_timeline()'),
      ('AssetMovement_owner_write_serialization', 'AssetMovement', false, false, 'O'::"char", 'serialize_ledger_owner_write', true, false, true, false, false, false, false, true, 0, 'CREATE TRIGGER "AssetMovement_owner_write_serialization" BEFORE INSERT ON "AssetMovement" FOR EACH ROW EXECUTE FUNCTION serialize_ledger_owner_write()'),
      ('PortfolioEvent_immutable', 'PortfolioEvent', false, false, 'O'::"char", 'protect_immutable_ledger_record', true, false, false, true, true, false, false, true, 0, 'CREATE TRIGGER "PortfolioEvent_immutable" BEFORE DELETE OR UPDATE ON "PortfolioEvent" FOR EACH ROW EXECUTE FUNCTION protect_immutable_ledger_record()'),
      ('AssetMovement_immutable', 'AssetMovement', false, false, 'O'::"char", 'protect_immutable_ledger_record', true, false, false, true, true, false, false, true, 0, 'CREATE TRIGGER "AssetMovement_immutable" BEFORE DELETE OR UPDATE ON "AssetMovement" FOR EACH ROW EXECUTE FUNCTION protect_immutable_ledger_record()'),
      ('User_ledger_adoption_boundary_guard', 'User', false, false, 'O'::"char", 'guard_ledger_adoption_boundary', true, false, true, true, false, false, false, true, 0, 'CREATE TRIGGER "User_ledger_adoption_boundary_guard" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION guard_ledger_adoption_boundary()'),
      ('UserAsset_adopted_legacy_fields_frozen', 'UserAsset', false, false, 'O'::"char", 'protect_adopted_legacy_position', true, false, true, true, true, false, false, true, 0, 'CREATE TRIGGER "UserAsset_adopted_legacy_fields_frozen" BEFORE INSERT OR DELETE OR UPDATE ON "UserAsset" FOR EACH ROW EXECUTE FUNCTION protect_adopted_legacy_position()'),
      ('AssetArchive_adopted_history_frozen', 'AssetArchive', false, false, 'O'::"char", 'protect_adopted_asset_archive', true, false, true, true, true, false, false, true, 0, 'CREATE TRIGGER "AssetArchive_adopted_history_frozen" BEFORE INSERT OR DELETE OR UPDATE ON "AssetArchive" FOR EACH ROW EXECUTE FUNCTION protect_adopted_asset_archive()'),
      ('AssetMovement_snapshot_invalidation', 'AssetMovement', false, false, 'O'::"char", 'invalidate_snapshots_for_movement', true, true, true, false, false, false, false, true, 0, 'CREATE TRIGGER "AssetMovement_snapshot_invalidation" AFTER INSERT ON "AssetMovement" FOR EACH ROW EXECUTE FUNCTION invalidate_snapshots_for_movement()')
  ), actual AS (
    SELECT
      trigger_record.tgname AS trigger_name,
      table_record.relname AS table_name,
      trigger_record.tgdeferrable AS is_deferrable,
      trigger_record.tginitdeferred AS is_initially_deferred,
      trigger_record.tgenabled AS enabled_state,
      procedure_record.proname AS function_name,
      (trigger_record.tgtype & 1) <> 0 AS is_row,
      (trigger_record.tgtype & (2 | 64)) = 0 AS is_after,
      (trigger_record.tgtype & 4) <> 0 AS fires_insert,
      (trigger_record.tgtype & 16) <> 0 AS fires_update,
      (trigger_record.tgtype & 8) <> 0 AS fires_delete,
      (trigger_record.tgtype & 32) <> 0 AS fires_truncate,
      (trigger_record.tgtype & 64) <> 0 AS is_instead_of,
      trigger_record.tgqual IS NULL AS has_no_when,
      trigger_record.tgnargs AS argument_count,
      regexp_replace(
        pg_get_triggerdef(trigger_record.oid, true),
        '\s+',
        ' ',
        'g'
      ) AS definition
    FROM pg_trigger trigger_record
    JOIN pg_class table_record ON table_record.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
    JOIN pg_proc procedure_record ON procedure_record.oid = trigger_record.tgfoid
    WHERE namespace_record.nspname = current_schema()
      AND table_record.relname IN (
        'User', 'UserAsset', 'AssetArchive', 'PortfolioEvent', 'AssetMovement'
      )
      AND NOT trigger_record.tgisinternal
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO trigger_mismatches FROM differences;

  WITH expected(
    function_name,
    identity_arguments,
    result_type,
    volatility,
    is_security_definer,
    is_strict,
    parallel_safety,
    configuration,
    source_md5
  ) AS (
    VALUES
      ('assert_opening_event_movement', 'target_event_id text', 'void', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], '460a1f024cfa3de5c7bc789cd576f35b'),
      ('enforce_opening_event_movement', '', 'trigger', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], '8c5ca354321de23c6e57f8ed4f24ff46'),
      ('assert_ledger_adoption_boundary', 'target_user_id text, target_adoption_at timestamp without time zone', 'void', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], '9c4d1ee2ae87827829eaa2da5eac7271'),
      ('guard_ledger_adoption_boundary', '', 'trigger', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], '356d8fc06a7a4c687dfd62ad5bb72fe7'),
      ('assert_manual_event_semantics', 'target_event_id text', 'void', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], 'c1cc6ab46d0b7055de6c797ccdea54c6'),
      ('enforce_manual_event_semantics', '', 'trigger', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], 'dff7561857f192591513045f692e4d55'),
      ('assert_nonnegative_asset_timeline', 'target_user_id text, target_user_asset_id text', 'void', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], 'a8ed8bdbc1b48b79147ae791d346d148'),
      ('enforce_nonnegative_asset_timeline', '', 'trigger', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], '25a52e747bd6fc625d4abf67c1be18a6'),
      ('serialize_ledger_owner_write', '', 'trigger', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], 'af28d762698ed1b15b21ae4e0c4df318'),
      ('protect_adopted_legacy_position', '', 'trigger', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], 'd7dcebb7154e9eb6b7bafa503dd0d496'),
      ('protect_adopted_asset_archive', '', 'trigger', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], '7067d8875da1f3c0c2658f577775baf1'),
      ('protect_immutable_ledger_record', '', 'trigger', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], '3db46e89875a209fd3c65f84938d9089'),
      ('invalidate_snapshots_for_movement', '', 'trigger', 'v'::"char", false, false, 'u'::"char", ARRAY['search_path=' || current_schema()]::text[], '8d1aa1899880f8f5a1056a600a46a5c2')
  ), actual AS (
    SELECT
      procedure_record.proname AS function_name,
      pg_get_function_identity_arguments(procedure_record.oid) AS identity_arguments,
      pg_get_function_result(procedure_record.oid) AS result_type,
      procedure_record.provolatile AS volatility,
      procedure_record.prosecdef AS is_security_definer,
      procedure_record.proisstrict AS is_strict,
      procedure_record.proparallel AS parallel_safety,
      procedure_record.proconfig AS configuration,
      md5(procedure_record.prosrc) AS source_md5
    FROM pg_proc procedure_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = procedure_record.pronamespace
    JOIN pg_language language_record ON language_record.oid = procedure_record.prolang
    WHERE namespace_record.nspname = current_schema()
      AND procedure_record.proname IN (
        'assert_opening_event_movement', 'enforce_opening_event_movement',
        'assert_ledger_adoption_boundary', 'guard_ledger_adoption_boundary',
        'assert_manual_event_semantics', 'enforce_manual_event_semantics',
        'assert_nonnegative_asset_timeline', 'enforce_nonnegative_asset_timeline',
        'serialize_ledger_owner_write',
        'protect_adopted_legacy_position', 'protect_adopted_asset_archive',
        'protect_immutable_ledger_record', 'invalidate_snapshots_for_movement'
      )
      AND language_record.lanname = 'plpgsql'
      AND pg_has_role(current_user, procedure_record.proowner, 'USAGE')
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO function_mismatches FROM differences;

  SELECT array_agg(enum_label ORDER BY enum_order) INTO event_kinds
  FROM (
    SELECT enum_record.enumlabel::text AS enum_label, enum_record.enumsortorder AS enum_order
    FROM pg_type type_record
    JOIN pg_enum enum_record ON enum_record.enumtypid = type_record.oid
    JOIN pg_namespace namespace_record ON namespace_record.oid = type_record.typnamespace
    WHERE namespace_record.nspname = current_schema()
      AND type_record.typname = 'PortfolioEventKind'
  ) kinds;

  SELECT array_agg(enum_label ORDER BY enum_order) INTO movement_roles
  FROM (
    SELECT enum_record.enumlabel::text AS enum_label, enum_record.enumsortorder AS enum_order
    FROM pg_type type_record
    JOIN pg_enum enum_record ON enum_record.enumtypid = type_record.oid
    JOIN pg_namespace namespace_record ON namespace_record.oid = type_record.typnamespace
    WHERE namespace_record.nspname = current_schema()
      AND type_record.typname = 'AssetMovementRole'
  ) roles;

  IF column_mismatches <> 0
     OR constraint_mismatches <> 0
     OR index_mismatches <> 0
     OR trigger_mismatches <> 0
     OR function_mismatches <> 0 THEN
    RAISE EXCEPTION
      'Ledger schema mismatch: % column, % constraint, % index, % trigger, % function definition differences',
      column_mismatches,
      constraint_mismatches,
      index_mismatches,
      trigger_mismatches,
      function_mismatches;
  END IF;

  IF event_kinds IS DISTINCT FROM ARRAY[
    'OPENING_BALANCE', 'BUY', 'SELL', 'TRANSFER_IN',
    'TRANSFER_OUT', 'SWAP', 'FEE', 'REVERSAL'
  ] THEN
    RAISE EXCEPTION 'PortfolioEventKind mismatch: %', event_kinds;
  END IF;

  IF movement_roles IS DISTINCT FROM ARRAY['PRINCIPAL', 'FEE'] THEN
    RAISE EXCEPTION 'AssetMovementRole mismatch: %', movement_roles;
  END IF;
END
$$;

DO $$
DECLARE
  cutover_user_id text := current_setting('cryptfolio.cutover_user_id');
  adoption_timestamp timestamp(3) := current_setting('cryptfolio.adoption_at')::timestamptz AT TIME ZONE 'UTC';
  legacy_position record;
  source_quantity numeric;
  ledger_quantity numeric(65,30);
  event_count integer;
  movement_count integer;
  derived_quantity numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "User"
    WHERE "id" = cutover_user_id
      AND "ledgerAdoptedAt" = adoption_timestamp
  ) THEN
    RAISE EXCEPTION 'Ledger adoption boundary is missing or different';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PortfolioEvent" event
    LEFT JOIN "UserAsset" owned_position
      ON owned_position."id" = event."openingForUserAssetId"
     AND owned_position."userId" = event."userId"
    WHERE event."userId" = cutover_user_id
      AND event."kind" = 'OPENING_BALANCE'
      AND owned_position."id" IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "AssetMovement" movement
    LEFT JOIN "PortfolioEvent" event
      ON event."id" = movement."portfolioEventId"
     AND event."userId" = movement."userId"
    LEFT JOIN "UserAsset" owned_position
      ON owned_position."id" = movement."userAssetId"
     AND owned_position."userId" = movement."userId"
    WHERE movement."userId" = cutover_user_id
      AND (event."id" IS NULL OR owned_position."id" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Ledger records crossed or lost an ownership boundary';
  END IF;

  FOR legacy_position IN
    SELECT "id", "amount"::text AS amount_text
    FROM "UserAsset"
    WHERE "userId" = cutover_user_id
      AND "date" <= adoption_timestamp
    ORDER BY "id"
  LOOP
    IF legacy_position.amount_text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Position % has non-finite quantity', legacy_position.id;
    END IF;

    BEGIN
      source_quantity := legacy_position.amount_text::numeric;
      ledger_quantity := legacy_position.amount_text::numeric(65,30);
    EXCEPTION
      WHEN numeric_value_out_of_range OR invalid_text_representation THEN
        RAISE EXCEPTION 'Position % is not representable as numeric(65,30)', legacy_position.id;
    END;

    IF source_quantity < 0 OR source_quantity <> ledger_quantity THEN
      RAISE EXCEPTION 'Position % has an invalid or rounded legacy quantity', legacy_position.id;
    END IF;

    SELECT
      count(DISTINCT event."id"),
      count(movement."id"),
      coalesce(sum(movement."quantityDelta"), 0)
    INTO event_count, movement_count, derived_quantity
    FROM "PortfolioEvent" event
    LEFT JOIN "AssetMovement" movement
      ON movement."portfolioEventId" = event."id"
     AND movement."userId" = event."userId"
    WHERE event."userId" = cutover_user_id
      AND event."kind" = 'OPENING_BALANCE'
      AND event."openingForUserAssetId" = legacy_position.id
      AND event."occurredAt" = adoption_timestamp
      AND event."actualValueUsd" IS NULL
      AND event."externalFlowUsd" = 0
      AND event."feeUsd" = 0
      AND event."note" IS NULL
      AND event."idempotencyKey" = 'opening:v1:' || legacy_position.id
      AND (
        movement."id" IS NULL
        OR (
          movement."userAssetId" = legacy_position.id
          AND movement."role" = 'PRINCIPAL'
          AND movement."unitPriceUsd" IS NULL
          AND movement."priceEstimated" = false
        )
      );

    IF source_quantity = 0 AND (event_count <> 0 OR movement_count <> 0) THEN
      RAISE EXCEPTION 'Zero position % received an opening event', legacy_position.id;
    END IF;

    IF source_quantity > 0 AND (
      event_count <> 1 OR movement_count <> 1 OR derived_quantity <> source_quantity
    ) THEN
      RAISE EXCEPTION
        'Position % opening mismatch: events %, movements %, derived %, expected %',
        legacy_position.id,
        event_count,
        movement_count,
        derived_quantity,
        source_quantity;
    END IF;

  END LOOP;

  SELECT count(*) INTO event_count
  FROM "PortfolioEvent"
  WHERE "userId" = cutover_user_id
    AND "kind" = 'OPENING_BALANCE';

  SELECT count(*) INTO movement_count
  FROM "UserAsset"
  WHERE "userId" = cutover_user_id
    AND "date" <= adoption_timestamp
    AND "amount" > 0;

  IF event_count <> movement_count THEN
    RAISE EXCEPTION 'Opening event count % does not match positive position count %', event_count, movement_count;
  END IF;
END
$$;

DO $$
DECLARE
  actual_fingerprint text;
BEGIN
  WITH legacy AS (
    SELECT
      "id", "userId", "assetId",
      coalesce("ledgerInitialAssetName", "assetName") AS "assetName",
      "amount"::text AS amount_text,
      to_char("date", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS date_text
    FROM "UserAsset"
    WHERE "userId" = current_setting('cryptfolio.cutover_user_id')
      AND "date" <= (
        current_setting('cryptfolio.adoption_at')::timestamptz AT TIME ZONE 'UTC'
      )
  ), records AS (
    SELECT string_agg(concat(
      octet_length("id"), ':', "id", '|',
      octet_length("userId"), ':', "userId", '|',
      octet_length("assetId"), ':', "assetId", '|',
      octet_length("assetName"), ':', "assetName", '|',
      octet_length(amount_text), ':', amount_text, '|',
      octet_length(date_text), ':', date_text
    ), E'\n' ORDER BY "id" COLLATE "C") AS value
    FROM legacy
  )
  SELECT encode(sha256(convert_to(concat(
    'portfolio-opening-v1', E'\n',
    octet_length(current_setting('cryptfolio.cutover_user_id')), ':',
    current_setting('cryptfolio.cutover_user_id'), E'\n',
    coalesce(value, '')
  ), 'UTF8')), 'hex') INTO actual_fingerprint
  FROM records;

  IF actual_fingerprint <> current_setting('cryptfolio.expected_legacy_fingerprint') THEN
    RAISE EXCEPTION 'Legacy fingerprint changed: %', actual_fingerprint;
  END IF;

  PERFORM set_config('cryptfolio.verified_legacy_fingerprint', actual_fingerprint, true);
END
$$;

SELECT current_setting('cryptfolio.verified_legacy_fingerprint') AS verified_legacy_fingerprint;

DO $$
DECLARE
  actual_fingerprint text;
BEGIN
  WITH archives AS (
    SELECT
      archive."id",
      archive."userAssetId",
      archive."amount"::text AS amount_text,
      to_char(archive."date", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS date_text
    FROM "AssetArchive" archive
    JOIN "UserAsset" position ON position."id" = archive."userAssetId"
    WHERE position."userId" = current_setting('cryptfolio.cutover_user_id')
  )
  SELECT encode(sha256(convert_to(coalesce(string_agg(concat(
    octet_length("id"), ':', "id", '|',
    octet_length("userAssetId"), ':', "userAssetId", '|',
    octet_length(amount_text), ':', amount_text, '|',
    octet_length(date_text), ':', date_text
  ), E'\n' ORDER BY "id" COLLATE "C"), ''), 'UTF8')), 'hex') INTO actual_fingerprint
  FROM archives;

  IF actual_fingerprint <> current_setting('cryptfolio.expected_archive_fingerprint') THEN
    RAISE EXCEPTION 'AssetArchive fingerprint changed: %', actual_fingerprint;
  END IF;
END
$$;

DO $$
DECLARE
  expected_fingerprint text := current_setting('cryptfolio.expected_opening_fingerprint');
  actual_fingerprint text;
BEGIN
  WITH opening_records AS (
    SELECT concat(
      octet_length(event."id"), ':', event."id", '|',
      octet_length(event."userId"), ':', event."userId", '|',
      octet_length(event."kind"::text), ':', event."kind"::text, '|',
      octet_length(to_char(event."occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), ':', to_char(event."occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '|',
      octet_length(event."externalFlowUsd"::text), ':', event."externalFlowUsd"::text, '|',
      octet_length(event."feeUsd"::text), ':', event."feeUsd"::text, '|',
      octet_length(event."idempotencyKey"), ':', event."idempotencyKey", '|',
      octet_length(event."openingForUserAssetId"), ':', event."openingForUserAssetId", '|',
      octet_length(coalesce(movement."id", '')), ':', coalesce(movement."id", ''), '|',
      octet_length(coalesce(movement."userId", '')), ':', coalesce(movement."userId", ''), '|',
      octet_length(coalesce(movement."userAssetId", '')), ':', coalesce(movement."userAssetId", ''), '|',
      octet_length(coalesce(movement."quantityDelta"::text, '')), ':', coalesce(movement."quantityDelta"::text, ''), '|',
      octet_length(coalesce(movement."unitPriceUsd"::text, '')), ':', coalesce(movement."unitPriceUsd"::text, ''), '|',
      octet_length(coalesce(movement."priceEstimated"::text, '')), ':', coalesce(movement."priceEstimated"::text, '')
    ) AS value
    FROM "PortfolioEvent" event
    LEFT JOIN "AssetMovement" movement
      ON movement."portfolioEventId" = event."id"
     AND movement."userId" = event."userId"
    WHERE event."userId" = current_setting('cryptfolio.cutover_user_id')
      AND event."kind" = 'OPENING_BALANCE'
  )
  SELECT encode(sha256(convert_to(coalesce(string_agg(value, E'\n' ORDER BY value COLLATE "C"), ''), 'UTF8')), 'hex')
  INTO actual_fingerprint
  FROM opening_records;

  IF expected_fingerprint <> '' AND actual_fingerprint <> expected_fingerprint THEN
    RAISE EXCEPTION 'Opening fingerprint changed after retry: %', actual_fingerprint;
  END IF;

  PERFORM set_config('cryptfolio.opening_fingerprint', actual_fingerprint, true);
END
$$;

SELECT current_setting('cryptfolio.opening_fingerprint') AS opening_fingerprint;

ROLLBACK;
