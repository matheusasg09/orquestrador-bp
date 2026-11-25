// Trava de arquivo exclusiva entre processos (hooks e subagentes rodam em paralelo).
// Criação atômica com "wx"; trava órfã (processo morto) expira em 15 s.

import { openSync, closeSync, unlinkSync, statSync, mkdirSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const ESPERA_MAX_MS = 10000;
const ORFA_MS = 15000;

function dormir(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function comTrava(arquivo, fn) {
  const trava = `${arquivo}.lock`;
  mkdirSync(dirname(trava), { recursive: true });
  const fim = Date.now() + ESPERA_MAX_MS;
  let fd = null;
  while (fd === null) {
    try {
      fd = openSync(trava, 'wx', 0o600);
      writeSync(fd, String(process.pid));
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(trava).mtimeMs > ORFA_MS) unlinkSync(trava);
      } catch {
        // removida por outro processo
      }
      if (Date.now() > fim) throw new Error(`Não foi possível obter a trava de ${arquivo}`);
      dormir(20);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(trava);
    } catch {
      // já removida
    }
  }
}
