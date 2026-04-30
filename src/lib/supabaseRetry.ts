const RETRIABLE_CODES = new Set(["PGRST000", "PGRST001", "PGRST002"]);

type SupabaseResult = { error: any; status?: number };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetriableDbError(error: any, status?: number) {
  if (status === 503 || status === 504 || status === 408) return true;
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  return (
    RETRIABLE_CODES.has(error?.code) ||
    message.includes("schema cache") ||
    message.includes("retrying the connection") ||
    message.includes("no connection to the server") ||
    message.includes("database connection error") ||
    message.includes("recovery mode") ||
    details.includes("recovery mode")
  );
}

export async function withDbRetry<T extends SupabaseResult>(operation: () => PromiseLike<T>, attempts = 6) {
  let last: T | null = null;

  for (let i = 0; i < attempts; i += 1) {
    last = await operation();
    if (!last.error || !isRetriableDbError(last.error) || i === attempts - 1) return last;
    // Backoff: 400, 800, 1600, 3200, 5000, 5000 ms
    const delay = Math.min(400 * 2 ** i, 5000);
    await wait(delay);
  }

  return last as T;
}