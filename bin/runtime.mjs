import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const runtimeDir = path.join(process.env.LITANVIL_DATA_DIR || path.join(root, 'data'), 'cli');
export const stateFile = path.join(runtimeDir, 'state.json');
export const lockFile = path.join(runtimeDir, 'lock.json');
export const logFile = path.join(root, 'logs', 'service.log');
export const webUrl = 'http://localhost:5173';
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
export async function readState() {
  try { return JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
export async function control(state, action = 'status') {
  if (!state || !Number.isInteger(state.controlPort)) return undefined;
  try {
    const r = await fetch(`http://127.0.0.1:${state.controlPort}/${action}`, {
      method: action === 'stop' ? 'POST' : 'GET',
      headers: {authorization: `Bearer ${state.token}`}, signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return undefined;
    const result = await r.json();
    return result.pid === state.pid && result.root === root && result.token === state.token ? result : undefined;
  } catch { return undefined; }
}
