// Leitura e escrita de JSON com limites de tamanho e proteção contra
// poluição de protótipo. Escritas são atômicas (arquivo temporário + rename).

import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BpErro, SAIDA } from './erros.mjs';

const CHAVES_PROIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);
export const LIMITE_JSON_PADRAO = 8 * 1024 * 1024;

function reviverSeguro(chave, valor) {
  if (CHAVES_PROIBIDAS.has(chave)) return undefined;
  return valor;
}

export function analisarJson(texto, origem = 'entrada') {
  if (typeof texto !== 'string') throw new BpErro(`JSON inválido em ${origem}: não é texto`, { codigo: SAIDA.CONFIG });
  const limpo = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto; // remove BOM
  try {
    return JSON.parse(limpo, reviverSeguro);
  } catch (e) {
    // A mensagem do Node inclui trecho do conteúdo, que pode ser segredo: só a posição é repassada.
    const posicao = String(e.message).match(/position (\d+)|line (\d+) column (\d+)/);
    throw new BpErro(`JSON inválido em ${origem}${posicao ? ` (${posicao[0]})` : ''}`, { codigo: SAIDA.CONFIG });
  }
}

export function lerJson(caminho, { limite = LIMITE_JSON_PADRAO, padrao } = {}) {
  if (!existsSync(caminho)) {
    if (padrao !== undefined) return padrao;
    throw new BpErro(`Arquivo não encontrado: ${caminho}`, { codigo: SAIDA.CONFIG });
  }
  const tamanho = statSync(caminho).size;
  if (tamanho > limite) throw new BpErro(`Arquivo excede ${limite} bytes: ${caminho}`, { codigo: SAIDA.CONFIG });
  return analisarJson(readFileSync(caminho, 'utf8'), caminho);
}

export function escreverAtomico(caminho, conteudo) {
  mkdirSync(dirname(caminho), { recursive: true });
  const temporario = `${caminho}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temporario, conteudo, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporario, caminho);
  } catch (e) {
    rmSync(temporario, { force: true });
    throw e;
  }
}

export function escreverJson(caminho, dados) {
  escreverAtomico(caminho, `${JSON.stringify(dados, null, 2)}\n`);
}

export async function lerEntradaPadrao({ limite = LIMITE_JSON_PADRAO } = {}) {
  if (process.stdin.isTTY) return '';
  const partes = [];
  let total = 0;
  for await (const parte of process.stdin) {
    total += parte.length;
    if (total > limite) throw new BpErro('Entrada padrão excede o limite permitido', { codigo: SAIDA.USO });
    partes.push(parte);
  }
  return Buffer.concat(partes).toString('utf8');
}
