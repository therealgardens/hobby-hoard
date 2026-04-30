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

export async function withDbRetry<T extends SupabaseResult>(
  operation: () => PromiseLike<T>,
  attempts = 6,
) {
  let last: T | null = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await operation();
    if (!last.error || !isRetriableDbError(last.error, last.status) || i === attempts - 1) return last;
    await wait(Math.min(400 * 2 ** i, 5000));
  }
  return last as T;
}

// ─── Retry per edge functions (supabase.functions.invoke) ─────────────────────

function isRetriableFunctionError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return (
    message.includes("database is reconnecting") ||
    message.includes("recovery mode") ||
    message.includes("starting up") ||
    message.includes("unexpected eof") ||
    message.includes("tls close_notify") ||
    message.includes("peer closed connection") ||
    message.includes("terminating connection")
  );
}

export async function withFunctionRetry<T>(
  operation: () => Promise<{ data: T | null; error: unknown }>,
  attempts = 4,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    const { data, error } = await operation();
    const appError = error ?? ((data as any)?.error ? new Error((data as any).error) : null);
    if (!appError) return data as T;
    lastError = appError;
    if (!isRetriableFunctionError(lastError) || i === attempts - 1) break;
    await wait(500 * 2 ** i);
  }
  throw lastError;
}
