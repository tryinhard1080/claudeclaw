import { Api, RawApi } from 'grammy';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';

import fs from 'fs';
import path from 'path';
import { AGENT_ID, ALLOWED_CHAT_ID, DASHBOARD_PORT, DASHBOARD_TOKEN, PROJECT_ROOT, STORE_DIR, CONTEXT_LIMIT, agentDefaultModel } from './config.js';
import { buildRuntimeContext, renderContextForDashboard } from './context-builder.js';
import crypto from 'crypto';
import {
  checkDatabaseHealth,
  getAllScheduledTasks,
  deleteScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  getConversationPage,
  getDashboardMemoryStats,
  getDashboardPinnedMemories,
  getDashboardLowSalienceMemories,
  getDashboardTopAccessedMemories,
  getDashboardMemoryTimeline,
  getDashboardConsolidations,
  getDashboardMemoriesList,
  getDashboardTokenStats,
  getDashboardCostTimeline,
  getDashboardRecentTokenUsage,
  getSession,
  getSessionTokenUsage,
  getHiveMindEntries,
  getAgentTokenStats,
  getAgentRecentConversation,
  getMissionTasks,
  getMissionTask,
  createMissionTask,
  cancelMissionTask,
  deleteMissionTask,
  reassignMissionTask,
  assignMissionTask,
  getUnassignedMissionTasks,
  getMissionTaskHistory,
  getAuditLog,
  getAuditLogCount,
  getRecentBlockedActions,
  getDb,
} from './db.js';
import { generateContent, parseJsonResponse } from './gemini.js';
import { getSecurityStatus } from './security.js';
import { listAgentIds, loadAgentConfig, setAgentModel } from './agent-config.js';
import {
  listTemplates,
  validateAgentId,
  validateBotToken,
  createAgent,
  activateAgent,
  deactivateAgent,
  deleteAgent,
  suggestBotNames,
  isAgentRunning,
} from './agent-create.js';
import { processMessageFromDashboard } from './bot.js';
import { getDashboardHtml } from './dashboard-html.js';
import { logger } from './logger.js';
import { getTelegramConnected, getBotInfo, chatEvents, getIsProcessing, abortActiveQuery, ChatEvent } from './state.js';
import { buildPositionsLivePayload } from './poly/positions-view.js';
import { buildPnlBars, type DailyPnlPoint } from './dashboard-charts.js';
import { latestSnapshot as latestCalibrationSnapshot, fetchResolvedSamples, calibrationCurve } from './poly/calibration.js';
import { composeDriftReport } from './poly/drift.js';

async function classifyTaskAgent(prompt: string): Promise<string | null> {
  try {
    const agentIds = listAgentIds();
    const agentDescriptions = agentIds.map((id) => {
      try {
        const config = loadAgentConfig(id);
        return `- ${id}: ${config.description}`;
      } catch { return `- ${id}: (no description)`; }
    });

    const classificationPrompt = `Given these agents and their roles:
- main: Primary assistant, general tasks, anything that doesn't clearly fit another agent
${agentDescriptions.join('\n')}

Which ONE agent is best suited for this task?
Task: "${prompt.slice(0, 500)}"

Reply with JSON: {"agent": "agent_id"}`;

    const response = await generateContent(classificationPrompt);
    const parsed = parseJsonResponse<{ agent: string }>(response);
    if (parsed?.agent) {
      const validAgents = ['main', ...agentIds];
      if (validAgents.includes(parsed.agent)) return parsed.agent;
    }
    return 'main'; // fallback
  } catch (err) {
    logger.error({ err }, 'Auto-assign classification failed');
    return null;
  }
}

