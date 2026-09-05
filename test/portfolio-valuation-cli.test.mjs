import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REPAIR_REASON_LENGTH,
  normalizeReportingDate,
  parseSnapshotArguments,
  snapshotHelp,
} from "../scripts/portfolio-valuation/snapshots-lib.mjs";

const ownerId = "auth0|owner";
const reportingDate = "2026-08-27";

test("snapshot arguments default to a reporting-date dry run", () => {
  assert.deepEqual(
    parseSnapshotArguments([
      "--",
      "--user-id",
      ownerId,
      "--reporting-date",
      reportingDate,
    ]),
    {
      apply: false,
      help: false,
      userId: ownerId,
      reportingDate,
      adoptionBaseline: false,
      repair: false,
      reason: null,
    },
  );
});

test("snapshot arguments accept explicit apply for either target", () => {
  assert.equal(
    parseSnapshotArguments([
      "--user-id",
      ownerId,
      "--reporting-date",
      reportingDate,
      "--apply",
    ]).apply,
    true,
  );

  assert.deepEqual(
    parseSnapshotArguments(["--user-id", ownerId, "--adoption-baseline"]),
    {
      apply: false,
      help: false,
      userId: ownerId,
      reportingDate: null,
      adoptionBaseline: true,
      repair: false,
      reason: null,
    },
  );
});

test("snapshot arguments require a user and exactly one target", () => {
  assert.throws(
    () => parseSnapshotArguments(["--reporting-date", reportingDate]),
    /--user-id is required/,
  );
  assert.throws(
    () => parseSnapshotArguments(["--user-id", ownerId]),
    /exactly one of --reporting-date or --adoption-baseline/,
  );
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--reporting-date",
        reportingDate,
        "--adoption-baseline",
      ]),
    /exactly one of --reporting-date or --adoption-baseline/,
  );
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ` ${ownerId}`,
        "--reporting-date",
        reportingDate,
      ]),
    /leading or trailing whitespace/,
  );
});

test("reporting dates use strict YYYY-MM-DD calendar dates", () => {
  assert.equal(normalizeReportingDate("2028-02-29"), "2028-02-29");
  assert.throws(() => normalizeReportingDate("2026-2-01"), /YYYY-MM-DD/);
  assert.throws(() => normalizeReportingDate("2026-02-29"), /valid calendar/);
  assert.throws(() => normalizeReportingDate("not-a-date"), /YYYY-MM-DD/);
});

test("repair requires apply and a bounded nonempty reason", () => {
  const reason = "Rebuild after the scheduled provider outage";
  assert.deepEqual(
    parseSnapshotArguments([
      "--user-id",
      ownerId,
      "--reporting-date",
      reportingDate,
      "--repair",
      "--reason",
      reason,
      "--apply",
    ]),
    {
      apply: true,
      help: false,
      userId: ownerId,
      reportingDate,
      adoptionBaseline: false,
      repair: true,
      reason,
    },
  );

  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--reporting-date",
        reportingDate,
        "--repair",
        "--reason",
        reason,
      ]),
    /--repair requires --apply/,
  );
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--reporting-date",
        reportingDate,
        "--repair",
        "--apply",
      ]),
    /nonempty --reason/,
  );
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--reporting-date",
        reportingDate,
        "--repair",
        "--reason",
        "   ",
        "--apply",
      ]),
    /nonempty --reason/,
  );
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--reporting-date",
        reportingDate,
        "--repair",
        "--reason",
        ` ${reason}`,
        "--apply",
      ]),
    /leading or trailing whitespace/,
  );
  assert.doesNotThrow(() =>
    parseSnapshotArguments([
      "--user-id",
      ownerId,
      "--adoption-baseline",
      "--repair",
      "--reason",
      "x".repeat(MAX_REPAIR_REASON_LENGTH),
      "--apply",
    ]),
  );
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--adoption-baseline",
        "--repair",
        "--reason",
        "x".repeat(MAX_REPAIR_REASON_LENGTH + 1),
        "--apply",
      ]),
    /cannot exceed 500 characters/,
  );
});

test("reason is rejected without repair", () => {
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--reporting-date",
        reportingDate,
        "--reason",
        "No repair requested",
        "--apply",
      ]),
    /only accepted together with --repair/,
  );
});

test("snapshot arguments reject malformed CLI input", () => {
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--reporting-date",
        reportingDate,
        "extra",
      ]),
    /Unexpected positional argument/,
  );
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--reporting-date",
        reportingDate,
        "--wat",
      ]),
    /Unknown option/,
  );
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--user-id",
        ownerId,
        "--reporting-date",
        reportingDate,
      ]),
    /Option supplied more than once/,
  );
  assert.throws(
    () =>
      parseSnapshotArguments([
        "--user-id",
        ownerId,
        "--reporting-date",
        reportingDate,
        "--",
      ]),
    /separator must be the first argument/,
  );
  assert.throws(
    () => parseSnapshotArguments(["--user-id", "--adoption-baseline"]),
    /--user-id requires a value/,
  );
});

test("help is available without operational arguments and describes safeguards", () => {
  assert.deepEqual(parseSnapshotArguments(["--help"]), {
    apply: false,
    help: true,
    userId: null,
    reportingDate: null,
    adoptionBaseline: false,
    repair: false,
    reason: null,
  });

  const help = snapshotHelp();
  assert.match(help, /read-only unless --apply/);
  assert.match(help, /--reporting-date <YYYY-MM-DD>/);
  assert.match(help, /--adoption-baseline/);
  assert.match(help, /--repair --reason <text> --apply/);
  assert.match(help, /at most\s+500\s+characters/);
});
