// Busca híbrida: BM25 (lexical) + cosseno sobre vetores TF-IDF de trigramas
// (aproximação semântica tolerante a flexões), fundidos por Reciprocal Rank Fusion,
// com reforço por prioridade de caminho e diversidade por arquivo.

import { tokenizar, trigramas, fnv1a } from './texto.mjs';
import { DIMENSOES } from './indice.mjs';
import { casaGlob } from '../core/glob.mjs';

const K1 = 1.2;
const B = 0.75;
const K_RRF = 60;

/** Pré-calcula estatísticas do corpus (uma vez por carga do índice). */
export function prepararCorpus(trechos) {
  const df = new Map();
  const dfVetor = new Map();
  let somaComp = 0;
  for (const t of trechos) {
    somaComp += t.n || 1;
    for (const termo of Object.keys(t.tf)) df.set(termo, (df.get(termo) ?? 0) + 1);
    for (const [b] of t.v) dfVetor.set(b, (dfVetor.get(b) ?? 0) + 1);
  }
  const N = trechos.length || 1;
  const idfVetor = (b) => Math.log(1 + N / (1 + (dfVetor.get(b) ?? 0)));
  const normas = trechos.map((t) => {
    let s = 0;
    for (const [b, w] of t.v) s += (w * idfVetor(b)) ** 2;
    return Math.sqrt(s) || 1;
  });
  return { trechos, df, N, mediaComp: somaComp / N, idfVetor, normas };
}

function bm25(corpus, termosConsulta) {
  const pont = new Map();
  const unicos = [...new Set(termosConsulta)];
  corpus.trechos.forEach((t, idx) => {
    let s = 0;
    for (const q of unicos) {
      const f = t.tf[q];
      if (!f) continue;
      const n = corpus.df.get(q) ?? 0;
      const idf = Math.log(1 + (corpus.N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * (t.n || 1)) / corpus.mediaComp)));
    }
    if (s > 0) pont.set(idx, s);
  });
  return pont;
}

function cosseno(corpus, termosConsulta) {
  const q = new Map();
  for (const g of trigramas(termosConsulta)) {
    const b = fnv1a(g) % DIMENSOES;
    q.set(b, (q.get(b) ?? 0) + 1);
  }
  let normaQ = 0;
  const pesoQ = new Map();
  for (const [b, n] of q) {
    const w = (1 + Math.log(n)) * corpus.idfVetor(b);
    pesoQ.set(b, w);
    normaQ += w * w;
  }
  normaQ = Math.sqrt(normaQ) || 1;
  const pont = new Map();
  corpus.trechos.forEach((t, idx) => {
    let s = 0;
    for (const [b, w] of t.v) {
      const wq = pesoQ.get(b);
      if (wq) s += wq * w * corpus.idfVetor(b);
    }
    if (s > 0) pont.set(idx, s / (normaQ * corpus.normas[idx]));
  });
  return pont;
}

function ranquear(mapa) {
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]).map(([idx], pos) => [idx, pos + 1]);
}

function fatorPrioridade(caminho, prioridade) {
  let f = 1;
  for (const [glob, peso] of Object.entries(prioridade ?? {})) if (casaGlob(caminho, glob)) f = Math.max(f, peso);
  return f;
}

/**
 * Busca `consulta` no corpus preparado.
 * @returns {Array<{caminho, linhaInicio, linhaFim, titulo, texto, pontuacao, lexical, vetorial}>}
 */
export function buscar(corpus, consulta, { k = 8, porArquivo = 2, prioridade = {}, filtroCaminho } = {}) {
  const termos = tokenizar(consulta);
  if (termos.length === 0 || corpus.trechos.length === 0) return [];
  const lex = bm25(corpus, termos);
  const vet = cosseno(corpus, termos);
  const fusao = new Map();
  for (const [idx, pos] of ranquear(lex)) fusao.set(idx, (fusao.get(idx) ?? 0) + 1 / (K_RRF + pos));
  for (const [idx, pos] of ranquear(vet).slice(0, 400)) fusao.set(idx, (fusao.get(idx) ?? 0) + 1 / (K_RRF + pos));
  const candidatos = [...fusao.entries()]
    .map(([idx, s]) => {
      const t = corpus.trechos[idx];
      return { idx, t, s: s * fatorPrioridade(t.c, prioridade) };
    })
    .filter((c) => !filtroCaminho || casaGlob(c.t.c, filtroCaminho))
    .sort((a, b) => b.s - a.s);
  const contagem = new Map();
  const resultado = [];
  for (const c of candidatos) {
    const usados = contagem.get(c.t.c) ?? 0;
    if (usados >= porArquivo) continue;
    contagem.set(c.t.c, usados + 1);
    resultado.push({
      caminho: c.t.c,
      linhaInicio: c.t.i,
      linhaFim: c.t.f,
      titulo: c.t.t,
      texto: c.t.x,
      pontuacao: Number(c.s.toFixed(6)),
      lexical: Number((lex.get(c.idx) ?? 0).toFixed(4)),
      vetorial: Number((vet.get(c.idx) ?? 0).toFixed(4)),
    });
    if (resultado.length >= k) break;
  }
  return resultado;
}
