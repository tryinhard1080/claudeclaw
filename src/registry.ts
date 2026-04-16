/**
 * Unified command/skill registry.
 *
 * Lazy-loaded singleton that merges built-in Telegram commands with
 * auto-discovered Claude Code skills into a single queryable registry.
 *
 * Adopted from claw-code's registry factory pattern.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ────────────────────────────────────────────────────────────

export interface CommandEntry {
  /** Telegram command name (without leading slash). */
  readonly command: string;
  /** Human-readable description for Telegram menu. */
  readonly description: string;
  /** Where this command comes from. */
  readonly source: 'builtin' | 'skill';
}

// ── Built-in commands (static, defined once) ────────────────────────

const BUILTIN_COMMANDS: readonly CommandEntry[] = Object.freeze([
  { command: 'start', description: 'Start the bot', source: 'builtin' },
  { command: 'help', description: 'Help -- list available commands', source: 'builtin' },
  { command: 'newchat', description: 'Start a new Claude session', source: 'builtin' },
  { command: 'respin', description: 'Reload recent context', source: 'builtin' },
  { command: 'voice', description: 'Toggle voice mode on/off', source: 'builtin' },
  { command: 'model', description: 'Switch model (opus/sonnet/haiku)', source: 'builtin' },
  { command: 'memory', description: 'View recent memories', source: 'builtin' },
  { command: 'forget', description: 'Clear session', source: 'builtin' },
  { command: 'dashboard', description: 'Open web dashboard', source: 'builtin' },
  { command: 'stop', description: 'Stop current processing', source: 'builtin' },
  { command: 'agents', description: 'List available agents', source: 'builtin' },
  { command: 'delegate', description: 'Delegate task to agent', source: 'builtin' },
  { command: 'lock', description: 'Lock session (requires PIN to unlock)', source: 'builtin' },
  { command: 'status', description: 'Show security status', source: 'builtin' },
  { command: 'pin', description: 'Pin a memory', source: 'builtin' },
  { command: 'unpin', description: 'Unpin a memory', source: 'builtin' },
]);

// ── Skill discovery ─────────────────────────────────────────────────

/** Scan a single skills directory and return discovered CommandEntry items. */
function scanSkillsDir(skillsDir: string): CommandEntry[] {
  const commands: CommandEntry[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(skillsDir);
  } catch {
    return commands;
  }

  for (const entry of entries) {
    const skillFile = path.join(skillsDir, entry, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    try {
      const content = fs.readFileSync(skillFile, 'utf-8');

      // Parse YAML frontmatter between --- delimiters
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];

      // Check user_invocable: true
      if (!/user_invocable:\s*true/i.test(fm)) continue;

      // Extract name
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      if (!nameMatch) continue;
      const name = nameMatch[1].trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!name) continue;

      // Extract description (truncate to 256 chars for Telegram limit)
      const descMatch = fm.match(/^description:\s*(.+)$/m);
      const desc = descMatch
        ? descMatch[1].trim().slice(0, 256)
        : `Run the ${name} skill`;

      commands.push({ command: name, description: desc, source: 'skill' });
    } catch {
      // Skip malformed skill files
    }
  }

  return commands;
}

function discoverSkills(): CommandEntry[] {
  const seen = new Set<string>();
  const commands: CommandEntry[] = [];

  // Scan project-local skills/ first (higher priority)
  const projectSkillsDir = path.join(path.resolve(__dirname, '..'), 'skills');
  for (const cmd of scanSkillsDir(projectSkillsDir)) {
    if (!seen.has(cmd.command)) {
      seen.add(cmd.command);
      commands.push(cmd);
    }
  }

  // Then scan user-global ~/.claude/skills/
  const globalSkillsDir = path.join(os.homedir(), '.claude', 'skills');
  for (const cmd of scanSkillsDir(globalSkillsDir)) {
    if (!seen.has(cmd.command)) {
      seen.add(cmd.command);
      commands.push(cmd);
    }
  }

  return commands.sort((a, b) => a.command.localeCompare(b.command));
}

// ── Lazy-loaded registry singleton ──────────────────────────────────

let _allCommands: readonly CommandEntry[] | null = null;
let _builtinNames: ReadonlySet<string> | null = null;

/** Load and cache the full registry. Filesystem scan happens once. */
function ensureLoaded(): readonly CommandEntry[] {
  if (_allCommands) return _allCommands;

  const skills = discoverSkills();
  _allCommands = Object.freeze([...BUILTIN_COMMANDS, ...skills]);
  logger.info({ builtins: BUILTIN_COMMANDS.length, skills: skills.length }, 'Command registry loaded');
  return _allCommands;
}

// ── Public API ──────────────────────────────────────────────────────

/** Get all registered commands (built-in + skills), capped at Telegram's 100 limit. */
export function getAllCommands(): readonly CommandEntry[] {
  return ensureLoaded().slice(0, 100);
}

/** Get commands formatted for Telegram's setMyCommands API. */
export function getTelegramCommands(): Array<{ command: string; description: string }> {
  return getAllCommands().map(({ command, description }) => ({ command, description }));
}

/** Check if a command name (without slash) is a built-in bot command. */
export function isBuiltinCommand(name: string): boolean {
  if (!_builtinNames) {
    _builtinNames = new Set(BUILTIN_COMMANDS.map((c) => c.command));
  }
  return _builtinNames.has(name);
}

/**
 * Check if a slash command (with leading /) is handled by the bot itself.
 * Used to distinguish own commands from skill invocations passed to Claude.
 */
export function isOwnCommand(cmd: string): boolean {
  const name = cmd.startsWith('/') ? cmd.slice(1) : cmd;
  return isBuiltinCommand(name);
}

/** Look up a specific command by name. */
export function getCommand(name: string): CommandEntry | undefined {
  return ensureLoaded().find((c) => c.command === name);
}

/** Get only skill commands. */
export function getSkillCommands(): readonly CommandEntry[] {
  return ensureLoaded().filter((c) => c.source === 'skill');
}

/** Force a re-scan (e.g. after installing new skills). */
export function refreshRegistry(): void {
  _allCommands = null;
  _builtinNames = null;
  ensureLoaded();
}
