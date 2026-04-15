import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { readEnvFile } from './env.js';

const envConfig = readEnvFile([
  'TELEGRAM_BOT_TOKEN',
  'ALLOWED_CHAT_ID',
  'GROQ_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'WHATSAPP_ENABLED',
  'SLACK_USER_TOKEN',
  'CONTEXT_LIMIT',
  'DASHBOARD_PORT',
  'DASHBOARD_TOKEN',
  'DASHBOARD_URL',
  'CLAUDECLAW_CONFIG',
  'DB_ENCRYPTION_KEY',
  'GOOGLE_API_KEY',
  'AGENT_TIMEOUT_MS',
  'SECURITY_PIN_HASH',
  'IDLE_LOCK_MINUTES',
  'EMERGENCY_KILL_PHRASE',
  'STREAM_STRATEGY',
  'STORE_DIR',
  'REGIME_TRADER_PATH',
  'REGIME_TRADER_INSTANCES',
  'POLY_ENABLED',
  'POLY_PAPER_CAPITAL',
  'POLY_MAX_TRADE_USD',
  'POLY_MAX_OPEN_POSITIONS',
  'POLY_MAX_DEPLOYED_PCT',
  'POLY_MIN_EDGE_PCT',
  'POLY_MIN_TTR_HOURS',
  'POLY_MIN_VOLUME_USD',
  'POLY_DAILY_LOSS_PCT',
  'POLY_HALT_DD_PCT',
  'POLY_KELLY_FRACTION',
  'POLY_MODEL',
  'POLY_SCAN_INTERVAL_MIN',
  'POLY_DIGEST_HOUR',
  'POLY_TIMEZONE',
  'POLY_CALIBRATION_HOUR',
  'POLY_CALIBRATION_BRIER_ALERT',
  'POLY_CALIBRATION_LOOKBACK_DAYS',
  'POLY_REGIME_REFRESH_MIN',
  'POLY_MIN_MARKET_PRICE',
  'POLY_MAX_MARKET_PRICE',
  'POLY_RESEARCH_NOTEBOOK_ID',
  'ANTHROPIC_API_KEY',
]);

// ── Multi-agent support ──────────────────────────────────────────────
// These are mutable and overridden by index.ts when --agent is passed.
export let AGENT_ID = 'main';
export let activeBotToken =
  process.env.TELEGRAM_BOT_TOKEN || envConfig.TELEGRAM_BOT_TOKEN || '';
export let agentCwd: string | undefined; // undefined = use PROJECT_ROOT
export let agentDefaultModel: string | undefined; // from agent.yaml
export let agentObsidianConfig: { vault: string; folders: string[]; readOnly?: string[] } | undefined;
export let agentSystemPrompt: string | undefined; // loaded from agents/{id}/CLAUDE.md

export function setAgentOverrides(opts: {
  agentId: string;
  botToken: string;
  cwd: string;
  model?: string;
  obsidian?: { vault: string; folders: string[]; readOnly?: string[] };
  systemPrompt?: string;
}): void {
  AGENT_ID = opts.agentId;
  activeBotToken = opts.botToken;
  agentCwd = opts.cwd;
  agentDefaultModel = opts.model;
  agentObsidianConfig = opts.obsidian;
  agentSystemPrompt = opts.systemPrompt;
}

export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || envConfig.TELEGRAM_BOT_TOKEN || '';

// Only respond to this Telegram chat ID. Set this after getting your ID via /chatid.
export const ALLOWED_CHAT_ID =
  process.env.ALLOWED_CHAT_ID || envConfig.ALLOWED_CHAT_ID || '';

export const WHATSAPP_ENABLED =
  (process.env.WHATSAPP_ENABLED || envConfig.WHATSAPP_ENABLED || '').toLowerCase() === 'true';

export const SLACK_USER_TOKEN =
  process.env.SLACK_USER_TOKEN || envConfig.SLACK_USER_TOKEN || '';

