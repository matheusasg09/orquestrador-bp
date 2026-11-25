// Fragmentação de arquivos em trechos com limites naturais (títulos em Markdown,
// declarações em código) e teto de tokens, preservando números de linha para citação.

import { extname } from 'node:path';
import { estimarTokens } from './texto.mjs';

const INICIO_BLOCO_CODIGO = new RegExp(
  [
    '^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\b',
    '^\\s*(?:export\\s+)?(?:abstract\\s+)?class\\b',
    '^\\s*(?:export\\s+)?(?:interface|type|enum)\\b',
    '^\\s*(?:export\\s+)?const\\s+\\w+\\s*=\\s*(?:async\\s*)?(?:\\(|function)',
    '^\\s*(?:public|private|protected|internal|static|final|override|sealed|abstract)\\b.*[({]\\s*$',
    '^\\s*(?:def|class|async\\s+def)\\s+\\w+',
    '^\\s*func\\s+',
    '^\\s*(?:pub\\s+)?(?:fn|impl|struct|trait|mod)\\b',
    '^\\s*(?:CREATE|ALTER)\\s+(?:OR\\s+REPLACE\\s+)?(?:TABLE|VIEW|PROCEDURE|FUNCTION|INDEX|TRIGGER)\\b',
    '^\\s*@(?:Test|Override|Service|Component|Controller|RestController|Entity|Bean|Transactional)\\b',
    '^\\s*(?:describe|it|test)\\s*\\(',
  ].join('|'),
  'i',
);

const EXT_MARKDOWN = new Set(['.md', '.markdown', '.mdx', '.rst', '.txt', '.adoc']);

export function tipoArquivo(caminho) {
  const ext = extname(caminho).toLowerCase();
  if (EXT_MARKDOWN.has(ext)) return 'texto';
  return 'codigo';
}

function ehLimite(linha, tipo) {
  if (tipo === 'texto') return /^#{1,6}\s/.test(linha) || /^={3,}\s*$|^-{3,}\s*$/.test(linha);
  return INICIO_BLOCO_CODIGO.test(linha);
}

/**
 * Divide `conteudo` em trechos de até `maxTokens`. Cada trecho: { linhaInicio, linhaFim, texto, titulo }.
 * Linhas são 1-based e inclusivas.
 */
export function fragmentar(conteudo, caminho, { maxTokens = 380, sobreposicao = 2 } = {}) {
  const linhas = conteudo.replace(/\r\n?/g, '\n').split('\n');
  const tipo = tipoArquivo(caminho);
  const blocos = [];
  let atual = { inicio: 0, titulo: '' };
  for (let i = 0; i < linhas.length; i++) {
    if (i > atual.inicio && ehLimite(linhas[i], tipo)) {
      blocos.push({ inicio: atual.inicio, fim: i - 1, titulo: atual.titulo });
      atual = { inicio: i, titulo: linhas[i].trim().slice(0, 120) };
    } else if (i === 0 && ehLimite(linhas[0], tipo)) {
      atual.titulo = linhas[0].trim().slice(0, 120);
    }
  }
  blocos.push({ inicio: atual.inicio, fim: linhas.length - 1, titulo: atual.titulo });

  // Junta blocos pequenos vizinhos e divide blocos grandes em janelas com sobreposição.
  const trechos = [];
  let acumulado = null;
  const emitir = (inicio, fim, titulo) => {
    const texto = linhas.slice(inicio, fim + 1).join('\n');
    if (texto.trim().length === 0) return;
    trechos.push({ linhaInicio: inicio + 1, linhaFim: fim + 1, texto, titulo });
  };
  const fecharAcumulado = () => {
    if (acumulado) emitir(acumulado.inicio, acumulado.fim, acumulado.titulo);
    acumulado = null;
  };
  for (const b of blocos) {
    const texto = linhas.slice(b.inicio, b.fim + 1).join('\n');
    const custo = estimarTokens(texto);
    if (custo > maxTokens) {
      fecharAcumulado();
      let inicio = b.inicio;
      while (inicio <= b.fim) {
        let fim = inicio;
        let usado = 0;
        while (fim <= b.fim) {
          const c = estimarTokens(linhas[fim]) + 1;
          if (usado + c > maxTokens && fim > inicio) break;
          usado += c;
          fim++;
        }
        emitir(inicio, fim - 1, b.titulo);
        if (fim > b.fim) break;
        inicio = Math.max(inicio + 1, fim - sobreposicao);
      }
      continue;
    }
    if (acumulado && estimarTokens(linhas.slice(acumulado.inicio, b.fim + 1).join('\n')) <= maxTokens) {
      acumulado.fim = b.fim;
    } else {
      fecharAcumulado();
      acumulado = { inicio: b.inicio, fim: b.fim, titulo: b.titulo };
    }
  }
  fecharAcumulado();
  return trechos;
}
