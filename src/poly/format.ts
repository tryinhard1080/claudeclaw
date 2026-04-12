export const TELEGRAM_CAP = 3800; // leave headroom under 4096

export function truncateForTelegram(
  text: string,
  cap = TELEGRAM_CAP,
): { text: string; truncated: number } {
  if (text.length <= cap) return { text, truncated: 0 };
  const head = text.slice(0, cap);
  const truncated = text.length - cap;
  return { text: head + `\n… (truncated, ${truncated} chars)`, truncated };
}

export function fmtUsd(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function fmtPrice(n: number): string {
  return '$' + n.toFixed(2);
}

export function truncateQuestion(q: string, max = 80): string {
  return q.length <= max ? q : q.slice(0, max - 1) + '…';
}
