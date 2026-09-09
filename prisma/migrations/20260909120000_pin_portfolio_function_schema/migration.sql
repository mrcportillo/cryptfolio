-- Earlier functions captured the migration connection's search_path. A direct
-- connection without an explicit schema can use "$user", public. Pin every
-- portfolio routine to its actual schema without changing its body or data.
DO $$
DECLARE
  schema_name text := current_schema();
  function_signature text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'assert_opening_event_movement(text)',
    'enforce_opening_event_movement()',
    'assert_ledger_adoption_boundary(text,timestamp without time zone)',
    'guard_ledger_adoption_boundary()',
    'assert_manual_event_semantics(text)',
    'enforce_manual_event_semantics()',
    'serialize_ledger_owner_write()',
    'assert_nonnegative_asset_timeline(text,text)',
    'enforce_nonnegative_asset_timeline()',
    'protect_adopted_legacy_position()',
    'protect_adopted_asset_archive()',
    'protect_immutable_ledger_record()',
    'snapshot_daily_cutoff_utc(date)',
    'protect_snapshot_header()',
    'protect_snapshot_revision()',
    'enforce_inserted_snapshot_revision_activation()',
    'protect_snapshot_evidence()',
    'assert_active_snapshot_revision(text,text)',
    'enforce_active_snapshot_revision()',
    'invalidate_snapshots_for_movement()',
    'invalidate_later_snapshot_periods()'
  ] LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%s SET search_path = %I',
      schema_name, function_signature, schema_name
    );
  END LOOP;
END
$$;
