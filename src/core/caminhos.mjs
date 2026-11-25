// Resolução de caminhos confinada à raiz do projeto. Toda leitura ou escrita
// feita a partir de entrada externa (agente, hook, configuração) passa por aqui.
// Globs de política são sempre aplicados ao caminho CANÔNICO (links resolvidos,
// nomes curtos 8.3 expandidos), e formas ambíguas do Windows são recusadas.

import { resolve, relative, isAbsolute, sep, join, basename } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { BpErro, SAIDA } from './erros.mjs';

export function paraPosix(caminho) {
  return caminho.split(sep).join('/').replace(/\\/g, '/');
}

function realOuProprio(caminho) {
  try {
    return realpathSync.native(caminho);
  } catch {
    return caminho;
  }
}

/**
 * Formas que permitem apontar para um arquivo protegido com outro nome:
 * fluxos alternativos NTFS (arquivo::$DATA, arquivo:fluxo), nomes curtos 8.3 (KIRO~1),
 * componentes terminados em ponto ou espaço (o Windows os remove), prefixos de dispositivo.
 * Retorna o motivo ou null.
 */
export function formaSuspeita(caminho) {
  if (typeof caminho !== 'string' || caminho.length === 0) return 'caminho vazio';
  if (caminho.includes('\0')) return 'caractere nulo';
  if (/^(?:\\\\|\/\/)[?.]/.test(caminho)) return 'prefixo de dispositivo';
  const semUnidade = caminho.replace(/^[A-Za-z]:/, '');
  if (semUnidade.includes(':')) return 'fluxo alternativo NTFS (":")';
  const componentes = caminho.split(/[\\/]+/).filter(Boolean);
  for (const c of componentes) {
    if (/~\d/.test(c)) return 'nome curto 8.3 (~N)';
    if (c !== '.' && c !== '..' && /[. ]$/.test(c)) return 'componente terminado em ponto ou espaço';
    if (/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i.test(c)) return 'nome reservado do Windows';
  }
  return null;
}

/** Caminho canônico: resolve links e nomes curtos do maior prefixo existente. */
export function canonico(raiz, alvo) {
  const raizReal = realOuProprio(resolve(raiz));
  let existente = resolve(raizReal, alvo);
  const restante = [];
  while (!existsSync(existente)) {
    const pai = resolve(existente, '..');
    if (pai === existente) break;
    restante.unshift(basename(existente));
    existente = pai;
  }
  const base = realOuProprio(existente);
  return { raizReal, absoluto: restante.length ? join(base, ...restante) : base };
}

/** Verifica se `alvo` está dentro de `raiz` (após resolver links simbólicos existentes). */
export function estaDentro(raiz, alvo) {
  const { raizReal, absoluto } = canonico(raiz, alvo);
  const rel = relative(raizReal, absoluto);
  if (rel === '') return true;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Resolve `alvo` para uso seguro: recusa formas suspeitas e retorna
 * { absoluto, relativo (POSIX, canônico), dentro }.
 */
export function analisarCaminho(raiz, alvo) {
  const suspeita = formaSuspeita(alvo);
  if (suspeita) return { suspeita };
  const { raizReal, absoluto } = canonico(raiz, alvo);
  const rel = relative(raizReal, absoluto);
  const dentro = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  return { absoluto, relativo: dentro ? paraPosix(rel) : null, dentro, suspeita: null };
}

/** Resolve `alvo` relativo a `raiz` e falha se escapar dela ou tiver forma ambígua. */
export function resolverConfinado(raiz, alvo, rotulo = 'caminho') {
  if (typeof alvo !== 'string' || alvo.length === 0) throw new BpErro(`${rotulo} inválido`, { codigo: SAIDA.USO });
  const a = analisarCaminho(raiz, alvo);
  if (a.suspeita) throw new BpErro(`${rotulo} recusado (${a.suspeita}): ${alvo}`, { codigo: SAIDA.BLOQUEIO });
  if (!a.dentro) throw new BpErro(`${rotulo} fora da raiz do projeto: ${alvo}`, { codigo: SAIDA.BLOQUEIO });
  return a.absoluto;
}

export function relativoPosix(raiz, alvo) {
  return paraPosix(relative(resolve(raiz), resolve(alvo)));
}
