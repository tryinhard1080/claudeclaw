/**
 * Smart delegation detection.
 *
 * Analyzes incoming messages to detect when a specialist agent
 * would be better suited to handle the task. Returns a suggestion
 * or null if the main agent should handle it.
 */

import { getAvailableAgents } from './orchestrator.js';
import { logger } from './logger.js';

// ── Types ────────────────────────────────────────────────────────────

export interface DelegationSuggestion {
  /** Agent ID to delegate to. */
  readonly agentId: string;
  /** Human-readable reason for the suggestion. */
  readonly reason: string;
  /** Confidence score (0-1). */
  readonly confidence: number;
}

// ── Keyword patterns per agent role ──────────────────────────────────

interface AgentPattern {
  readonly agentId: string;
  readonly keywords: readonly string[];
  /** Minimum keyword matches to trigger suggestion. */
  readonly threshold: number;
}

const AGENT_PATTERNS: readonly AgentPattern[] = Object.freeze([
  {
    agentId: 'research',
    keywords: [
      'research', 'investigate', 'find out', 'look into', 'what is',
      'compare', 'analyze', 'competitive', 'market', 'trend',
      'deep dive', 'study', 'report on', 'evaluate',
    ],
    threshold: 1,
  },
  {
    agentId: 'comms',
    keywords: [
      'email', 'gmail', 'inbox', 'reply to', 'send message',
      'slack', 'whatsapp', 'linkedin', 'dm', 'message',
      'respond to', 'draft a reply', 'follow up',
    ],
    threshold: 1,
  },
  {
    agentId: 'content',
    keywords: [
      'youtube', 'video script', 'linkedin post', 'blog post',
      'content calendar', 'write a post', 'social media',
      'article', 'newsletter', 'presentation',
    ],
    threshold: 1,
  },
  {
    agentId: 'ops',
    keywords: [
      'calendar', 'schedule', 'meeting', 'billing', 'invoice',
      'stripe', 'gumroad', 'budget', 'expense', 'admin',
      'task management', 'organize',
    ],
    threshold: 1,
  },
]);

// ── Detection ────────────────────────────────────────────────────────

/**
 * Analyze a message and suggest delegation if a specialist agent matches.
 * Returns null if the main agent should handle it.
 */
export function detectDelegation(message: string): DelegationSuggestion | null {
  const msgLower = message.toLowerCase();

  // Skip very short messages, commands, and explicit delegation syntax
  if (message.length < 15 || message.startsWith('/') || message.startsWith('@')) {
    return null;
  }

  // Check which agents are actually available
  const available = new Set(getAvailableAgents().map((a) => a.id));

  let bestMatch: DelegationSuggestion | null = null;
  let bestScore = 0;

  for (const pattern of AGENT_PATTERNS) {
    if (!available.has(pattern.agentId)) continue;

    let matches = 0;
    const matched: string[] = [];
    for (const kw of pattern.keywords) {
      if (msgLower.includes(kw)) {
        matches++;
        matched.push(kw);
      }
    }

    if (matches >= pattern.threshold) {
      const confidence = Math.min(1, matches / 3); // 3+ keyword matches = full confidence
      if (confidence > bestScore) {
        bestScore = confidence;
        bestMatch = {
          agentId: pattern.agentId,
          reason: `Detected ${pattern.agentId} keywords: ${matched.join(', ')}`,
          confidence,
        };
      }
    }
  }

  if (bestMatch && bestMatch.confidence >= 0.33) {
    logger.debug(
      { agentId: bestMatch.agentId, confidence: bestMatch.confidence },
      'Delegation suggestion detected',
    );
    return bestMatch;
  }

  return null;
}
