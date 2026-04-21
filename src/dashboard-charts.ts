export interface DailyPnlPoint {
  day: string;
  pnl: number;
  n: number;
}

export interface SparklineBar {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  label: string;
}

export interface PnlBarsOptions {
  width: number;
  height: number;
  padding?: number;
}

export interface PnlBarsResult {
  bars: SparklineBar[];
  zeroY: number;
  cumTotal: number;
  maxAbs: number;
}

const COLOR_POSITIVE = '#6ee7b7';
const COLOR_NEGATIVE = '#f87171';
const COLOR_ZERO = '#9ca3af';
const BAR_FILL_RATIO = 0.7;

function formatLabel(day: string, pnl: number, n: number): string {
  const sign = pnl > 0 ? '+' : pnl < 0 ? '-' : '';
  const amt = Math.abs(pnl).toFixed(2).replace(/\.00$/, '');
  const trades = `${n} trade${n === 1 ? '' : 's'}`;
  return `${day}: ${sign}$${amt} (${trades})`;
}

export function buildPnlBars(
  data: readonly DailyPnlPoint[],
  opts: PnlBarsOptions,
): PnlBarsResult {
  const padding = opts.padding ?? 8;
  const halfHeight = opts.height / 2;
  const zeroY = halfHeight;

  if (data.length === 0) {
    return { bars: [], zeroY, cumTotal: 0, maxAbs: 0 };
  }

  const maxAbs = data.reduce((m, d) => Math.max(m, Math.abs(d.pnl)), 0);
  const cumTotal = data.reduce((s, d) => s + d.pnl, 0);
  const plotWidth = Math.max(0, opts.width - padding * 2);
  const slot = plotWidth / data.length;
  const barWidth = slot * BAR_FILL_RATIO;
  const barXOffset = (slot - barWidth) / 2;

  const bars: SparklineBar[] = data.map((d, i) => {
    const scale = maxAbs > 0 ? Math.abs(d.pnl) / maxAbs : 0;
    const barHeight = scale * halfHeight;
    const x = padding + i * slot + barXOffset;
    const y = d.pnl >= 0 ? zeroY - barHeight : zeroY;
    const color = d.pnl > 0 ? COLOR_POSITIVE : d.pnl < 0 ? COLOR_NEGATIVE : COLOR_ZERO;
    return {
      x,
      y,
      width: barWidth,
      height: barHeight,
      color,
      label: formatLabel(d.day, d.pnl, d.n),
    };
  });

  return { bars, zeroY, cumTotal, maxAbs };
}
