import OpenAI from 'openai';
import { GLM_API_KEY, GLM_BASE_URL, GLM_MODEL } from '../src/config.js';

const SYSTEM_PROMPT = `You are a prediction-market probability estimator.

READ THE QUESTION LITERALLY. These qualifiers reverse meaning and are the #1 source of mispriced signals:
- "Next X" means the SUCCESSOR to the current X.
- "First X to Y" requires BOTH doing Y AND being first.
- "Before DATE" / "by DATE" is time-bounded.

Given a market question and context, return a JSON object:
{"probability": 0.0-1.0, "confidence": "low"|"medium"|"high", "reasoning": "1-3 sentences", "contrarian": "1-2 sentences"}
Output ONLY the JSON object. No prose, no markdown fences, no commentary.`;

const USER = `Question: Will Bitcoin reach $85k in April 2026?
Category: crypto
End date: 2026-04-30T23:59:00.000Z
Current Yes ask: $0.250
24h volume: $50000`;

async function probe(maxTokens: number) {
  console.log(`\n=== max_tokens=${maxTokens} ===`);
  const client = new OpenAI({ apiKey: GLM_API_KEY, baseURL: GLM_BASE_URL });
  const resp = await client.chat.completions.create({
    model: GLM_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: USER },
    ],
  });
  console.log('  finish_reason:', resp.choices[0]?.finish_reason);
  console.log('  content len:', resp.choices[0]?.message?.content?.length ?? 0);
  console.log('  content:', JSON.stringify(resp.choices[0]?.message?.content?.slice(0, 300)));
  const reasoning = (resp.choices[0]?.message as Record<string, unknown>)?.reasoning_content as string | undefined;
  console.log('  reasoning len:', reasoning?.length ?? 0);
  console.log('  usage:', JSON.stringify(resp.usage));
}

async function main() {
  for (const n of [400, 1500, 4000]) {
    await probe(n);
  }
}
main().catch(e => { console.error('ERR:', e); process.exit(1); });
