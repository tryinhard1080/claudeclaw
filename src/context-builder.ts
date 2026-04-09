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
import { getRecentConversation } from './db.js';
import { logger } from './logger.js';
import { getSection } from './profile.js';
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

// ── Enhanced Context: Time Awareness ────────────────────────────────

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Build time-aware context: current date/time, day of week.
 * Helps the agent reason about urgency and scheduling.
 */
export function buildTimeContext(): string {
  const now = new Date();
  const day = DAYS[now.getDay()];
  const hour = now.getHours();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  let period = 'morning';
  if (hour >= 12 && hour < 17) period = 'afternoon';
  else if (hour >= 17 && hour < 21) period = 'evening';
  else if (hour >= 21 || hour < 6) period = 'night';

  return `[Time context]\n${dateStr}, ${timeStr} (${period})\n[End time context]`;
}

// ── Enhanced Context: Conversation Momentum ─────────────────────────

/**
 * Build a 1-line summary of what the user has been focused on today.
 * Scans recent conversation_log for topic patterns.
 */
export function buildMomentumContext(chatId: string): string | null {
  try {
    const turns = getRecentConversation(chatId, 20);
    if (turns.length === 0) return null;

    // Filter to today's turns only
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEpoch = Math.floor(todayStart.getTime() / 1000);

    const todayTurns = turns.filter((t) => t.created_at >= todayEpoch && t.role === 'user');
    if (todayTurns.length === 0) return null;

    // Extract short topic indicators from user messages
    const topics: string[] = [];
    for (const turn of todayTurns.slice(0, 10)) {
      const content = turn.content.slice(0, 200);
      // Skip commands and very short messages
      if (content.startsWith('/') || content.length < 20) continue;
      // Take first meaningful phrase (up to 50 chars)
      const phrase = content.split(/[.!?\n]/)[0].trim().slice(0, 50);
      if (phrase.length >= 10) topics.push(phrase);
    }

    if (topics.length === 0) return null;

    const unique = [...new Set(topics)].slice(0, 3);
    return `[Today's focus]\n${unique.join(' | ')}\n[End focus]`;
  } catch (err) {
    logger.debug({ err }, 'Failed to build momentum context');
    return null;
  }
}

// ── Enhanced Context: Active Project Detection ──────────────────────

interface ProjectKeyword {
  readonly project: string;
  readonly keywords: readonly string[];
}

/**
 * Detect which project the user is likely discussing based on message keywords.
 * Returns a hint string or null.
 */
export function detectActiveProject(userMessage: string): string | null {
  const projectsText = getSection('projects');
  if (!projectsText) return null;

  // Parse project names from the profile (lines starting with - **)
  const projectKeywords: ProjectKeyword[] = [];
  for (const line of projectsText.split('\n')) {
    const match = line.match(/^-\s+\*\*([^*]+)\*\*\s*--\s*(.+)/);
    if (!match) continue;
    const name = match[1].trim();
    const desc = match[2].trim().toLowerCase();
    // Generate keywords from project name and first few words of description
    const kw = [
      name.toLowerCase(),
      ...name.toLowerCase().split(/[\s-]+/),
      ...desc.split(/\s+/).slice(0, 5),
    ].filter((w) => w.length >= 3);
    projectKeywords.push({ project: name, keywords: kw });
  }

  const msgLower = userMessage.toLowerCase();
  for (const { project, keywords } of projectKeywords) {
    for (const kw of keywords) {
      if (msgLower.includes(kw)) {
        return `[Active project context: ${project}]`;
      }
    }
  }

  return null;
}

/**
 * Build the full enhanced context block for injection.
 * Combines time, momentum, and project detection.
 */
export function buildEnhancedContext(chatId: string, userMessage: string): string | null {
  const parts: string[] = [];

  parts.push(buildTimeContext());

  const momentum = buildMomentumContext(chatId);
  if (momentum) parts.push(momentum);

  const project = detectActiveProject(userMessage);
  if (project) parts.push(project);

  return parts.length > 0 ? parts.join('\n') : null;
}
