# Research: AgentMail Integration for Trading Agent

**Researched:** 2026-04-13 | **Operator trigger:** "Build in email capabilities using agent mail into our skill set."

## TL;DR

**AgentMail.to** is the clear fit. Y Combinator S25 grad, $6M seed (March 2026), 500+ B2C customers, 10M+ emails processed. Purpose-built for AI agents: each agent gets a real inbox with SPF/DKIM/DMARC preconfigured, two-way email (send + receive + parse + thread + label), and official TypeScript SDK. Free tier (3 inboxes, 3K emails/month, 3 GB) is enough for our entire testing phase; `$20/month` Developer tier handles production without thinking about it. Alternatives (Resend, Postmark, Mailjet) are send-focused and lack the agent-native inbox model.

## What Email Unlocks for a Trading Bot

1. **Rich daily/weekly reports** — Telegram is great for alerts, terrible for long-form. HTML email with tables, charts (embedded PNG), P&L breakdowns, position summaries is the right medium for Richard's morning review.
2. **Fallback alert channel** — Telegram 409/polling failures happen. Email as a redundant critical-alert channel means we don't go silent if grammy dies.
3. **Brokerage confirmation parsing** — Alpaca (regime-trader) sends trade confirmations by email. Parsing them is an independent audit trail separate from the API's own response — useful for reconciliation and fraud detection.
4. **Research newsletter ingestion** — subscribe the bot's inbox to Matt Levine, AQR Insights, Marc Rubinstein, Domer's Substack (all Tier-1 sources from `self-improvement-loops.md`). Auto-forward to NotebookLM. Makes Sprint 4 (research ingestion pipeline) much cleaner.
5. **2FA / verification codes** — if the bot ever needs to auth with a service that emails a one-time code, it can read it without human intervention.

## Technical Integration

```typescript
// src/email/agent-mail.ts (to be built)
import { AgentMailClient } from 'agentmail';

const client = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY! });

// one-time setup: create an inbox
const inbox = await client.inboxes.create({ username: 'claudeclaw-trading' });
// inbox.inboxId → 'claudeclaw-trading@agentmail.to' (or custom domain)

// send
await client.messages.send(inbox.inboxId, {
  to: 'richard@example.com',
  subject: 'Daily trading report — 2026-04-13',
  html: '<h1>P&L</h1>...'
});

// receive
const messages = await client.messages.list(inbox.inboxId);
```

## Cost Model

| Tier | Monthly | Inboxes | Emails | Storage | Fit |
|------|---------|---------|--------|---------|-----|
| Free | $0 | 3 | 3K | 3 GB | **Adequate for entire paper-trading phase** |
| Developer | $20 | 10 | 10K | 10 GB | Production, plenty of headroom |
| Startup | $200 | 150 | 150K | 150 GB | Not needed |

At current pace (1 daily report + ~2 alerts/day + occasional inbound), we'd use <200 emails/month. Free tier covers us for months.

## Alternatives Considered

| Service | Why not it |
|---------|-----------|
| **Resend** | Send-only + inbound via webhooks returning metadata. Agent would need an extra API call per received email to get body. Less agent-native. |
| **Postmark** | High deliverability, but designed around transactional templates for human-run products. Inbound works but not agent-shaped. |
| **Mailjet** | Marketing-focused. Receiving is weak. Not the right tool. |
| **Gmail API** | Technically possible but requires OAuth dance + Google Cloud project + ongoing consent maintenance. Brittle for an autonomous agent. |
| **Self-hosted SMTP** | Deliverability disaster without manual SPF/DKIM/DMARC + reputation building. Not worth the time sink. |

AgentMail's value prop — "just give my AI agent an inbox and make the plumbing invisible" — matches exactly what we need.

## What Richard Needs to Provide (single blocker)

1. **Sign up at https://agentmail.to** (free tier, no credit card needed to start).
2. **Generate an API key** in the AgentMail console.
3. **Drop it into `.env`** as `AGENTMAIL_API_KEY=...`.
4. **Tell me the destination email** where daily/weekly reports should go (your personal email). This becomes `OPERATOR_EMAIL` in `.env`.
5. **Optional:** custom domain. If you want `reports@bates-trading.com` instead of `claudeclaw-trading@agentmail.to`, AgentMail supports it on the Developer+ tier. Not needed for MVP.

Once those five things are in `.env`, I can build the integration autonomously.

## Recommended Build Sequence (new sprint when Richard green-lights)

**Sprint "Email-A" — Outbound first** (~3 hours):
- `src/email/agent-mail.ts` — thin client wrapper.
- `src/email/reports.ts` — compose HTML daily trading report (Brier calibration chart, open positions, P&L, any drift alarms).
- `src/email/alerts.ts` — send emergency alerts as fallback to Telegram.
- Config: `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID` (or create-on-first-run), `OPERATOR_EMAIL`, `EMAIL_DAILY_REPORT_HOUR`.
- Daily report cron piggybacks on existing 5-min interval (same pattern as digest + calibration).
- `/poly email-test` Telegram command to verify delivery.
- Tests for HTML composition + sender wrapper (mocked).

**Sprint "Email-B" — Inbound later** (~4 hours):
- Inbound webhook handler (AgentMail posts to us when a message arrives).
- Classifier: is this a brokerage confirmation, a newsletter, a reply from Richard, or spam?
- Per-class routing: brokerage → reconcile with paper_trades / regime-trader state; newsletter → forward to NotebookLM; reply-from-Richard → treat as an in-chat command; spam → quietly drop.
- This sprint requires a public-facing webhook URL, which means either ngrok for dev or deploying the dashboard to a VPS. Defer until outbound is proven.

## How This Changes Our Code/Strategy

1. Once Sprint Email-A ships, the daily report becomes the primary human-facing surface for trading performance. Telegram shifts to "real-time alerts only" (signal_filled, halt tripped, calibration alarm). Cleaner separation.
2. The research ingestion pipeline (EVOLUTION.md Sprint 4) becomes dramatically simpler: subscribe the bot's inbox to Tier-1 newsletters and auto-forward to NotebookLM. Much less fragile than RSS scraping.
3. Brokerage-confirmation parsing (Sprint Email-B inbound) gives us a parallel audit trail for equity trades — if regime-trader's state.json says we filled 100 SPY but the email says 50 SPY, something is wrong and we want to know immediately.

## Sources

- [AgentMail — Email Inbox API for AI Agents](https://www.agentmail.to)
- [AgentMail Documentation](https://docs.agentmail.to)
- [AgentMail Integrations / Skills](https://docs.agentmail.to/integrations/skills)
- [AgentMail Quickstart](https://docs.agentmail.to/quickstart)
- [AgentMail Pricing](https://www.agentmail.to/pricing)
- [AgentMail raises $6M to build email for AI agents (TechCrunch, 2026-03-10)](https://techcrunch.com/2026/03/10/agentmail-raises-6m-to-build-an-email-service-for-ai-agents/)
- [5 Best Email APIs for Developers Compared 2026 (AgentMail blog)](https://www.agentmail.to/blog/5-best-email-api-for-developers-compared-2026)
- [AgentMail Review 2026 (eesel AI)](https://www.eesel.ai/blog/agentmail-review)
- [Build an Email Agent with Google ADK and AgentMail](https://www.agentmail.to/blog/build-email-agent-google-adk-agentmail)
