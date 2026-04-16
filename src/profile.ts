/**
 * User profile context injection.
 *
 * Read-only loader for the partnership context that gets injected into
 * every agent session. Profile files live in STORE_DIR/profile/ as plain
 * markdown and are curated manually — this module does not expose any
 * editing surface.
 *
 * Phase 4b (2026-04-15): the interactive /profile interview and
 * Telegram-formatting helpers were removed with the personal-assistant
 * strip. Only `loadProfile` (first-turn context) and `getSection`
 * (active-project detection) remain.
 */

import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';

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
 * Get raw content of a single profile section.
 * Used by context-builder to detect which active project the user is discussing.
 */
export function getSection(section: ProfileSection): string {
  return readSection(section);
}
