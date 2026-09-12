-- Check logical columns, indexes, and foreign keys before baseline adoption.
-- Physical column order and dropped-column slots do not change the contract.
DO $$
DECLARE
  allow_preparation boolean := coalesce(current_setting('cryptfolio.legacy_preparation', true), 'off') = 'on';
  column_mismatches integer;
  index_mismatches integer;
  constraint_mismatches integer;
  ownership_mismatches integer;
BEGIN
  IF NOT has_schema_privilege(current_user, current_schema(), 'USAGE')
     OR NOT has_schema_privilege(current_user, current_schema(), 'CREATE') THEN
    RAISE EXCEPTION 'Current role % requires USAGE and CREATE on schema %', current_user, current_schema();
  END IF;

  SELECT count(*) INTO ownership_mismatches
  FROM pg_class table_record
  JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
  WHERE namespace_record.nspname = current_schema()
    AND table_record.relname IN ('User', 'UserAsset', 'AssetArchive')
    AND (
      table_record.relkind <> 'r'
      OR NOT pg_has_role(current_user, table_record.relowner, 'USAGE')
    );

  IF ownership_mismatches <> 0 OR (
    SELECT count(*)
    FROM pg_class table_record
    JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
    WHERE namespace_record.nspname = current_schema()
      AND table_record.relname IN ('User', 'UserAsset', 'AssetArchive')
      AND table_record.relkind = 'r'
  ) <> 3 THEN
    RAISE EXCEPTION 'Current role % must own, or be a member of the owner of, all legacy tables', current_user;
  END IF;

  WITH expected(
    table_name,
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
      ('User', 'id', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('User', 'name', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('User', 'email', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 'id', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 'userId', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 'assetId', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 'assetName', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 'amount', 'float8', 'NO', NULL::text, 53, NULL::integer, NULL::integer, NULL::integer),
      ('UserAsset', 'date', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', NULL::integer, NULL::integer, NULL::integer, 3),
      ('AssetArchive', 'id', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('AssetArchive', 'userAssetId', 'text', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer),
      ('AssetArchive', 'amount', 'float8', 'NO', NULL::text, 53, NULL::integer, NULL::integer, NULL::integer),
      ('AssetArchive', 'date', 'timestamp', 'NO', NULL::text, NULL::integer, NULL::integer, NULL::integer, 3)
  ), actual AS (
    SELECT
      column_record.table_name,
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
      AND column_record.table_name IN ('User', 'UserAsset', 'AssetArchive')
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
      ('AssetArchive_pkey', 'AssetArchive', true, true, false, ARRAY['id']::text[], 'btree', true, true, true, true),
      ('AssetArchive_userAssetId_date_idx', 'AssetArchive', false, false, false, ARRAY['userAssetId', 'date']::text[], 'btree', true, true, true, true)
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
      AND table_class.relname IN ('User', 'UserAsset', 'AssetArchive')
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
  ), missing AS (
    SELECT * FROM expected EXCEPT SELECT * FROM actual
  ), differences AS (
    SELECT * FROM missing
    WHERE NOT (
      allow_preparation
      AND index_name IN (
        'UserAsset_userId_date_idx', 'UserAsset_assetId_idx',
        'AssetArchive_userAssetId_date_idx'
      )
      -- A same-name object elsewhere is a collision, not a missing index.
      AND to_regclass(format('%I.%I', current_schema(), index_name)) IS NULL
    )
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO index_mismatches FROM differences;

  WITH expected(table_name, constraint_name, definition) AS (
    VALUES
      ('User', 'User_pkey', 'PRIMARY KEY (id)'),
      ('UserAsset', 'UserAsset_pkey', 'PRIMARY KEY (id)'),
      ('UserAsset', 'UserAsset_userId_fkey', 'FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE'),
      ('AssetArchive', 'AssetArchive_pkey', 'PRIMARY KEY (id)'),
      ('AssetArchive', 'AssetArchive_userAssetId_fkey', 'FOREIGN KEY ("userAssetId") REFERENCES "UserAsset"(id) ON UPDATE CASCADE ON DELETE CASCADE')
  ), actual AS (
    SELECT
      table_record.relname AS table_name,
      constraint_record.conname AS constraint_name,
      regexp_replace(
        CASE WHEN allow_preparation AND constraint_record.conname IN (
          'UserAsset_userId_fkey', 'AssetArchive_userAssetId_fkey'
        ) THEN regexp_replace(
          pg_get_constraintdef(constraint_record.oid, true),
          'ON DELETE RESTRICT$', 'ON DELETE CASCADE'
        ) ELSE pg_get_constraintdef(constraint_record.oid, true) END,
        '\s+', ' ', 'g'
      ) AS definition
    FROM pg_constraint constraint_record
    JOIN pg_class table_record ON table_record.oid = constraint_record.conrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
    WHERE namespace_record.nspname = current_schema()
      AND table_record.relname IN ('User', 'UserAsset', 'AssetArchive')
  ), differences AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO constraint_mismatches FROM differences;

  IF column_mismatches <> 0 OR index_mismatches <> 0 OR constraint_mismatches <> 0 THEN
    RAISE EXCEPTION
      'Legacy baseline mismatch: % column, % index, % constraint definition differences',
      column_mismatches,
      index_mismatches,
      constraint_mismatches;
  END IF;
END
$$;

