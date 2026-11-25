// Localiza um navegador Chromium já instalado (Chrome ou Edge). Nunca baixa navegador.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { localizarExecutavel } from '../core/processo.mjs';

function candidatosWindows() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  return [
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
}

function candidatosMac() {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
}

/** Retorna o caminho do navegador ou null. `configurado` tem prioridade e precisa existir. */
export function localizarNavegador(configurado) {
  if (configurado) return existsSync(configurado) ? configurado : null;
  if (process.env.BP_NAVEGADOR && existsSync(process.env.BP_NAVEGADOR)) return process.env.BP_NAVEGADOR;
  const lista = process.platform === 'win32' ? candidatosWindows() : process.platform === 'darwin' ? candidatosMac() : [];
  for (const c of lista) if (existsSync(c)) return c;
  for (const nome of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'msedge']) {
    const achado = localizarExecutavel(nome);
    if (achado) return achado;
  }
  return null;
}
