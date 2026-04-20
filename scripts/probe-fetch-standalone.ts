import { fetchActiveMarkets } from '../src/poly/gamma-client.js';

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('starting fetchActiveMarkets(500) ...');
  const markets = await fetchActiveMarkets(500);
  const ms = Date.now() - t0;
  console.log(`markets=${markets.length} ms=${ms}`);
}

void main();
