import OpenAI from 'openai';
import { GLM_API_KEY, GLM_BASE_URL, GLM_MODEL } from '../src/config.js';

const client = new OpenAI({ apiKey: GLM_API_KEY, baseURL: GLM_BASE_URL });

async function tryParam(label: string, extra: Record<string, unknown>) {
  console.log(`\n=== ${label} ===`);
  try {
    const resp = await client.chat.completions.create({
      model: GLM_MODEL,
      max_tokens: 500,
      messages: [
        { role: 'system', content: 'Return only valid JSON.' },
        { role: 'user', content: 'Return {"test": true}. JSON only.' },
      ],
      ...extra,
    } as unknown as Parameters<typeof client.chat.completions.create>[0]);
    const choice = resp.choices[0];
    const msg = choice?.message as Record<string, unknown>;
    console.log(`  finish=${choice?.finish_reason} content_len=${(msg?.content as string)?.length ?? 0} reasoning_len=${(msg?.reasoning_content as string)?.length ?? 0}`);
    console.log(`  content: ${JSON.stringify((msg?.content as string)?.slice(0, 100))}`);
    console.log(`  usage:`, resp.usage);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    console.log(`  ERROR: status=${err.status} msg=${(err.message || '').slice(0, 150)}`);
  }
}

async function main() {
  await tryParam('baseline', {});
  await tryParam('thinking.type=disabled', { thinking: { type: 'disabled' } });
  await tryParam('thinking.type=enabled', { thinking: { type: 'enabled' } });
  await tryParam('enable_thinking=false', { enable_thinking: false });
  await tryParam('chat_mode=classic', { chat_mode: 'classic' });
  await tryParam('reasoning_effort=minimal', { reasoning_effort: 'minimal' });
  await tryParam('response_format=json_object', { response_format: { type: 'json_object' } });
}
main().catch(e => { console.error('TOP:', e); process.exit(1); });
