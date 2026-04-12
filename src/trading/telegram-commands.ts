import type { Bot, Context } from 'grammy';

import { logger } from '../logger.js';
import type { StatePoller } from './state-poller.js';
import type { InstanceController } from './instance-control.js';
import type { TradingAlertManager } from './alerts.js';
import type { InstanceState, RegimeLabel } from './types.js';

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

function formatInstanceStatus(name: string, state: InstanceState, halted: boolean): string {
  const emoji = REGIME_EMOJI[state.regime.regime] || '⚪';
  const lines = [
    `${emoji} ${name} (${state.mode})${halted ? ' [HALTED]' : ''}`,
    `  Regime: ${state.regime.regime} (conf: ${state.regime.confidence.toFixed(2)})`,
    `  Equity: ${formatEquity(state.equity)}`,
    `  Cash: ${formatEquity(state.cash)}`,
    `  Drawdown: daily ${formatPct(state.risk.daily_dd_pct)}, peak ${formatPct(state.risk.peak_dd_pct)}`,
    `  Positions: ${state.positions.length}`,
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
    const text = ctx.message?.text || '';
    const parts = text.replace(/^\/trade\s*/, '').trim().split(/\s+/);
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
            const emoji = REGIME_EMOJI[state.regime.regime] || '⚪';
            lines.push(`${emoji} ${name}: ${state.regime.regime}`);
            lines.push(`  Confidence: ${state.regime.confidence.toFixed(4)}`);
            lines.push(`  Vol Rank: ${state.regime.vol_rank.toFixed(2)}`);
            lines.push(`  Target Alloc: ${formatPct(state.regime.target_allocation)}`);
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
            const unrealizedPnl = state.positions.reduce((sum, p) => sum + p.unrealized_pnl, 0);
            lines.push(`${name}:`);
            lines.push(`  Equity: ${formatEquity(state.equity)}`);
            lines.push(`  Unrealized P&L: ${formatEquity(unrealizedPnl)}`);
            lines.push(`  Daily DD: ${formatPct(state.risk.daily_dd_pct)}`);
            lines.push(`  Peak DD: ${formatPct(state.risk.peak_dd_pct)}`);
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

        default:
          await ctx.reply(
            'Trading commands:\n' +
            '/trade status -- Instance overview\n' +
            '/trade regime -- Regime details\n' +
            '/trade pnl -- P&L summary\n' +
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
