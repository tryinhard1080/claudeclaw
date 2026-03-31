/**
 * Tool permission context for per-agent access control.
 *
 * Immutable value object that checks whether a tool name is blocked
 * by exact match or prefix match. All matching is case-insensitive,
 * normalized at construction time.
 *
 * Adopted from claw-code's ToolPermissionContext pattern.
 */

import { logger } from './logger.js';

export class ToolPermissionContext {
  /** Exact tool names to deny (lowercased, O(1) lookup). */
  readonly denyNames: ReadonlySet<string>;

  /** Tool name prefixes to deny (lowercased, scanned in order). */
  readonly denyPrefixes: readonly string[];

  private constructor(
    denyNames: ReadonlySet<string>,
    denyPrefixes: readonly string[],
  ) {
    this.denyNames = denyNames;
    this.denyPrefixes = denyPrefixes;
  }

  /**
   * Normalizing factory. Lowercases all entries at creation time
   * so every blocks() call is fast and consistent.
   */
  static fromIterables(
    denyNames?: readonly string[],
    denyPrefixes?: readonly string[],
  ): ToolPermissionContext {
    return new ToolPermissionContext(
      new Set((denyNames ?? []).map((n) => n.toLowerCase())),
      Object.freeze((denyPrefixes ?? []).map((p) => p.toLowerCase())),
    );
  }

  /** A context that blocks nothing. Singleton for reuse. */
  static readonly ALLOW_ALL = new ToolPermissionContext(
    new Set<string>(),
    Object.freeze([]),
  );

  /** True if the given tool name is blocked by this context. */
  blocks(toolName: string): boolean {
    const lowered = toolName.toLowerCase();
    return (
      this.denyNames.has(lowered) ||
      this.denyPrefixes.some((p) => lowered.startsWith(p))
    );
  }

  /** True if this context has any restrictions at all. */
  get hasRestrictions(): boolean {
    return this.denyNames.size > 0 || this.denyPrefixes.length > 0;
  }

  /** Log a blocked tool access attempt. */
  logBlocked(toolName: string, agentId: string): void {
    logger.warn(
      { toolName, agentId, denyNames: [...this.denyNames], denyPrefixes: this.denyPrefixes },
      'Tool blocked by permission context',
    );
  }
}
