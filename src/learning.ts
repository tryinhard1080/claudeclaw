/**
 * Automated learning loop.
 *
 * Analyzes conversation turns to detect corrections, frustrations,
 * and rephrases. Extracts lessons and stores them for context injection.
 */

import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { generateContent, parseJsonResponse } from './gemini.js';
import { logger } from './logger.js';

// ── Types ────────────────────────────────────────────────────────────

interface LessonExtraction {
  skip: boolean;
  lesson?: string;
  category?: 'correction' | 'preference' | 'workflow' | 'mistake';
}

// ── Constants ────────────────────────────────────────────────────────

const LESSONS_FILE = path.join(STORE_DIR, 'profile', 'lessons.md');
const MAX_LESSONS = 50; // Keep last 50 lessons

const EXTRACTION_PROMPT = `You are a learning extraction agent. Given a conversation exchange, determine if the user corrected the assistant's behavior.

EXTRACT a lesson ONLY if:
- The user explicitly corrected the assistant ("no, don't do that", "I said X not Y", "stop doing that")
- The user expressed frustration with the approach ("that's wrong", "not what I asked")
- The user had to rephrase significantly because the assistant misunderstood
- The user gave positive feedback on a non-obvious approach ("yes exactly", "perfect, keep doing that")

SKIP (return {"skip": true}) if:
- Normal conversation flow with no correction
- The user simply provided more information
- The assistant made a small mistake that was caught and fixed
- Routine task execution

If extracting, return JSON:
{
  "skip": false,
  "lesson": "One-line rule for the assistant to follow in the future. Write as an imperative instruction.",
  "category": "correction|preference|workflow|mistake"
}

User message: {USER_MESSAGE}
Assistant response: {ASSISTANT_RESPONSE}`;

// ── Core ─────────────────────────────────────────────────────────────

/**
 * Analyze a conversation turn for lessons. Fire-and-forget.
 * Returns true if a lesson was extracted.
 */
export async function extractLesson(
  userMessage: string,
  assistantResponse: string,
): Promise<boolean> {
  // Skip short messages and commands
  if (userMessage.length < 20 || userMessage.startsWith('/')) return false;

  try {
    const prompt = EXTRACTION_PROMPT
      .replace('{USER_MESSAGE}', userMessage.slice(0, 1500))
      .replace('{ASSISTANT_RESPONSE}', assistantResponse.slice(0, 1500));

    const raw = await generateContent(prompt);
    const result = parseJsonResponse<LessonExtraction>(raw);

    if (!result || result.skip || !result.lesson) return false;

    appendLesson(result.lesson, result.category ?? 'correction');
    logger.info({ lesson: result.lesson.slice(0, 80), category: result.category }, 'Lesson extracted');
    return true;
  } catch (err) {
    logger.debug({ err }, 'Lesson extraction failed (non-fatal)');
    return false;
  }
}

// ── Persistence ──────────────────────────────────────────────────────

function appendLesson(lesson: string, category: string): void {
  const dir = path.dirname(LESSONS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const entry = `- [${timestamp}] [${category}] ${lesson}`;

  let lines: string[] = [];
  if (fs.existsSync(LESSONS_FILE)) {
    lines = fs.readFileSync(LESSONS_FILE, 'utf-8').split('\n').filter((l) => l.trim());
  }

  lines.push(entry);

  // Keep only the most recent lessons
  if (lines.length > MAX_LESSONS) {
    lines = lines.slice(lines.length - MAX_LESSONS);
  }

  fs.writeFileSync(LESSONS_FILE, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Get the most recent lessons for context injection.
 */
export function getRecentLessons(count = 5): string[] {
  if (!fs.existsSync(LESSONS_FILE)) return [];

  const lines = fs.readFileSync(LESSONS_FILE, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().startsWith('-'));

  return lines.slice(-count);
}

/**
 * Format lessons for agent context injection.
 */
export function formatLessonsForContext(count = 5): string | null {
  const lessons = getRecentLessons(count);
  if (lessons.length === 0) return null;

  return `[Learned behaviors -- follow these]\n${lessons.join('\n')}\n[End learned behaviors]`;
}
