import OpenAI from 'openai';
import { GLM_API_KEY, GLM_BASE_URL, GLM_MODEL } from '../src/config.js';

async function probe(baseURL: string, model: string, label: string) {
  console.log(`\n=== ${label} ===`);
  console.log(`  ${baseURL}  [model=${model}]`);
  const client = new OpenAI({ apiKey: GLM_API_KEY, baseURL });
  try {
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 100,
      messages: [
        { role: 'system', content: 'Return only valid JSON.' },
        { role: 'user', content: 'Return {"ok": true}. JSON only.' },
      ],
    });
    console.log('  choices[0]:', JSON.stringify(resp.choices[0], null, 2));
    console.log('  usage:', JSON.stringify(resp.usage));
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; response?: { data?: unknown } };
    console.log(`  ERROR: status=${err.status} msg=${err.message}`);
  }
}

async function main() {
  // Current .env config
  await probe(GLM_BASE_URL, GLM_MODEL, 'Current env config');
  // Candidate combos
  await probe('https://api.z.ai/api/coding/paas/v4', 'claude-sonnet-4-5', 'Coding + claude-sonnet-4-5');
  await probe('https://api.z.ai/api/coding/paas/v4', 'glm-4.6', 'Coding + glm-4.6');
  await probe('https://api.z.ai/api/paas/v4', 'glm-4.6', 'Standard + glm-4.6');
  await probe('https://api.z.ai/api/paas/v4', 'glm-4.5-flash', 'Standard + glm-4.5-flash (free tier)');
}
main().catch(e => { console.error('TOP:', e); process.exit(1); });
