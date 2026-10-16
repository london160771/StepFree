import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Network } from './types.js';

const networkPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'network.json');

export function loadNetwork(): Network {
  return JSON.parse(readFileSync(networkPath, 'utf8')) as Network;
}
