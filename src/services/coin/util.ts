type CoinRequestInit = RequestInit & {
  next?: { revalidate?: number };
};

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 2;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createTimeoutSignal(signal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
}

export async function request<T>(
  url: string,
  options: CoinRequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  headers.set("accept-language", "en-US,en;q=0.9");

  if (process.env.COIN_API_KEY) {
    headers.set("x-cg-demo-api-key", process.env.COIN_API_KEY);
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const timeout = createTimeoutSignal(options.signal);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: timeout.signal,
        next: options.next ?? { revalidate: 30 },
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry || attempt === MAX_RETRIES) {
        throw new Error(
          `Coin market data request failed with status ${response.status}`,
        );
      }
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw new Error("Coin market data is temporarily unavailable.");
      }
    } finally {
      timeout.cleanup();
    }

    await wait(200 * 2 ** attempt);
  }

  throw new Error("Coin market data is temporarily unavailable.");
}

export function assertCoinId(id: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("Invalid coin id");
  }

  return id;
}