// Voice — read via readEnvFile, not process.env
export const GROQ_API_KEY = envConfig.GROQ_API_KEY ?? '';
export const ELEVENLABS_API_KEY = envConfig.ELEVENLABS_API_KEY ?? '';
export const ELEVENLABS_VOICE_ID = envConfig.ELEVENLABS_VOICE_ID ?? '';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PROJECT_ROOT is the claudeclaw/ directory — where CLAUDE.md lives.
// The SDK uses this as cwd, which causes Claude Code to load our CLAUDE.md
// and all global skills from ~/.claude/skills/ via settingSources.
export const PROJECT_ROOT = path.resolve(__dirname, '..');

// Store directory: configurable via STORE_DIR env var to move SQLite off OneDrive.
// OneDrive's sync causes WAL/SHM lock errors under load.
const rawStoreDir = process.env.STORE_DIR || envConfig.STORE_DIR || '';
export const STORE_DIR = rawStoreDir
  ? path.resolve(rawStoreDir)
  : path.resolve(PROJECT_ROOT, 'store');

// ── External config directory ────────────────────────────────────────
// Personal config files (CLAUDE.md, agent.yaml, agent CLAUDE.md) can live
// outside the repo in CLAUDECLAW_CONFIG (default ~/.claudeclaw) so they
// never get committed. The repo ships only .example template files.

/** Expand ~/... to an absolute path. */
export function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

const rawConfigDir =
  process.env.CLAUDECLAW_CONFIG || envConfig.CLAUDECLAW_CONFIG || '~/.claudeclaw';

/**
 * Absolute path to the external config directory.
 * Defaults to ~/.claudeclaw. Set CLAUDECLAW_CONFIG in .env or environment to override.
 */
export const CLAUDECLAW_CONFIG = expandHome(rawConfigDir);

// Telegram limits
export const MAX_MESSAGE_LENGTH = 4096;

// How often to refresh the typing indicator while Claude is thinking (ms).
// Telegram's typing action expires after ~5s, so 4s keeps it continuous.
export const TYPING_REFRESH_MS = 4000;

// Maximum time (ms) an agent query can run before being auto-aborted.
// Safety net for truly stuck commands (e.g. recursive `find /`).
// Default: 15 minutes. Use /stop in Telegram to manually kill a running query.
// Previously 5 min, which caused mid-execution timeouts on bulk API work
// (posting YouTube comments, sending multiple messages) leading to duplicate posts.
export const AGENT_TIMEOUT_MS = parseInt(
  process.env.AGENT_TIMEOUT_MS || envConfig.AGENT_TIMEOUT_MS || '900000',
  10,
);

// Context window limit for the model. Opus 4.6 (1M context) = 1,000,000.
// Override via CONTEXT_LIMIT in .env if using a different model variant.
export const CONTEXT_LIMIT = parseInt(
  process.env.CONTEXT_LIMIT || envConfig.CONTEXT_LIMIT || '1000000',
  10,
);

// Dashboard — web UI for monitoring ClaudeClaw state
export const DASHBOARD_PORT = parseInt(
  process.env.DASHBOARD_PORT || envConfig.DASHBOARD_PORT || '3141',
  10,
);
export const DASHBOARD_TOKEN =
  process.env.DASHBOARD_TOKEN || envConfig.DASHBOARD_TOKEN || '';
export const DASHBOARD_URL =
  process.env.DASHBOARD_URL || envConfig.DASHBOARD_URL || '';

// Database encryption key (SQLCipher). Required for encrypted database access.
export const DB_ENCRYPTION_KEY =
  process.env.DB_ENCRYPTION_KEY || envConfig.DB_ENCRYPTION_KEY || '';

// Google API key for Gemini (memory extraction + consolidation)
export const GOOGLE_API_KEY =
  process.env.GOOGLE_API_KEY || envConfig.GOOGLE_API_KEY || '';

