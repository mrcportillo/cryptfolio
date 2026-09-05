const REPORTING_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_REPAIR_REASON_LENGTH = 500;

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requiredOptionValue(argv, index, option) {
  const value = argv[index + 1];
  invariant(value && !value.startsWith("--"), `${option} requires a value.`);
  return value;
}

export function normalizeReportingDate(value) {
  invariant(
    REPORTING_DATE_PATTERN.test(value),
    "--reporting-date must use YYYY-MM-DD format.",
  );

  const parsed = new Date(`${value}T00:00:00.000Z`);
  invariant(
    !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value,
    "--reporting-date must be a valid calendar date.",
  );

  return value;
}

export function parseSnapshotArguments(argv) {
  const result = {
    apply: false,
    help: false,
    userId: null,
    reportingDate: null,
    adoptionBaseline: false,
    repair: false,
    reason: null,
  };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];

    if (option === "--") {
      invariant(
        index === 0,
        "The option separator must be the first argument.",
      );
      continue;
    }

    invariant(
      option.startsWith("--"),
      `Unexpected positional argument: ${option}`,
    );
    invariant(!seen.has(option), `Option supplied more than once: ${option}`);
    seen.add(option);

    if (option === "--apply") {
      result.apply = true;
      continue;
    }

    if (option === "--help") {
      result.help = true;
      continue;
    }

    if (option === "--adoption-baseline") {
      result.adoptionBaseline = true;
      continue;
    }

    if (option === "--repair") {
      result.repair = true;
      continue;
    }

    if (option === "--user-id") {
      result.userId = requiredOptionValue(argv, index, option);
      index += 1;
      continue;
    }

    if (option === "--reporting-date") {
      result.reportingDate = normalizeReportingDate(
        requiredOptionValue(argv, index, option),
      );
      index += 1;
      continue;
    }

    if (option === "--reason") {
      result.reason = requiredOptionValue(argv, index, option);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${option}`);
  }

  if (result.help) {
    return result;
  }

  invariant(result.userId?.trim(), "--user-id is required.");
  invariant(
    result.userId === result.userId.trim(),
    "--user-id cannot have leading or trailing whitespace.",
  );

  invariant(
    Boolean(result.reportingDate) !== result.adoptionBaseline,
    "Specify exactly one of --reporting-date or --adoption-baseline.",
  );

  if (result.repair) {
    invariant(result.apply, "--repair requires --apply.");
    invariant(result.reason?.trim(), "--repair requires a nonempty --reason.");
    invariant(
      result.reason === result.reason.trim(),
      "--reason cannot have leading or trailing whitespace.",
    );
    invariant(
      Array.from(result.reason).length <= MAX_REPAIR_REASON_LENGTH,
      `--reason cannot exceed ${MAX_REPAIR_REASON_LENGTH} characters.`,
    );
  } else {
    invariant(
      !result.reason,
      "--reason is only accepted together with --repair.",
    );
  }

  return result;
}

export function snapshotHelp() {
  return `Usage:
  pnpm valuation:snapshot -- --user-id <auth0-sub> \\
    (--reporting-date <YYYY-MM-DD> | --adoption-baseline) [--apply]
  pnpm valuation:snapshot -- --user-id <auth0-sub> \\
    (--reporting-date <YYYY-MM-DD> | --adoption-baseline) \\
    --repair --reason <text> --apply

The command is read-only unless --apply is present. Choose exactly one target:
a closed Salta reporting date, or the user's adoption baseline. Repair appends a
new revision and requires --apply plus a nonempty reason of at most ${MAX_REPAIR_REASON_LENGTH}
characters.`;
}
