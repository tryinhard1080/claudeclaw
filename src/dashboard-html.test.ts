import { describe, expect, it } from 'vitest';

import { getDashboardHtml } from './dashboard-html.js';

describe('dashboard readiness rendering', () => {
  it('does not render malformed live-readiness payloads as passing gates', () => {
    const html = getDashboardHtml('token', 'chat');

    expect(html).toContain("payload.error");
    expect(html).toContain("payload.gates.length === 0");
    expect(html).toContain("!payload.gateAudit");
    expect(html).toContain("Gate data unavailable");
    expect(html).toContain("Gate audit unavailable");
    expect(html).toContain("Source freshness unavailable");
  });

  it('renders gate blocker details and progress values', () => {
    const html = getDashboardHtml('token', 'chat');

    expect(html).toContain("function renderGateBlocker");
    expect(html).toContain("g.detail");
    expect(html).toContain("g.current");
    expect(html).toContain("g.target");
    expect(html).toContain("meter-fill");
  });

  it('renders the live real-money gate audit', () => {
    const html = getDashboardHtml('token', 'chat');

    expect(html).toContain("Gate audit");
    expect(html).toContain("live-audit-summary");
    expect(html).toContain("live-audit-list");
    expect(html).toContain("function renderGateAudit");
    expect(html).toContain("operatorActionCount");
    expect(html).toContain("sampleOrTimeCount");
    expect(html).toContain("systemBlockerCount");
  });

  it('renders the readiness evidence resolution queue', () => {
    const html = getDashboardHtml('token', 'chat');

    expect(html).toContain("Resolution queue");
    expect(html).toContain("evidence-resolution-queue");
    expect(html).toContain("function renderResolutionQueue");
    expect(html).toContain("poly.resolutionQueue");
  });
});
