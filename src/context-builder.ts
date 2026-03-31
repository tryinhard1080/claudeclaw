/**
 * Runtime context builder.
 *
 * Snapshots the system environment at a point in time. Captures project paths,
 * agent inventory, database state, and uptime into an immutable value object.
 * Used by the dashboard API and injected into agent first-turn prompts.
 *
 * Adopted from claw-code's PortContext pattern.
 */

import fs from 'fs';
import path from 'path';

import { listAgentIds } from './agent-config.js';
import { AGENT_ID, CONTEXT_LIMIT, DASHBOARD_PORT, PROJECT_ROOT, STORE_DIR, agentDefaultModel } from './config.js';
import { getAllCommands, getSkillCommands } from './registry.js';

// ── Types ────────────────────────────────────────────────────────────

export interface RuntimeContext {
  /** Absolute path to the ClaudeClaw project root. */
  readonly projectRoot: string;
  /** Absolute path to the SQLite database. */
  readonly dbPath: string;
  /** Whether the database file exists. */
  readonly dbExists: boolean;
  /** Database file size in bytes (0 if not found). */
  readonly dbSizeBytes: number;
  /** Current agent ID (main or sub-agent name). */
  readonly agentId: string;
  /** List of all configured agent IDs. */
  readonly agentIds: readonly string[];
  /** Total number of registered commands (built-in + skills). */
  readonly totalCommands: number;
  /** Number of auto-discovered skill commands. */
  readonly skillCount: number;
  /** Default model for this agent. */
  readonly model: string;
  /** Context window limit. */
  readonly contextLimit: number;
  /** Dashboard port. */
  readonly dashboardPort: number;
  /** Process uptime in seconds. */
  readonly uptimeSeconds: number;
  /** Process PID. */
  readonly pid: number;
  /** Platform (win32, darwin, linux). */
  readonly platform: string;
  /** Node.js version. */
  readonly nodeVersion: string;
  /** Timestamp when this snapshot was taken (ISO string). */
  readonly snapshotAt: string;
}

// ── Builder ─────────────────────────────────────────────────────────

/**
 * Build a runtime context snapshot. All values are computed eagerly
 * and frozen -- the object does not stay live or re-query after construction.
 *
 * @param base Optional project root override (for testing).
 */
export function buildRuntimeContext(base?: string): RuntimeContext {
  const root = base ?? PROJECT_ROOT;
  const dbPath = path.join(base ? path.join(base, 'store') : STORE_DIR, 'claudeclaw.db');

  let dbSizeBytes = 0;
  let dbExists = false;
  try {
    const stat = fs.statSync(dbPath);
    dbExists = true;
    dbSizeBytes = stat.size;
  } catch {
    // DB doesn't exist yet
  }

  return Object.freeze({
    projectRoot: root,
    dbPath,
    dbExists,
    dbSizeBytes,
    agentId: AGENT_ID,
    agentIds: Object.freeze(listAgentIds()),
    totalCommands: getAllCommands().length,
    skillCount: getSkillCommands().length,
    model: agentDefaultModel ?? 'claude-opus-4-6',
    contextLimit: CONTEXT_LIMIT,
    dashboardPort: DASHBOARD_PORT,
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid,
    platform: process.platform,
    nodeVersion: process.version,
    snapshotAt: new Date().toISOString(),
  });
}

// ── Renderers (separate from data, per claw-code pattern) ───────────

/** Render context as a compact string for agent injection. */
export function renderContextForAgent(ctx: RuntimeContext): string {
  const lines = [
    '[System context]',
    `Agent: ${ctx.agentId} | Model: ${ctx.model} | Context limit: ${(ctx.contextLimit / 1000).toFixed(0)}k`,
    `Agents available: ${ctx.agentIds.length > 0 ? ctx.agentIds.join(', ') : '(none)'}`,
    `Commands: ${ctx.totalCommands} (${ctx.skillCount} skills) | Uptime: ${formatUptime(ctx.uptimeSeconds)}`,
    `Platform: ${ctx.platform} | Node: ${ctx.nodeVersion}`,
    '[End system context]',
  ];
  return lines.join('\n');
}

/** Render context as JSON for dashboard API. */
export function renderContextForDashboard(ctx: RuntimeContext): Record<string, unknown> {
  return { ...ctx };
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