// Streaming strategy for progressive Telegram updates.
// 'global-throttle': edits a placeholder message with streamed text,
//   rate-limited to ~24 edits/min per chat to respect Telegram limits.
// 'off' (default): no streaming, wait for full response.
export type StreamStrategy = 'global-throttle' | 'off';
export const STREAM_STRATEGY: StreamStrategy =
  (process.env.STREAM_STRATEGY || envConfig.STREAM_STRATEGY || 'off') as StreamStrategy;

// ── Security ─────────────────────────────────────────────────────────
// PIN lock: SHA-256 hash of your PIN. Generate: node -e "console.log(require('crypto').createHash('sha256').update('YOUR_PIN').digest('hex'))"
export const SECURITY_PIN_HASH =
  process.env.SECURITY_PIN_HASH || envConfig.SECURITY_PIN_HASH || '';

// Auto-lock after N minutes of inactivity. 0 = disabled. Only active when PIN is set.
export const IDLE_LOCK_MINUTES = parseInt(
  process.env.IDLE_LOCK_MINUTES || envConfig.IDLE_LOCK_MINUTES || '0',
  10,
);

// Emergency kill phrase. Sending this to any bot immediately stops all agents and exits.
export const EMERGENCY_KILL_PHRASE =
  process.env.EMERGENCY_KILL_PHRASE || envConfig.EMERGENCY_KILL_PHRASE || '';

// ── Trading integration (regime-trader) ─────────────────────────────
// Path to the regime-trader project directory
export const REGIME_TRADER_PATH =
  process.env.REGIME_TRADER_PATH || envConfig.REGIME_TRADER_PATH || '';

// Comma-separated list of regime-trader instance names to monitor
export const REGIME_TRADER_INSTANCES = (
  process.env.REGIME_TRADER_INSTANCES || envConfig.REGIME_TRADER_INSTANCES || ''
).split(',').map(s => s.trim()).filter(Boolean);

// ── Polymarket bot ───────────────────────────────────────────────────
function num(key: string, def: number): number {
  const v = process.env[key] ?? envConfig[key];
  const n = v === undefined || v === '' ? def : Number(v);
  return Number.isFinite(n) ? n : def;
}

export const POLY_ENABLED =
  (process.env.POLY_ENABLED || envConfig.POLY_ENABLED || 'false').toLowerCase() === 'true';
export const POLY_PAPER_CAPITAL = num('POLY_PAPER_CAPITAL', 5000);
export const POLY_MAX_TRADE_USD = num('POLY_MAX_TRADE_USD', 50);
export const POLY_MAX_OPEN_POSITIONS = num('POLY_MAX_OPEN_POSITIONS', 10);
export const POLY_MAX_DEPLOYED_PCT = num('POLY_MAX_DEPLOYED_PCT', 0.5);
export const POLY_MIN_EDGE_PCT = num('POLY_MIN_EDGE_PCT', 8);
export const POLY_MIN_TTR_HOURS = num('POLY_MIN_TTR_HOURS', 24);
export const POLY_MIN_VOLUME_USD = num('POLY_MIN_VOLUME_USD', 10000);
export const POLY_DAILY_LOSS_PCT = num('POLY_DAILY_LOSS_PCT', 0.05);
export const POLY_HALT_DD_PCT = num('POLY_HALT_DD_PCT', 0.2);
export const POLY_KELLY_FRACTION = num('POLY_KELLY_FRACTION', 0.25);
export const POLY_MODEL =
  process.env.POLY_MODEL || envConfig.POLY_MODEL || 'claude-opus-4-6';
export const POLY_SCAN_INTERVAL_MIN = num('POLY_SCAN_INTERVAL_MIN', 15);
export const POLY_DIGEST_HOUR = num('POLY_DIGEST_HOUR', 6);
export const POLY_TIMEZONE =
  process.env.POLY_TIMEZONE || envConfig.POLY_TIMEZONE || 'America/New_York';
