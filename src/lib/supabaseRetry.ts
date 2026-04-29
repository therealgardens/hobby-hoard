const RETRIABLE_CODES = new Set(["PGRST001", "PGRST002"]);

type SupabaseResult = { error: any };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetriableDbError(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    RETRIABLE_CODES.has(error?.code) ||
    message.includes("schema cache") ||
    message.includes("retrying the connection") ||
    message.includes("no connection to the server")
  );
}

export async function withDbRetry<T extends SupabaseResult>(operation: () => PromiseLike<T>, attempts = 4) {
  let last: T | null = null;

  for (let i = 0; i < attempts; i += 1) {
    last = await operation();
    if (!last.error || !isRetriableDbError(last.error) || i === attempts - 1) return last;
    await wait(700 * 2 ** i);
  }

  return last as T;
}