/**
 * User profile system.
 *
 * Maintains a structured, persistent profile about the user that gets
 * injected into every agent context. Unlike the episodic memory system
 * (which stores facts from conversations), the profile is a curated,
 * always-current document about who the user is.
 *
 * Profile files live in STORE_DIR/profile/ as plain markdown.
 */

import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

// ── Types ────────────────────────────────────────────────────────────

export type ProfileSection =
  | 'identity'
  | 'projects'
  | 'preferences'
  | 'workflows'
  | 'contacts'
  | 'goals';

const SECTIONS: readonly ProfileSection[] = Object.freeze([
  'identity',
  'projects',
  'preferences',
  'workflows',
  'contacts',
  'goals',
]);

interface ProfileCache {
  content: Map<ProfileSection, string>;
  loadedAt: number;
}

// ── Cache ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // Re-read files every 60s
let cache: ProfileCache | null = null;

// ── Paths ────────────────────────────────────────────────────────────

function profileDir(): string {
  return path.join(STORE_DIR, 'profile');
}

function sectionPath(section: ProfileSection): string {
  return path.join(profileDir(), `${section}.md`);
}

// ── Core API ─────────────────────────────────────────────────────────

/** Ensure the profile directory exists. */
function ensureDir(): void {
  const dir = profileDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Read a single profile section. Returns empty string if file doesn't exist. */
function readSection(section: ProfileSection): string {
  const fp = sectionPath(section);
  try {
    return fs.readFileSync(fp, 'utf-8').trim();
  } catch {
    return '';
  }
}

/** Load all profile sections into cache. */
function loadAll(): Map<ProfileSection, string> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.content;
  }

  const content = new Map<ProfileSection, string>();
  for (const section of SECTIONS) {
    const text = readSection(section);
    if (text) content.set(section, text);
  }

  cache = { content, loadedAt: now };
  return content;
}

/**
 * Load the full profile as a formatted context block for agent injection.
 * Returns null if no profile data exists.
 */
export function loadProfile(): string | null {
  const sections = loadAll();
  if (sections.size === 0) return null;

  const lines: string[] = ['[User Profile]'];

  for (const section of SECTIONS) {
    const text = sections.get(section);
    if (!text) continue;
    const title = section.charAt(0).toUpperCase() + section.slice(1);
    lines.push(`## ${title}`, text, '');
  }

  lines.push('[End User Profile]');
  return lines.join('\n');
}

/**
 * Get a compressed profile summary for token-constrained contexts
 * (sub-agents, delegated tasks). Max ~300 tokens.
 */
export function getProfileSummary(): string | null {
  const sections = loadAll();
  if (sections.size === 0) return null;

  const parts: string[] = ['[User Profile Summary]'];

  const identity = sections.get('identity');
  if (identity) {
    // Take first 3 lines as summary
    const lines = identity.split('\n').filter((l) => l.trim()).slice(0, 3);
    parts.push(lines.join('. '));
  }

  const projects = sections.get('projects');
  if (projects) {
    // Extract just project names (lines starting with - or *)
    const names = projects
      .split('\n')
      .filter((l) => /^[-*]\s/.test(l.trim()))
      .map((l) => l.replace(/^[-*]\s+\*\*([^*]+)\*\*.*/, '$1').trim())
      .slice(0, 5);
    if (names.length > 0) parts.push(`Active projects: ${names.join(', ')}`);
  }

  const prefs = sections.get('preferences');
  if (prefs) {
    const lines = prefs.split('\n').filter((l) => l.trim()).slice(0, 2);
    parts.push(lines.join('. '));
  }

  parts.push('[End Profile Summary]');
  return parts.join('\n');
}

/**
 * Update a specific profile section. Overwrites the file.
 */
export function updateProfile(section: ProfileSection, content: string): void {
  ensureDir();
  const fp = sectionPath(section);
  fs.writeFileSync(fp, content.trim() + '\n', 'utf-8');
  // Invalidate cache
  cache = null;
  logger.info({ section }, 'Profile section updated');
}

/**
 * Get raw content of a single profile section.
 */
export function getSection(section: ProfileSection): string {
  return readSection(section);
}

/**
 * List all sections and their status (has content or not).
 */
export function listSections(): Array<{ section: ProfileSection; hasContent: boolean; sizeBytes: number }> {
  return SECTIONS.map((section) => {
    const fp = sectionPath(section);
    try {
      const stat = fs.statSync(fp);
      return { section, hasContent: stat.size > 0, sizeBytes: stat.size };
    } catch {
      return { section, hasContent: false, sizeBytes: 0 };
    }
  });
}

/**
 * Check if the profile has any content at all.
 */
export function hasProfile(): boolean {
  return loadAll().size > 0;
}

/**
 * Format profile for Telegram display (human-readable summary).
 */
export function formatProfileForTelegram(): string {
  const sections = loadAll();
  if (sections.size === 0) {
    return 'No profile data yet. Use /profile edit to set up your profile.';
  }

  const lines: string[] = ['Your Profile:\n'];
  for (const section of SECTIONS) {
    const text = sections.get(section);
    const icon = text ? '✓' : '○';
    const title = section.charAt(0).toUpperCase() + section.slice(1);
    if (text) {
      // Show first 2 lines as preview
      const preview = text.split('\n').filter((l) => l.trim()).slice(0, 2).join('\n  ');
      lines.push(`${icon} ${title}:\n  ${preview}`);
    } else {
      lines.push(`${icon} ${title}: (empty)`);
    }
  }

  return lines.join('\n');
}

/** Force invalidation of profile cache (e.g. after external edit). */
export function invalidateProfileCache(): void {
  cache = null;
}
