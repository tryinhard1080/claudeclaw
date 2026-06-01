#!/usr/bin/env tsx
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..');
const FINANCIAL_DATASETS_URL = 'https://mcp.financialdatasets.ai/api';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(PROJECT_ROOT, relativePath));
}

function sha256(relativePath: string): string {
  return crypto.createHash('sha256').update(readText(relativePath)).digest('hex');
}

function checkFile(relativePath: string): CheckResult {
  return {
    name: relativePath,
    ok: exists(relativePath),
    detail: exists(relativePath) ? 'present' : 'missing',
  };
}

function checkContains(relativePath: string, needle: string): CheckResult {
  if (!exists(relativePath)) {
    return { name: `${relativePath} contains ${needle}`, ok: false, detail: 'file missing' };
  }
  const found = readText(relativePath).includes(needle);
  return {
    name: `${relativePath} contains ${needle}`,
    ok: found,
    detail: found ? 'found' : 'missing pointer',
  };
}

function checkMirrored(left: string, right: string): CheckResult {
  if (!exists(left) || !exists(right)) {
    return {
      name: `${left} mirrors ${right}`,
      ok: false,
      detail: 'one or both files missing',
    };
  }
  const leftHash = sha256(left);
  const rightHash = sha256(right);
  return {
    name: `${left} mirrors ${right}`,
    ok: leftHash === rightHash,
    detail: leftHash === rightHash ? leftHash.slice(0, 12) : `${leftHash.slice(0, 12)} != ${rightHash.slice(0, 12)}`,
  };
}

function checkMcpJson(): CheckResult {
  if (!exists('.mcp.json')) {
    return { name: '.mcp.json financial-datasets', ok: false, detail: 'missing .mcp.json' };
  }
  try {
    const parsed = JSON.parse(readText('.mcp.json')) as {
      mcpServers?: Record<string, { url?: string }>;
    };
    const url = parsed.mcpServers?.['financial-datasets']?.url;
    return {
      name: '.mcp.json financial-datasets',
      ok: url === FINANCIAL_DATASETS_URL,
      detail: url ?? 'missing url',
    };
  } catch (error) {
    return { name: '.mcp.json financial-datasets', ok: false, detail: String(error) };
  }
}

function checkCodexMcp(): CheckResult {
  if (!exists('.codex/config.toml')) {
    return { name: '.codex/config.toml financial-datasets', ok: false, detail: 'missing .codex/config.toml' };
  }
  const text = readText('.codex/config.toml');
  const found = text.includes('[mcp_servers.financial-datasets]') && text.includes(`url = "${FINANCIAL_DATASETS_URL}"`);
  return {
    name: '.codex/config.toml financial-datasets',
    ok: found,
    detail: found ? FINANCIAL_DATASETS_URL : 'missing server or url',
  };
}

function format(ok: boolean): string {
  return ok ? 'PASS' : 'FAIL';
}

export function collectAgentSurfaceChecks(): CheckResult[] {
  return [
    checkFile('TRUST.md'),
    checkFile('SOUL.md'),
    checkFile('MISSION.md'),
    checkFile('HEARTBEAT.md'),
    checkFile('CLAUDE.md'),
    checkFile('AGENTS.md'),
    checkFile('docs/agent-shared/README.md'),
    checkContains('CLAUDE.md', 'docs/agent-shared/README.md'),
    checkContains('AGENTS.md', 'docs/agent-shared/README.md'),
    checkMirrored('.claude/skills/add-migration/SKILL.md', '.agents/skills/add-migration/SKILL.md'),
    checkMirrored('.claude/skills/claudeclaw-readiness/SKILL.md', '.agents/skills/claudeclaw-readiness/SKILL.md'),
    checkMcpJson(),
    checkCodexMcp(),
  ];
}

export function main(): number {
  const checks = collectAgentSurfaceChecks();
  console.log('Agent Surface Check');
  console.log('-------------------');
  for (const check of checks) {
    console.log(`${format(check.ok).padEnd(4)}  ${check.name.padEnd(86)} ${check.detail}`);
  }
  return checks.every(check => check.ok) ? 0 : 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
