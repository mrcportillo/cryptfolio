\set ON_ERROR_STOP on

\if :{?user_id}
\else
  \echo 'Usage: psql "$POSTGRES_URL_NON_POOLING" -v user_id="auth0|..." -f scripts/portfolio-ledger/preflight.sql'
  \quit 1
\endif

BEGIN TRANSACTION READ ONLY;

SELECT set_config('cryptfolio.cutover_user_id', :'user_id', true);

SELECT set_config('cryptfolio.legacy_preparation', 'off', true);
\ir legacy-schema-check.sql

DO $$
DECLARE
  cutover_user_id text := current_setting('cryptfolio.cutover_user_id');
  position record;
  source_quantity numeric;
  ledger_quantity numeric(65,30);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = cutover_user_id) THEN
    RAISE EXCEPTION 'Cutover user does not exist';
  END IF;

  FOR position IN
    SELECT "id", "amount"::text AS amount_text
    FROM "UserAsset"
    WHERE "userId" = cutover_user_id
    ORDER BY "id"
  LOOP
    IF position.amount_text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Position % has non-finite quantity %', position.id, position.amount_text;
    END IF;

    IF octet_length('opening:v1:' || position.id) > 160 THEN
      RAISE EXCEPTION 'Position % cannot fit the opening idempotency key', position.id;
    END IF;

    BEGIN
      source_quantity := position.amount_text::numeric;
      ledger_quantity := position.amount_text::numeric(65,30);
    EXCEPTION
      WHEN numeric_value_out_of_range OR invalid_text_representation THEN
        RAISE EXCEPTION 'Position % quantity % cannot be represented as numeric(65,30)', position.id, position.amount_text;
    END;

    IF source_quantity < 0 THEN
      RAISE EXCEPTION 'Position % has negative quantity %', position.id, position.amount_text;
    END IF;

    IF source_quantity <> ledger_quantity THEN
      RAISE EXCEPTION 'Position % quantity % would be rounded in numeric(65,30)', position.id, position.amount_text;
    END IF;
  END LOOP;
END
$$;

WITH legacy AS (
  SELECT
    "id",
    "userId",
    "assetId",
    "assetName",
    "amount"::text AS amount_text,
    to_char("date", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS date_text
  FROM "UserAsset"
  WHERE "userId" = current_setting('cryptfolio.cutover_user_id')
), records AS (
  SELECT string_agg(
    concat(
      octet_length("id"), ':', "id", '|',
      octet_length("userId"), ':', "userId", '|',
      octet_length("assetId"), ':', "assetId", '|',
      octet_length("assetName"), ':', "assetName", '|',
      octet_length(amount_text), ':', amount_text, '|',
      octet_length(date_text), ':', date_text
    ),
    E'\n' ORDER BY "id" COLLATE "C"
  ) AS value
  FROM legacy
), payload AS (
  SELECT concat(
    'portfolio-opening-v1', E'\n',
    octet_length(current_setting('cryptfolio.cutover_user_id')), ':',
    current_setting('cryptfolio.cutover_user_id'), E'\n',
    coalesce(value, '')
  ) AS value
  FROM records
)
SELECT
  encode(sha256(convert_to(value, 'UTF8')), 'hex') AS legacy_fingerprint,
  (SELECT count(*) FROM legacy) AS legacy_position_count,
  (SELECT count(*) FROM legacy WHERE amount_text::numeric > 0) AS opening_count,
  (SELECT count(*) FROM legacy WHERE amount_text::numeric = 0) AS skipped_zero_count
FROM payload;

WITH archives AS (
  SELECT
    archive."id",
    archive."userAssetId",
    archive."amount"::text AS amount_text,
    to_char(archive."date", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS date_text
  FROM "AssetArchive" archive
  JOIN "UserAsset" position ON position."id" = archive."userAssetId"
  WHERE position."userId" = current_setting('cryptfolio.cutover_user_id')
), payload AS (
  SELECT coalesce(string_agg(
    concat(
      octet_length("id"), ':', "id", '|',
      octet_length("userAssetId"), ':', "userAssetId", '|',
      octet_length(amount_text), ':', amount_text, '|',
      octet_length(date_text), ':', date_text
    ),
    E'\n' ORDER BY "id" COLLATE "C"
  ), '') AS value
  FROM archives
)
SELECT
  encode(sha256(convert_to(value, 'UTF8')), 'hex') AS archive_fingerprint,
  (SELECT count(*) FROM archives) AS archive_count
FROM payload;

ROLLBACK;
