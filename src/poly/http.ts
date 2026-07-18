/**
 * Bounded fetch for all Polymarket API calls.
 *
 * Neither gamma-client nor clob-client had a timeout: one half-open socket
 * left `scanning`/`running` reentrancy guards held forever and silently
 * stopped scanning and trading until a manual restart (the 2026-04-20 class
 * of stall). Every outbound call goes through here so a hang becomes a
 * thrown AbortError the callers' existing catch/finally paths already handle.
 */
export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(
    () => ctl.abort(new Error(`http timeout after ${timeoutMs}ms: ${url}`)),
    timeoutMs,
  );
  timer.unref?.();
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}
