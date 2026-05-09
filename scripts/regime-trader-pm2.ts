#!/usr/bin/env tsx
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildRegimeTraderPm2Config } from './regime-trader-pm2-config.js';

const configDir = path.join(os.homedir(), '.claudeclaw');
const outputPath = path.join(configDir, 'regime-trader.pm2.json');

fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(buildRegimeTraderPm2Config(), null, 2)}\n`, 'utf8');

console.log(`Wrote ${outputPath}`);
console.log();
console.log('Run:');
console.log(`pm2 start ${outputPath}`);
console.log('pm2 save');
