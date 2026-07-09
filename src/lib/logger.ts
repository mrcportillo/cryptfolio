type LogContext = Record<string, string | number | boolean | undefined>;

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  return { name: "UnknownError", message: "Unknown error" };
}

export function logServerError(
  operation: string,
  error: unknown,
  context: LogContext = {},
) {
  console.error(
    JSON.stringify({
      level: "error",
      operation,
      ...context,
      error: serializeError(error),
    }),
  );
}
