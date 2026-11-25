// Índice RAG local: trechos com termos (BM25) e vetores esparsos com hashing de
// trigramas (similaridade de cosseno com TF-IDF). Incremental por hash de conteúdo.
// Segredos e dados pessoais são mascarados antes de entrar no índice.

import { readFileSync, existsSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fragmentar } from './fragmentar.mjs';
import { tokenizar, trigramas, fnv1a } from './texto.mjs';
import { varrer, ehBinario, tamanhoArquivo } from './varredura.mjs';
import { redigir } from '../core/sensiveis.mjs';
import { escreverAtomico, escreverJson, lerJson, analisarJson } from '../core/json.mjs';
import { pastaEstado } from '../core/config.mjs';

export const DIMENSOES = 1 << 18;
const MAX_ATRIBUTOS = 96;
const VERSAO_INDICE = 2;
const LIMITE_LINHA_JSONL = 512 * 1024;

export function caminhosIndice(raiz) {
  const base = pastaEstado(raiz, 'rag');
  return { base, manifesto: join(base, 'manifesto.json'), trechos: join(base, 'trechos.jsonl') };
}

function contar(lista) {
  const m = Object.create(null);
  for (const t of lista) m[t] = (m[t] ?? 0) + 1;
  return m;
}

/** Vetor esparso: buckets de trigramas com peso 1+log(tf), os mais fortes primeiro. */
export function vetorizar(termos) {
  const tf = new Map();
  for (const g of trigramas(termos)) {
    const b = fnv1a(g) % DIMENSOES;
    tf.set(b, (tf.get(b) ?? 0) + 1);
  }
  const pares = [...tf.entries()].map(([b, n]) => [b, Number((1 + Math.log(n)).toFixed(4))]);
  pares.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return pares.slice(0, MAX_ATRIBUTOS);
}

function hashConteudo(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 32);
}

async function lerTrechos(arquivo) {
  const trechos = [];
  if (!existsSync(arquivo)) return trechos;
  const leitor = createInterface({ input: createReadStream(arquivo, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const linha of leitor) {
    if (!linha) continue;
    if (linha.length > LIMITE_LINHA_JSONL) continue; // linha corrompida ou adulterada: ignora
    trechos.push(analisarJson(linha, arquivo));
  }
  return trechos;
}

export async function carregarIndice(raiz) {
  const c = caminhosIndice(raiz);
  if (!existsSync(c.manifesto)) return null;
  const manifesto = lerJson(c.manifesto);
  if (manifesto.versao !== VERSAO_INDICE) return null;
  const trechos = await lerTrechos(c.trechos);
  return { manifesto, trechos };
}

/**
 * Cria ou atualiza o índice. Retorna estatísticas.
 * Arquivos não alterados (mesmo hash) reaproveitam os trechos existentes.
 */
export async function indexar(raiz, config) {
  const cfg = config.rag;
  const anterior = await carregarIndice(raiz);
  const porArquivo = new Map();
  if (anterior) for (const t of anterior.trechos) {
    if (!porArquivo.has(t.c)) porArquivo.set(t.c, []);
    porArquivo.get(t.c).push(t);
  }
  const { arquivos, ignoradosSensiveis, limiteAtingido } = varrer(raiz, { incluir: cfg.incluir, excluir: cfg.excluir });
  const limiteBytes = cfg.tamanhoMaxArquivoKb * 1024;
  const manifesto = { versao: VERSAO_INDICE, atualizadoEm: new Date().toISOString(), arquivos: {}, totalTrechos: 0 };
  const saida = [];
  const est = { arquivos: 0, reaproveitados: 0, reindexados: 0, ignoradosGrandes: 0, ignoradosBinarios: 0, ignoradosSensiveis, limiteAtingido, trechos: 0 };
  let seq = 0;
  for (const rel of arquivos) {
    const abs = join(raiz, rel);
    const tamanho = tamanhoArquivo(abs);
    if (tamanho < 0) continue;
    if (tamanho > limiteBytes) {
      est.ignoradosGrandes++;
      continue;
    }
    let buffer;
    try {
      buffer = readFileSync(abs);
    } catch {
      continue;
    }
    if (ehBinario(buffer)) {
      est.ignoradosBinarios++;
      continue;
    }
    const hash = hashConteudo(buffer);
    const antigoMeta = anterior?.manifesto.arquivos[rel];
    let trechosArquivo;
    if (antigoMeta && antigoMeta.hash === hash && porArquivo.has(rel)) {
      trechosArquivo = porArquivo.get(rel);
      est.reaproveitados++;
    } else {
      const texto = redigir(buffer.toString('utf8'));
      trechosArquivo = fragmentar(texto, rel, { maxTokens: cfg.tokensPorTrecho, sobreposicao: cfg.sobreposicaoLinhas }).map((f) => {
        // O caminho e o título entram nos termos: buscas por nome de arquivo/símbolo funcionam.
        const termos = tokenizar(`${rel.replace(/[/.]/g, ' ')} ${f.titulo} ${f.texto}`);
        return { c: rel, i: f.linhaInicio, f: f.linhaFim, t: f.titulo, x: f.texto, n: termos.length, tf: contar(termos), v: vetorizar(termos) };
      });
      est.reindexados++;
    }
    const ids = [];
    for (const t of trechosArquivo) {
      t.id = seq++;
      ids.push(t.id);
      saida.push(t);
    }
    manifesto.arquivos[rel] = { hash, tamanho, trechos: ids.length };
    est.arquivos++;
  }
  manifesto.totalTrechos = saida.length;
  est.trechos = saida.length;
  const c = caminhosIndice(raiz);
  escreverAtomico(c.trechos, saida.map((t) => JSON.stringify(t)).join('\n') + (saida.length ? '\n' : ''));
  escreverJson(c.manifesto, manifesto);
  return est;
}