export const POLY_CALIBRATION_HOUR = num('POLY_CALIBRATION_HOUR', 7);
export const POLY_CALIBRATION_BRIER_ALERT = num('POLY_CALIBRATION_BRIER_ALERT', 0.30);
export const POLY_CALIBRATION_LOOKBACK_DAYS = num('POLY_CALIBRATION_LOOKBACK_DAYS', 30);
export const POLY_REGIME_REFRESH_MIN = num('POLY_REGIME_REFRESH_MIN', 15);
// Sprint 5.5 band filter — exclude long-shot tails where the LLM has
// near-zero informational edge. Sprint 5 backtest showed 639 signals
// at edge 0.1-2.5pp because we were evaluating 0.3%-2% probability
// markets. 0.15-0.85 keeps us in the middle of the probability space.
export const POLY_MIN_MARKET_PRICE = num('POLY_MIN_MARKET_PRICE', 0.15);
export const POLY_MAX_MARKET_PRICE = num('POLY_MAX_MARKET_PRICE', 0.85);
export const POLY_RESEARCH_NOTEBOOK_ID =
  process.env.POLY_RESEARCH_NOTEBOOK_ID || envConfig.POLY_RESEARCH_NOTEBOOK_ID || '';
// Sprint 2.5 reflection pass — when true, every approved primary evaluation
// also triggers a critic call and records a shadow signal (approved=0,
// rejection_reasons='shadow:reflect') tagged prompt_version='v3-reflect'.
// The shadow drives no trade; it exists purely for A/B Brier measurement
// via compareStrategiesOnResolutions. Off by default — enable once the
// critic prompt is validated against a week of live signals.
export const POLY_REFLECTION_ENABLED =
  (process.env.POLY_REFLECTION_ENABLED || envConfig.POLY_REFLECTION_ENABLED || 'false').toLowerCase() === 'true';
// Sprint 7 — confidence-weighted Kelly multipliers. Applied on top of
// POLY_KELLY_FRACTION so a low-confidence signal at the same edge gets a
// smaller position than a high-confidence one. Defaults discount low
// aggressively (0.3x) — sprint 2.5 reflection pass can force confidence
// to 'low' on contradictions, so this doubles as reflection-trust scaling.
// Range clamped to [0, 1] at read time; values above 1 are treated as 1.
export const POLY_KELLY_LOW_MULT  = num('POLY_KELLY_LOW_MULT',  0.3);
export const POLY_KELLY_MED_MULT  = num('POLY_KELLY_MED_MULT',  0.7);
export const POLY_KELLY_HIGH_MULT = num('POLY_KELLY_HIGH_MULT', 1.0);
// Sprint 8 — intra-resolution exits. Take profit at +30% on cost basis,
// stop loss at -50%. Both measured as (current_price - entry_price) /
// entry_price. Disabled by default until the thresholds are validated
// against a few resolved markets. Enabling doubles the writes per
// pnl-tracker tick (reconcile + possible exit).
export const POLY_EXIT_ENABLED =
  (process.env.POLY_EXIT_ENABLED || envConfig.POLY_EXIT_ENABLED || 'false').toLowerCase() === 'true';
export const POLY_TAKE_PROFIT_PCT = num('POLY_TAKE_PROFIT_PCT', 0.30);
export const POLY_STOP_LOSS_PCT   = num('POLY_STOP_LOSS_PCT',   0.50);
// Sprint 9 — exposure-aware Kelly sizing. When true, StrategyEngine sizes
// each signal against paperCapital minus sum(size_usd) of currently-open
// paper trades. Off by default — enable once Sun resolution-fetch has
// produced at least one full cycle so we're confident the open-trade table
// stays clean (voided trades exit the exposure pool correctly).
export const POLY_EXPOSURE_AWARE_SIZING =
  (process.env.POLY_EXPOSURE_AWARE_SIZING || envConfig.POLY_EXPOSURE_AWARE_SIZING || 'false').toLowerCase() === 'true';
export const ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || envConfig.ANTHROPIC_API_KEY || '';

