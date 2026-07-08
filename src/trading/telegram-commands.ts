import type { Bot, Context } from 'grammy';
import Database from 'better-sqlite3';
import path from 'node:path';

import { logger } from '../logger.js';
import { ALLOWED_CHAT_ID, STORE_DIR } from '../config.js';
import type { StatePoller } from './state-poller.js';
import type { InstanceController } from './instance-control.js';
import type { TradingAlertManager } from './alerts.js';
import type { InstanceState, RegimeLabel } from './types.js';
import { getRegimeLabel, getRegimeTargetAllocation, isFullRegimeState } from './state-schema.js';
import { summarizeSharpe, type SharpeSnapshot } from './sharpe.js';

const REGIME_EMOJI: Record<RegimeLabel, string> = {
  CRASH: '🔴',
  STRONG_BEAR: '🟠',
  WEAK_BEAR: '🟡',
  NEUTRAL: '⚪',
  WEAK_BULL: '🟢',
  STRONG_BULL: '💚',
  EUPHORIA: '🚀',
};

function formatEquity(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number): string {
  return (n * 100).toFixed(2) + '%';
}

export function formatInstanceStatus(name: string, state: InstanceState, halted: boolean): string {
  if (!isFullRegimeState(state)) {
    const lines = [
      `⚪ ${name} (${state.mode})${halted ? ' [HALTED]' : ''}`,
      `  Market: ${state.market_open ? 'OPEN' : 'CLOSED'}`,
      `  Equity: ${formatEquity(state.equity)}`,
      `  Cash: ${formatEquity(state.cash)}`,
    ];
    if (state.next_open) {
      lines.push(`  Next open: ${state.next_open}`);
    }
    return lines.join('\n');
  }

  const regime = getRegimeLabel(state) ?? 'UNKNOWN';
  const emoji = REGIME_EMOJI[regime as RegimeLabel] || '⚪';
  const lines = [
    `${emoji} ${name} (${state.mode})${halted ? ' [HALTED]' : ''}`,
    `  Regime: ${regime} (conf: ${state.regime.confidence.toFixed(2)})`,
    `  Equity: ${formatEquity(state.equity)}`,
    `  Cash: ${formatEquity(state.cash)}`,
    `  Drawdown: daily ${formatPct(state.risk.daily_dd_pct)}, peak ${formatPct(state.risk.peak_dd_pct)}`,
    `  Positions: ${state.positions?.length ?? 0}`,
  ];

  const activeBreakers = Object.entries(state.risk.circuit_breakers)
    .filter(([, active]) => active)
    .map(([key]) => key);
  if (activeBreakers.length > 0) {
    lines.push(`  CIRCUIT BREAKERS: ${activeBreakers.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Registers /trade commands on the bot.
 * All subcommands are parsed from the message text after "/trade ".
 */
export function registerTradingCommands(
  bot: Bot<Context>,
  poller: StatePoller,
  controller: InstanceController,
  alertManager: TradingAlertManager,
  instanceNames: readonly string[],
): void {
  bot.command('trade', async (ctx) => {
    if (!ALLOWED_CHAT_ID || ctx.chat?.id.toString() !== ALLOWED_CHAT_ID) return;
    const text = ctx.message?.text || '';
    const parts = text.replace(/^\/trade(?:@\w+)?\s*/, '').trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || 'status';
    const arg = parts[1] || '';

    try {
      switch (subcommand) {
        case 'status': {
          const lines: string[] = ['Trading Status\n'];
          for (const name of instanceNames) {
            const state = poller.getState(name);
            if (state) {
              const halted = await controller.isHalted(name);
              lines.push(formatInstanceStatus(name, state, halted));
              lines.push('');
            } else {
              lines.push(`${name}: no data (instance may be stopped)\n`);
            }
          }
          await ctx.reply(lines.join('\n'));
          break;
        }

        case 'regime': {
          const lines: string[] = ['Regime Detection\n'];
          for (const name of instanceNames) {
            const state = poller.getState(name);
            if (!state) {
              lines.push(`${name}: no data`);
              continue;
            }
            if (!isFullRegimeState(state)) {
              lines.push(`${name}: market ${state.market_open ? 'OPEN' : 'CLOSED'}`);
              if (state.next_open) lines.push(`  Next open: ${state.next_open}`);
              lines.push('');
              continue;
            }
            const regime = getRegimeLabel(state) ?? 'UNKNOWN';
            const emoji = REGIME_EMOJI[regime as RegimeLabel] || '⚪';
            lines.push(`${emoji} ${name}: ${regime}`);
            lines.push(`  Confidence: ${state.regime.confidence.toFixed(4)}`);
            lines.push(`  Vol Rank: ${state.regime.vol_rank.toFixed(2)}`);
            const targetAllocation = getRegimeTargetAllocation(state);
            lines.push(`  Target Alloc: ${targetAllocation === null ? 'n/a' : formatPct(targetAllocation)}`);
            lines.push(`  Market: ${state.market_open ? 'OPEN' : 'CLOSED'}`);
            lines.push('');
          }
          await ctx.reply(lines.join('\n'));
          break;
        }

        case 'halt': {
          if (arg) {
            await controller.haltInstance(arg);
            await ctx.reply(`Halted ${arg}. Use /trade resume ${arg} to restart.`);
          } else {
            await controller.haltAll();
            await ctx.reply('All instances halted.');
          }
          break;
        }

        case 'resume': {
          if (!arg) {
            await ctx.reply('Usage: /trade resume <instance>');
            break;
          }
          await controller.resumeInstance(arg);
          await ctx.reply(`Resumed ${arg}. It will pick up on next loop iteration.`);
          break;
        }

        case 'start': {
          if (!arg) {
            await ctx.reply('Usage: /trade start <instance> [paper|live]');
            break;
          }
          const mode = parts[2] || 'paper';
          await ctx.reply(`Starting ${arg} in ${mode} mode...`);
          const result = await controller.startInstance(arg, mode);
          await ctx.reply(result || `${arg} started.`);
          break;
        }

        case 'stop': {
          if (!arg) {
            await ctx.reply('Usage: /trade stop <instance>');
            break;
          }
          const result = await controller.stopInstance(arg);
          await ctx.reply(result || `${arg} stopped.`);
          break;
        }

        case 'backtest': {
          if (!arg) {
            await ctx.reply('Usage: /trade backtest <instance>');
            break;
          }
          await ctx.reply(`Running backtest for ${arg}... this may take a few minutes.`);
          const result = await controller.runBacktest(arg);
          // Truncate if too long for Telegram
          const output = result.length > 3500
            ? result.slice(0, 3500) + '\n\n... (truncated)'
            : result;
          await ctx.reply(output);
          break;
        }

        case 'pnl': {
          const lines: string[] = ['P&L Summary\n'];
          let totalEquity = 0;
          for (const name of instanceNames) {
            const state = poller.getState(name);
            if (!state) continue;
            totalEquity += state.equity;
            const unrealizedPnl = (state.positions ?? []).reduce((sum, p) => sum + (p.unrealized_pnl ?? p.unrealized_pl ?? 0), 0);
            lines.push(`${name}:`);
            lines.push(`  Equity: ${formatEquity(state.equity)}`);
            lines.push(`  Unrealized P&L: ${formatEquity(unrealizedPnl)}`);
            if (state.risk) {
              lines.push(`  Daily DD: ${formatPct(state.risk.daily_dd_pct)}`);
              lines.push(`  Peak DD: ${formatPct(state.risk.peak_dd_pct)}`);
            } else {
              lines.push(`  Market: ${state.market_open ? 'OPEN' : 'CLOSED'}`);
            }
            lines.push('');
          }
          lines.push(`Total Equity: ${formatEquity(totalEquity)}`);
          await ctx.reply(lines.join('\n'));
          break;
        }

        case 'alerts': {
          const toggle = arg.toLowerCase();
          if (toggle === 'on') {
            alertManager.toggle(true);
            await ctx.reply('Trading alerts enabled.');
          } else if (toggle === 'off') {
            alertManager.toggle(false);
            await ctx.reply('Trading alerts disabled.');
          } else {
            const status = alertManager.isEnabled() ? 'ON' : 'OFF';
            await ctx.reply(`Trading alerts are ${status}. Use /trade alerts on|off to toggle.`);
          }
          break;
        }

        case 'sharpe': {
          let db: Database.Database | null = null;
          try {
            db = new Database(path.join(STORE_DIR, 'claudeclaw.db'), { readonly: true });
            await ctx.reply(renderSharpe(db));
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            await ctx.reply(`sharpe command failed: ${m.slice(0, 200)}`);
          } finally {
            if (db) {
              try { db.close(); } catch { /* ignore */ }
            }
          }
          break;
        }

        default:
          await ctx.reply(
            'Trading commands:\n' +
            '/trade status -- Instance overview\n' +
            '/trade regime -- Regime details\n' +
            '/trade pnl -- P&L summary\n' +
            '/trade sharpe -- Rolling 60d Sharpe per instance\n' +
            '/trade halt [instance] -- Halt trading\n' +
            '/trade resume <instance> -- Resume\n' +
            '/trade start <instance> [paper] -- Start\n' +
            '/trade stop <instance> -- Stop\n' +
            '/trade backtest <instance> -- Run backtest\n' +
            '/trade alerts on|off -- Toggle alerts',
          );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, subcommand, arg }, 'Trading command failed');
      await ctx.reply(`Error: ${msg.slice(0, 200)}`);
    }
  });

  logger.info('Trading commands registered (/trade)');
}

interface SharpeDbRow {
  instance: string;
  snapshot_date: string;
  equity: number;
  cash: number | null;
  peak_equity: number | null;
  daily_return: number | null;
  rolling_sharpe_60d: number | null;
  n_days: number;
}

function formatSharpeNumber(s: number): string {
  const sign = s >= 0 ? '+' : '';
  return `${sign}${s.toFixed(2)}`;
}

function formatNDays(n: number): string {
  return n >= 60 ? `n_days=${n}` : `n_days=${n}/60`;
}

/**
 * Renders /trade sharpe output from the regime_sharpe_snapshots table.
 * Returns a stable string; never throws on empty/missing table — returns
 * a friendly empty-state message instead.
 */
export function renderSharpe(db: Database.Database): string {
  // Detect table absence (migration pending) — sqlite_master probe.
  const tableRow = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='regime_sharpe_snapshots'`)
    .get();
  if (!tableRow) {
    return 'Regime Trader Sharpe (rolling 60d):\n  no Sharpe snapshots yet (table not migrated)';
  }

  const rows = db
    .prepare(
      `SELECT instance, snapshot_date, equity, cash, peak_equity,
              daily_return, rolling_sharpe_60d, n_days
         FROM regime_sharpe_snapshots
        ORDER BY instance ASC, snapshot_date ASC`,
    )
    .all() as SharpeDbRow[];

  if (rows.length === 0) {
    return 'Regime Trader Sharpe (rolling 60d):\n  no Sharpe snapshots yet';
  }

  const snapshots: SharpeSnapshot[] = rows.map((r) => ({
    instance: r.instance,
    snapshotDate: r.snapshot_date,
    equity: r.equity,
    cash: r.cash,
    peakEquity: r.peak_equity,
    dailyReturn: r.daily_return,
    rollingSharpe60d: r.rolling_sharpe_60d,
    nDays: r.n_days,
  }));

  const summaries = summarizeSharpe(snapshots);
  const lines: string[] = ['Regime Trader Sharpe (rolling 60d):'];

  // Pad instance labels to align the columns visually.
  const labelWidth = Math.max(...summaries.map((s) => s.instance.length)) + 1;

  for (const s of summaries) {
    const label = (s.instance + ':').padEnd(labelWidth + 1, ' ');
    if (s.nDays < 2) {
      lines.push(`  ${label} not enough data yet (n_days=${s.nDays})`);
      continue;
    }
    const sharpeStr = s.latestSharpe60d === null
      ? 'sharpe=n/a'
      : `sharpe=${formatSharpeNumber(s.latestSharpe60d)}`;
    const ndStr = formatNDays(s.nDays);
    const trendStr = `trend=${s.trend}`;
    lines.push(`  ${label} ${sharpeStr}  ${ndStr}  ${trendStr}`);
  }

  return lines.join('\n');
}
