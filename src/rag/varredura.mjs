// Varredura de arquivos do projeto respeitando .gitignore, .kiroignore,
// exclusões da configuração e padrões de arquivos sensíveis (nunca indexados).

import { readdirSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { casaAlgum, criarIgnorador } from '../core/glob.mjs';
import { ehArquivoSensivel } from '../core/sensiveis.mjs';

const EXT_BINARIAS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svgz', '.pdf', '.zip', '.gz', '.tgz', '.7z', '.rar', '.jar',
  '.war', '.ear', '.class', '.dll', '.exe', '.so', '.dylib', '.o', '.a', '.lib', '.bin', '.dat', '.db', '.sqlite', '.mp3',
  '.mp4', '.mov', '.avi', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.psd', '.xlsx', '.xls', '.docx', '.doc', '.pptx',
  '.pyc', '.pdb', '.nupkg', '.snk', '.iso', '.img', '.wasm',
]);

function lerLinhas(caminho) {
  try {
    return readFileSync(caminho, 'utf8').split('\n');
  } catch {
    return [];
  }
}

export function ehBinario(buffer) {
  const n = Math.min(buffer.length, 8000);
  for (let i = 0; i < n; i++) if (buffer[i] === 0) return true;
  return false;
}

/**
 * Lista arquivos candidatos (caminhos POSIX relativos). Não segue links simbólicos.
 * @returns {{arquivos: string[], ignoradosSensiveis: number}}
 */
export function varrer(raiz, { incluir = ['**/*'], excluir = [], limiteArquivos = 50000 } = {}) {
  const ignorarGit = criarIgnorador(existsSync(join(raiz, '.gitignore')) ? lerLinhas(join(raiz, '.gitignore')) : []);
  const ignorarKiro = criarIgnorador(existsSync(join(raiz, '.kiroignore')) ? lerLinhas(join(raiz, '.kiroignore')) : []);
  const arquivos = [];
  let ignoradosSensiveis = 0;
  const pilha = [''];
  while (pilha.length) {
    const relDir = pilha.pop();
    let entradas;
    try {
      entradas = readdirSync(join(raiz, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === '.git' || casaAlgum(rel, excluir) || ignorarGit(rel) || ignorarKiro(rel)) continue;
        pilha.push(rel);
        continue;
      }
      if (!e.isFile()) continue;
      if (ehArquivoSensivel(rel, casaAlgum)) {
        ignoradosSensiveis++;
        continue;
      }
      if (casaAlgum(rel, excluir) || ignorarGit(rel) || ignorarKiro(rel) || !casaAlgum(rel, incluir)) continue;
      const ponto = e.name.lastIndexOf('.');
      if (ponto > 0 && EXT_BINARIAS.has(e.name.slice(ponto).toLowerCase())) continue;
      arquivos.push(rel);
      if (arquivos.length >= limiteArquivos) return { arquivos: arquivos.sort(), ignoradosSensiveis, limiteAtingido: true };
    }
  }
  return { arquivos: arquivos.sort(), ignoradosSensiveis, limiteAtingido: false };
}

export function tamanhoArquivo(caminho) {
  try {
    return lstatSync(caminho).size;
  } catch {
    return -1;
  }
}
