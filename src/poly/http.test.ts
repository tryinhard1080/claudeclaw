import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from './http.js';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves normally when fetch completes before the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const res = await fetchWithTimeout('https://x.test/', 1000);
    expect(res.status).toBe(200);
  });

  it('aborts a hung fetch after the timeout instead of waiting forever', async () => {
    vi.useFakeTimers();
    // Simulate a half-open socket: the promise only settles via the abort signal.
    const fetchMock = vi.fn((_url: string | URL, opts?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () =>
          reject((opts.signal as AbortSignal).reason));
      }));
    vi.stubGlobal('fetch', fetchMock);

    const p = fetchWithTimeout('https://hung.test/', 15_000);
    const assertion = expect(p).rejects.toThrow(/http timeout after 15000ms/);
    await vi.advanceTimersByTimeAsync(15_100);
    await assertion;
  });

  it('passes the abort signal through to fetch', async () => {
    let seenSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, opts?: RequestInit) => {
      seenSignal = opts?.signal ?? undefined;
      return new Response('ok', { status: 200 });
    }));
    await fetchWithTimeout('https://x.test/', 1000);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });
});