export function startDashboard(botApi?: Api<RawApi>): void {
  if (!DASHBOARD_TOKEN) {
    logger.info('DASHBOARD_TOKEN not set, dashboard disabled');
    return;
  }

  const app = new Hono();

  // Security headers + CORS (restrict to same-origin; override DASHBOARD_CORS_ORIGIN in .env for tunnel)
  app.use('*', async (c, next) => {
    const allowedOrigin = process.env.DASHBOARD_CORS_ORIGIN || 'http://localhost:' + DASHBOARD_PORT;
    c.header('Access-Control-Allow-Origin', allowedOrigin);
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // Global error handler -- prevents unhandled throws from killing the server
  app.onError((err, c) => {
    logger.error({ err: err.message }, 'Dashboard request error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  // Rate limiting (in-memory token bucket, 60 req/min per IP)
  const rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();
  const RATE_LIMIT = 60;
  const RATE_WINDOW_MS = 60_000;
  app.use('/api/*', async (c, next) => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const now = Date.now();
    let bucket = rateBuckets.get(ip);
    if (!bucket || now - bucket.lastRefill > RATE_WINDOW_MS) {
      bucket = { tokens: RATE_LIMIT, lastRefill: now };
      rateBuckets.set(ip, bucket);
    }
    if (bucket.tokens <= 0) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    bucket.tokens--;
    await next();
  });

  // Health check (no auth required -- used by pm2/monitoring)
  app.get('/health', (c) => {
    const dbOk = checkDatabaseHealth();
    const botOk = getTelegramConnected();
    const status = dbOk && botOk ? 200 : 503;
    return c.json({
      status: status === 200 ? 'healthy' : 'degraded',
      uptime: process.uptime(),
      database: dbOk ? 'ok' : 'error',
      telegram: botOk ? 'connected' : 'disconnected',
      agent: AGENT_ID,
    }, status);
  });

  // Token auth middleware (timing-safe comparison to prevent side-channel attacks)
  app.use('*', async (c, next) => {
    const token = c.req.query('token') || c.req.header('Authorization')?.replace('Bearer ', '');
    if (!DASHBOARD_TOKEN || !token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const a = Buffer.from(token);
    const b = Buffer.from(DASHBOARD_TOKEN);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  // Serve dashboard HTML
  app.get('/', (c) => {
    const chatId = c.req.query('chatId') || '';
    return c.html(getDashboardHtml(DASHBOARD_TOKEN, chatId));
  });

  // Scheduled tasks
  app.get('/api/tasks', (c) => {
    const tasks = getAllScheduledTasks();
    return c.json({ tasks });
  });

  // Delete a scheduled task
  app.delete('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    deleteScheduledTask(id);
    return c.json({ ok: true });
  });

  // Pause a scheduled task
  app.post('/api/tasks/:id/pause', (c) => {
    const id = c.req.param('id');
    pauseScheduledTask(id);
    return c.json({ ok: true });
  });

  // Resume a scheduled task
  app.post('/api/tasks/:id/resume', (c) => {
    const id = c.req.param('id');
    resumeScheduledTask(id);
    return c.json({ ok: true });
  });

  // ── Mission Control endpoints ────────────────────────────────────────

  app.get('/api/mission/tasks', (c) => {
    const agentId = c.req.query('agent') || undefined;
    const status = c.req.query('status') || undefined;
    const tasks = getMissionTasks(agentId, status);
    return c.json({ tasks });
  });

  app.get('/api/mission/tasks/:id', (c) => {
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);
    return c.json({ task });
  });

  app.post('/api/mission/tasks', async (c) => {
    const body = await c.req.json<{
      title?: string;
      prompt?: string;
      assigned_agent?: string;
      priority?: number;
    }>();

    const title = body?.title?.trim();
    const prompt = body?.prompt?.trim();
    const assignedAgent = body?.assigned_agent?.trim() || null;
    const priority = Math.max(0, Math.min(10, body?.priority ?? 0));

    if (!title || title.length > 200) return c.json({ error: 'title required (max 200 chars)' }, 400);
    if (!prompt || prompt.length > 10000) return c.json({ error: 'prompt required (max 10000 chars)' }, 400);

    // Validate agent if provided
    if (assignedAgent) {
      const validAgents = ['main', ...listAgentIds()];
      if (!validAgents.includes(assignedAgent)) {
        return c.json({ error: `Unknown agent: ${assignedAgent}. Valid: ${validAgents.join(', ')}` }, 400);
      }
    }

    const id = crypto.randomBytes(4).toString('hex');
    createMissionTask(id, title, prompt, assignedAgent, 'dashboard', priority);

    const task = getMissionTask(id);
    return c.json({ task }, 201);
  });

  app.post('/api/mission/tasks/:id/cancel', (c) => {
    const id = c.req.param('id');
    const ok = cancelMissionTask(id);
    return c.json({ ok });
  });

  // Auto-assign a single task via Gemini classification
  app.post('/api/mission/tasks/:id/auto-assign', async (c) => {
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);
    if (task.assigned_agent) return c.json({ error: 'Already assigned' }, 400);

    const agent = await classifyTaskAgent(task.prompt);
    if (!agent) return c.json({ error: 'Classification failed' }, 500);

    assignMissionTask(id, agent);
    return c.json({ ok: true, assigned_agent: agent });
  });

  // Auto-assign all unassigned tasks
  app.post('/api/mission/tasks/auto-assign-all', async (c) => {
    const tasks = getUnassignedMissionTasks();
    if (tasks.length === 0) return c.json({ assigned: 0 });

    const results: Array<{ id: string; agent: string }> = [];
    for (const task of tasks) {
      const agent = await classifyTaskAgent(task.prompt);
      if (agent && assignMissionTask(task.id, agent)) {
        results.push({ id: task.id, agent });
      }
    }
    return c.json({ assigned: results.length, results });
  });

  app.patch('/api/mission/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ assigned_agent?: string }>();
    const newAgent = body?.assigned_agent?.trim();
    if (!newAgent) return c.json({ error: 'assigned_agent required' }, 400);
    const validAgents = ['main', ...listAgentIds()];
    if (!validAgents.includes(newAgent)) return c.json({ error: 'Unknown agent' }, 400);
    const ok = reassignMissionTask(id, newAgent);
    return c.json({ ok });
  });

  app.delete('/api/mission/tasks/:id', (c) => {
    const id = c.req.param('id');
    const ok = deleteMissionTask(id);
    return c.json({ ok });
  });

  app.get('/api/mission/history', (c) => {
    const limit = parseInt(c.req.query('limit') || '30', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    return c.json(getMissionTaskHistory(limit, offset));
  });

  // Memory stats
  app.get('/api/memories', (c) => {
    const chatId = c.req.query('chatId') || '';
    const stats = getDashboardMemoryStats(chatId);
    const fading = getDashboardLowSalienceMemories(chatId, 10);
    const topAccessed = getDashboardTopAccessedMemories(chatId, 5);
    const timeline = getDashboardMemoryTimeline(chatId, 30);
    const consolidations = getDashboardConsolidations(chatId, 5);
    return c.json({ stats, fading, topAccessed, timeline, consolidations });
  });

  // Memory list (for drill-down drawer)
  app.get('/api/memories/pinned', (c) => {
    const chatId = c.req.query('chatId') || '';
    const memories = getDashboardPinnedMemories(chatId);
    return c.json({ memories });
  });

  app.get('/api/memories/list', (c) => {
    const chatId = c.req.query('chatId') || '';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const sortBy = (c.req.query('sort') || 'importance') as 'importance' | 'salience' | 'recent';
    const result = getDashboardMemoriesList(chatId, limit, offset, sortBy);
    return c.json(result);
  });

  // System health
  app.get('/api/health', (c) => {
    const chatId = c.req.query('chatId') || '';
    const sessionId = getSession(chatId);
    let contextPct = 0;
    let turns = 0;
    let compactions = 0;
    let sessionAge = '-';

    if (sessionId) {
      const summary = getSessionTokenUsage(sessionId);
      if (summary) {
        turns = summary.turns;
        compactions = summary.compactions;
        const contextTokens = (summary.lastContextTokens || 0) + (summary.lastCacheRead || 0);
        contextPct = contextTokens > 0 ? Math.round((contextTokens / CONTEXT_LIMIT) * 100) : 0;
        const ageSec = Math.floor(Date.now() / 1000) - summary.firstTurnAt;
        if (ageSec < 3600) sessionAge = Math.floor(ageSec / 60) + 'm';
        else if (ageSec < 86400) sessionAge = Math.floor(ageSec / 3600) + 'h';
        else sessionAge = Math.floor(ageSec / 86400) + 'd';
      }
    }

    return c.json({
      contextPct,
      turns,
      compactions,
      sessionAge,
      model: agentDefaultModel || 'sonnet-4-6',
      telegramConnected: getTelegramConnected(),
    });
  });

  // Token / cost stats
  app.get('/api/tokens', (c) => {
    const chatId = c.req.query('chatId') || '';
    const stats = getDashboardTokenStats(chatId);
    const costTimeline = getDashboardCostTimeline(chatId, 30);
    const recentUsage = getDashboardRecentTokenUsage(chatId, 20);
    return c.json({ stats, costTimeline, recentUsage });
  });

  // ── Polymarket trading endpoints (2026-04-21) ───────────────────────
  // Wire trading state into the dashboard. All readonly queries against
  // the same DB the scanner + strategy engine write to. No mutations.

  app.get('/api/poly/overview', (c) => {
    const db = getDb();
    const nowSec = Math.floor(Date.now() / 1000);
    const startOfDay = nowSec - (nowSec % 86400);

    const sig = db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN approved=1 THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN approved=1 AND created_at >= ? THEN 1 ELSE 0 END) AS approvedToday
      FROM poly_signals`).get(startOfDay, startOfDay) as Record<string, number | null>;

    const trades = db.prepare(`SELECT status, COUNT(*) AS n FROM poly_paper_trades GROUP BY status`).all() as Array<{ status: string; n: number }>;
    const tradesByStatus: Record<string, number> = {};
    for (const t of trades) tradesByStatus[t.status] = t.n;

    const resolutions = db.prepare(`SELECT COUNT(*) AS n FROM poly_resolutions`).get() as { n: number };

    const lastScan = db.prepare(`SELECT started_at, duration_ms, market_count, status FROM poly_scan_runs ORDER BY id DESC LIMIT 1`).get() as { started_at: number; duration_ms: number | null; market_count: number | null; status: string } | undefined;

    const realized = db.prepare(`SELECT COALESCE(SUM(realized_pnl), 0) AS total FROM poly_paper_trades WHERE status IN ('won','lost','exited')`).get() as { total: number };

    const openExposure = db.prepare(`SELECT COALESCE(SUM(size_usd), 0) AS total FROM poly_paper_trades WHERE status='open'`).get() as { total: number };

    let dbSizeBytes = 0, walSizeBytes = 0;
    try { dbSizeBytes = fs.statSync(path.join(STORE_DIR, 'claudeclaw.db')).size; } catch { /* ignore */ }
    try { walSizeBytes = fs.statSync(path.join(STORE_DIR, 'claudeclaw.db-wal')).size; } catch { /* ignore */ }

    return c.json({
      signals: {
        total: sig.total ?? 0,
        approved: sig.approved ?? 0,
        today: sig.today ?? 0,
        approvedToday: sig.approvedToday ?? 0,
      },
      trades: tradesByStatus,
      resolutions: resolutions.n,
      lastScan: lastScan
        ? { ...lastScan, ageSec: nowSec - lastScan.started_at }
        : null,
      realizedPnlUsd: realized.total,
      openExposureUsd: openExposure.total,
      dbSizeBytes,
      walSizeBytes,
    });
  });

  app.get('/api/poly/signals/recent', (c) => {
    const db = getDb();
    const limit = Math.min(parseInt(c.req.query('limit') || '25', 10) || 25, 200);
    const rows = db.prepare(`SELECT
        id, created_at, market_slug, outcome_label, market_price,
        estimated_prob, edge_pct, confidence, approved, rejection_reasons,
        prompt_version, model, provider, regime_label,
        reasoning, contrarian
      FROM poly_signals ORDER BY id DESC LIMIT ?`).all(limit);
    return c.json({ signals: rows });
  });

  app.get('/api/poly/trades', (c) => {
    const db = getDb();
    const status = c.req.query('status') || 'all';
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 500);
    let rows;
    if (status === 'all') {
      rows = db.prepare(`SELECT * FROM poly_paper_trades ORDER BY id DESC LIMIT ?`).all(limit);
    } else {
      rows = db.prepare(`SELECT * FROM poly_paper_trades WHERE status = ? ORDER BY id DESC LIMIT ?`).all(status, limit);
    }
    return c.json({ trades: rows });
  });

  app.get('/api/poly/scans/recent', (c) => {
    const db = getDb();
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 500);
    const rows = db.prepare(`SELECT started_at, duration_ms, market_count, status, error
      FROM poly_scan_runs ORDER BY id DESC LIMIT ?`).all(limit);
    return c.json({ scans: rows });
  });

  app.get('/api/poly/regime', (c) => {
    const db = getDb();
    const latest = db.prepare(`SELECT created_at, vix, btc_dominance, yield_10y, regime_label
      FROM poly_regime_snapshots ORDER BY id DESC LIMIT 1`).get();
    return c.json({ latest });
  });

  app.get('/api/poly/pnl', (c) => {
    const db = getDb();
    const realized = db.prepare(`SELECT
        DATE(created_at, 'unixepoch') AS day,
        COALESCE(SUM(realized_pnl), 0) AS pnl,
        COUNT(*) AS n
      FROM poly_paper_trades
      WHERE status IN ('won','lost','exited')
      GROUP BY day ORDER BY day ASC LIMIT 60`).all();
    const open = db.prepare(`SELECT id, created_at, market_slug, outcome_label, size_usd, entry_price, shares
      FROM poly_paper_trades WHERE status='open' ORDER BY id DESC`).all();
    return c.json({ realizedDaily: realized, open });
  });

  app.get('/api/poly/positions/live', (c) => {
    const db = getDb();
    return c.json(buildPositionsLivePayload(db));
  });

  app.get('/api/poly/calibration', (c) => {
    const db = getDb();
    const snapshot = latestCalibrationSnapshot(db);
    const resolvedRow = db.prepare(
      `SELECT COUNT(*) AS n FROM poly_paper_trades WHERE status IN ('won','lost')`
    ).get() as { n: number };
    return c.json({ snapshot, nResolvedAllTime: resolvedRow.n });
  });

  app.get('/api/poly/drift', (c) => {
    const db = getDb();
    const windowHours = Math.min(Math.max(parseInt(c.req.query('windowHours') || '24', 10) || 24, 1), 168);
    const report = composeDriftReport(db, Math.floor(Date.now() / 1000), windowHours);
    const rejectionArr = [...report.rejection.entries()]
      .map(([gate, count]) => ({ gate, count }))
      .sort((a, b) => b.count - a.count);
    const rejectionTotal = rejectionArr.reduce((s, r) => s + r.count, 0);
    return c.json({
      windowHours: report.windowHours,
      latency: report.latency,
      marketCount: report.marketCount,
      rejection: { total: rejectionTotal, byGate: rejectionArr },
    });
  });

  app.get('/api/poly/pnl/chart', (c) => {
    const db = getDb();
    const width = Math.min(Math.max(parseInt(c.req.query('width') || '360', 10) || 360, 100), 1200);
    const height = Math.min(Math.max(parseInt(c.req.query('height') || '72', 10) || 72, 40), 400);
    const rows = db.prepare(`SELECT
        DATE(created_at, 'unixepoch') AS day,
        COALESCE(SUM(realized_pnl), 0) AS pnl,
        COUNT(*) AS n
      FROM poly_paper_trades
      WHERE status IN ('won','lost','exited')
      GROUP BY day ORDER BY day ASC LIMIT 60`).all() as DailyPnlPoint[];
    const chart = buildPnlBars(rows, { width, height });
    return c.json({ width, height, ...chart });
  });

  // Bot info (name, PID, chatId) — reads dynamically from state
  app.get('/api/info', (c) => {
    const chatId = c.req.query('chatId') || '';
    const info = getBotInfo();
    return c.json({
      botName: info.name || 'ClaudeClaw',
      botUsername: info.username || '',
      pid: process.pid,
      chatId: chatId || null,
    });
  });

  // ── Agent endpoints ──────────────────────────────────────────────────

  // List all configured agents with status
  app.get('/api/agents', (c) => {
    const agentIds = listAgentIds();
    const agents = agentIds.map((id) => {
      try {
        const config = loadAgentConfig(id);
        // Check if agent process is alive via PID file
        const pidFile = path.join(STORE_DIR, `agent-${id}.pid`);
        let running = false;
        if (fs.existsSync(pidFile)) {
          try {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
            process.kill(pid, 0); // signal 0 = check if alive
            running = true;
          } catch { /* process not running */ }
        }
        const stats = getAgentTokenStats(id);
        return {
          id,
          name: config.name,
          description: config.description,
          model: config.model ?? 'claude-opus-4-6',
          running,
          todayTurns: stats.todayTurns,
          todayCost: stats.todayCost,
        };
      } catch {
        return { id, name: id, description: '', model: 'unknown', running: false, todayTurns: 0, todayCost: 0 };
      }
    });

    // Include main bot too
    const mainPidFile = path.join(STORE_DIR, 'claudeclaw.pid');
    let mainRunning = false;
    if (fs.existsSync(mainPidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(mainPidFile, 'utf-8').trim(), 10);
        process.kill(pid, 0);
        mainRunning = true;
      } catch { /* not running */ }
    }
    const mainStats = getAgentTokenStats('main');
    const allAgents = [
      { id: 'main', name: 'Main', description: 'Primary ClaudeClaw bot', model: 'claude-opus-4-6', running: mainRunning, todayTurns: mainStats.todayTurns, todayCost: mainStats.todayCost },
      ...agents,
    ];

    return c.json({ agents: allAgents });
  });

  // Agent-specific recent conversation
  app.get('/api/agents/:id/conversation', (c) => {
    const agentId = c.req.param('id');
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '4', 10);
    const turns = getAgentRecentConversation(agentId, chatId, limit);
    return c.json({ turns });
  });

  // Agent-specific tasks
  app.get('/api/agents/:id/tasks', (c) => {
    const agentId = c.req.param('id');
    const tasks = getAllScheduledTasks(agentId);
    return c.json({ tasks });
  });

  // Agent-specific token stats
  app.get('/api/agents/:id/tokens', (c) => {
    const agentId = c.req.param('id');
    const stats = getAgentTokenStats(agentId);
    return c.json(stats);
  });

  // Update agent model
  app.patch('/api/agents/:id/model', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json<{ model?: string }>();
    const model = body?.model?.trim();
    if (!model) return c.json({ error: 'model required' }, 400);

    const validModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
    if (!validModels.includes(model)) return c.json({ error: `Invalid model. Valid: ${validModels.join(', ')}` }, 400);

    try {
      if (agentId === 'main') {
        // Main agent uses in-memory override (same as /model command)
        const { setMainModelOverride } = await import('./bot.js');
        setMainModelOverride(model);
      } else {
        setAgentModel(agentId, model);
      }
      return c.json({ ok: true, agent: agentId, model });
    } catch (err) {
      return c.json({ error: 'Failed to update model' }, 500);
    }
  });

  // Update ALL agent models at once
  app.patch('/api/agents/model', async (c) => {
    const body = await c.req.json<{ model?: string }>();
    const model = body?.model?.trim();
    if (!model) return c.json({ error: 'model required' }, 400);

    const validModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
    if (!validModels.includes(model)) return c.json({ error: `Invalid model` }, 400);

    const agentIds = listAgentIds();
    const updated: string[] = [];
    for (const id of agentIds) {
      try { setAgentModel(id, model); updated.push(id); } catch {}
    }
    return c.json({ ok: true, model, updated });
  });

  // ── Agent Creation & Management ──────────────────────────────────────

  // List available agent templates
  app.get('/api/agents/templates', (c) => {
    return c.json({ templates: listTemplates() });
  });

  // Validate an agent ID (before creation)
  app.get('/api/agents/validate-id', (c) => {
    const id = c.req.query('id') || '';
    const result = validateAgentId(id);
    const suggestions = id ? suggestBotNames(id) : null;
    return c.json({ ...result, suggestions });
  });

  // Validate a bot token
  app.post('/api/agents/validate-token', async (c) => {
    const body = await c.req.json<{ token?: string }>();
    const token = body?.token?.trim();
    if (!token) return c.json({ ok: false, error: 'token required' }, 400);
    const result = await validateBotToken(token);
    return c.json(result);
  });

  // Create a new agent
  app.post('/api/agents/create', async (c) => {
    const body = await c.req.json<{
      id?: string;
      name?: string;
      description?: string;
      model?: string;
      template?: string;
      botToken?: string;
    }>();

    const id = body?.id?.trim();
    const name = body?.name?.trim();
    const description = body?.description?.trim();
    const botToken = body?.botToken?.trim();

    if (!id) return c.json({ error: 'id required' }, 400);
    if (!name) return c.json({ error: 'name required' }, 400);
    if (!description) return c.json({ error: 'description required' }, 400);
    if (!botToken) return c.json({ error: 'botToken required' }, 400);

    try {
      const result = await createAgent({
        id,
        name,
        description,
        model: body?.model?.trim() || undefined,
        template: body?.template?.trim() || undefined,
        botToken,
      });
      return c.json({ ok: true, ...result }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  // Activate an agent (install service + start)
  app.post('/api/agents/:id/activate', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot activate main via this endpoint' }, 400);
    const result = activateAgent(agentId);
    return c.json(result);
  });

  // Deactivate an agent (stop + uninstall service)
  app.post('/api/agents/:id/deactivate', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot deactivate main via this endpoint' }, 400);
    const result = deactivateAgent(agentId);
    return c.json(result);
  });

  // Delete an agent entirely
  app.delete('/api/agents/:id/full', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot delete main' }, 400);
    const result = deleteAgent(agentId);
    if (result.ok) {
      return c.json({ ok: true });
    }
    return c.json({ error: result.error }, 500);
  });

  // Check if a specific agent is running
  app.get('/api/agents/:id/status', (c) => {
    const agentId = c.req.param('id');
    return c.json({ running: isAgentRunning(agentId) });
  });

  // ── Security & Audit ─────────────────────────────────────────────────

  app.get('/api/security/status', (c) => {
    return c.json(getSecurityStatus());
  });

  app.get('/api/audit', (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const agentId = c.req.query('agent') || undefined;
    const entries = getAuditLog(limit, offset, agentId);
    const total = getAuditLogCount(agentId);
    return c.json({ entries, total });
  });

  app.get('/api/audit/blocked', (c) => {
    const limit = parseInt(c.req.query('limit') || '10', 10);
    return c.json({ entries: getRecentBlockedActions(limit) });
  });

  // Hive mind feed
  app.get('/api/hive-mind', (c) => {
    const agentId = c.req.query('agent');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const entries = getHiveMindEntries(limit, agentId || undefined);
    return c.json({ entries });
  });

  // ── Chat endpoints ─────────────────────────────────────────────────

  // SSE stream for real-time chat updates
  app.get('/api/chat/stream', (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial processing state
      const state = getIsProcessing();
      await stream.writeSSE({
        event: 'processing',
        data: JSON.stringify({ processing: state.processing, chatId: state.chatId }),
      });

      // Forward chat events to SSE client
      const handler = async (event: ChatEvent) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          // Client disconnected
        }
      };

      chatEvents.on('chat', handler);

      // Keepalive ping every 30s
      const pingInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: 'ping', data: '' });
        } catch {
          clearInterval(pingInterval);
        }
      }, 30_000);

      // Wait until the client disconnects
      try {
        await new Promise<void>((_, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
        });
      } catch {
        // Expected: client disconnected
      } finally {
        clearInterval(pingInterval);
        chatEvents.off('chat', handler);
      }
    });
  });

  // Chat history (paginated)
  app.get('/api/chat/history', (c) => {
    const chatId = c.req.query('chatId') || '';
    if (!chatId) return c.json({ error: 'chatId required' }, 400);
    const limit = parseInt(c.req.query('limit') || '40', 10);
    const beforeId = c.req.query('beforeId');
    const turns = getConversationPage(chatId, limit, beforeId ? parseInt(beforeId, 10) : undefined);
    return c.json({ turns });
  });

  // Send message from dashboard
  app.post('/api/chat/send', async (c) => {
    if (!botApi) return c.json({ error: 'Bot API not available' }, 503);
    const body = await c.req.json<{ message?: string }>();
    const message = body?.message?.trim();
    if (!message) return c.json({ error: 'message required' }, 400);

    // Fire-and-forget: response comes via SSE
    void processMessageFromDashboard(botApi, message);
    return c.json({ ok: true });
  });

  // Abort current processing
  app.post('/api/chat/abort', (c) => {
    const { chatId } = getIsProcessing();
    if (!chatId) return c.json({ ok: false, reason: 'not_processing' });
    const aborted = abortActiveQuery(chatId);
    return c.json({ ok: aborted });
  });

  // Runtime context snapshot
  app.get('/api/context', (c) => {
    const ctx = buildRuntimeContext();
    return c.json(renderContextForDashboard(ctx));
  });

  // Bind to localhost only. Use a reverse proxy or Cloudflare Tunnel for remote access.
  serve({ fetch: app.fetch, port: DASHBOARD_PORT, hostname: '127.0.0.1' }, () => {
    logger.info({ port: DASHBOARD_PORT, hostname: '127.0.0.1' }, 'Dashboard server running');
  });
}
