\set ON_ERROR_STOP on

-- Dry run by default. The only supported changes are the three missing legacy
-- indexes and the two RESTRICT -> CASCADE foreign keys required by the baseline.
-- Do not mark the Prisma baseline applied until strict preflight passes.
\if :{?apply}
\else
  \set apply false
\endif

\if :apply
  BEGIN;
  SET LOCAL lock_timeout = '5s';
  SET LOCAL statement_timeout = '30s';
  LOCK TABLE "User", "UserAsset", "AssetArchive" IN SHARE ROW EXCLUSIVE MODE;
\else
  BEGIN TRANSACTION READ ONLY;
\endif

SELECT set_config('cryptfolio.legacy_preparation', 'on', true);
\ir legacy-schema-check.sql

SELECT action
FROM (
  SELECT 'Create ' || index_name AS action
  FROM (VALUES
    ('UserAsset_userId_date_idx'),
    ('UserAsset_assetId_idx'),
    ('AssetArchive_userAssetId_date_idx')
  ) planned(index_name)
  WHERE to_regclass(format('%I.%I', current_schema(), index_name)) IS NULL
  UNION ALL
  SELECT 'Change ' || constraint_record.conname || ' deletion to CASCADE'
  FROM pg_constraint constraint_record
  JOIN pg_class table_record ON table_record.oid = constraint_record.conrelid
  JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
  WHERE namespace_record.nspname = current_schema()
    AND constraint_record.conname IN ('UserAsset_userId_fkey', 'AssetArchive_userAssetId_fkey')
    AND constraint_record.confdeltype = 'r'
) changes
ORDER BY action;

\if :apply
DO $$
DECLARE
  before_rows text[];
  after_rows text[];
BEGIN
  SELECT ARRAY[
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(row_record) ORDER BY "id")::text, '[]')) FROM "User" row_record),
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(row_record) ORDER BY "id")::text, '[]')) FROM "UserAsset" row_record),
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(row_record) ORDER BY "id")::text, '[]')) FROM "AssetArchive" row_record)
  ] INTO before_rows;

  CREATE INDEX IF NOT EXISTS "UserAsset_userId_date_idx" ON "UserAsset"("userId", "date");
  CREATE INDEX IF NOT EXISTS "UserAsset_assetId_idx" ON "UserAsset"("assetId");
  CREATE INDEX IF NOT EXISTS "AssetArchive_userAssetId_date_idx" ON "AssetArchive"("userAssetId", "date");

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"UserAsset"'::regclass
      AND conname = 'UserAsset_userId_fkey' AND confdeltype = 'r'
  ) THEN
    ALTER TABLE "UserAsset" DROP CONSTRAINT "UserAsset_userId_fkey";
    ALTER TABLE "UserAsset" ADD CONSTRAINT "UserAsset_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"AssetArchive"'::regclass
      AND conname = 'AssetArchive_userAssetId_fkey' AND confdeltype = 'r'
  ) THEN
    ALTER TABLE "AssetArchive" DROP CONSTRAINT "AssetArchive_userAssetId_fkey";
    ALTER TABLE "AssetArchive" ADD CONSTRAINT "AssetArchive_userAssetId_fkey"
      FOREIGN KEY ("userAssetId") REFERENCES "UserAsset"("id") ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;

  SELECT ARRAY[
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(row_record) ORDER BY "id")::text, '[]')) FROM "User" row_record),
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(row_record) ORDER BY "id")::text, '[]')) FROM "UserAsset" row_record),
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(row_record) ORDER BY "id")::text, '[]')) FROM "AssetArchive" row_record)
  ] INTO after_rows;
  IF before_rows IS DISTINCT FROM after_rows THEN
    RAISE EXCEPTION 'Legacy preparation changed rows; rolling back';
  END IF;
END
$$;

SELECT set_config('cryptfolio.legacy_preparation', 'off', true);
\ir legacy-schema-check.sql
COMMIT;
\echo 'Legacy schema prepared. Run strict portfolio preflight before resolving the baseline.'
\else
ROLLBACK;
\echo 'Dry run only. No schema or portfolio rows changed.'
\endif
