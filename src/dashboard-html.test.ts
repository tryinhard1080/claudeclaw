import { describe, expect, it } from 'vitest';

import { getDashboardHtml } from './dashboard-html.js';

describe('dashboard readiness rendering', () => {
  it('does not render malformed live-readiness payloads as passing gates', () => {
    const html = getDashboardHtml('token', 'chat');

    expect(html).toContain("payload.error");
    expect(html).toContain("payload.gates.length === 0");
    expect(html).toContain("Gate data unavailable");
    expect(html).toContain("Source freshness unavailable");
  });
});
