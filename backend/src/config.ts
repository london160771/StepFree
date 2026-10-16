import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Minimal .env loader so local development needs no extra dependency.
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  falkordbUrl: process.env.FALKORDB_URL || 'redis://127.0.0.1:6379',
  tflAppKey: process.env.TFL_APP_KEY || undefined,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};
