// Trilha de auditoria append-only com encadeamento de hash (SHA-256): cada evento
// inclui o hash do anterior, então remoção ou edição de eventos é detectável.
// Nenhum segredo ou dado pessoal é gravado em claro (redação obrigatória).

import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { comTrava } from '../core/trava.mjs';
import { assinar, assinaturaValida, arquivoChave } from '../core/integridade.mjs';
import { lerJson, escreverJson } from '../core/json.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { pastaEstado } from '../core/config.mjs';
import { redigir } from '../core/sensiveis.mjs';

const GENESIS = '0'.repeat(64);
const LIMITE_CAMPO = 2000;

export function arquivoAuditoria(raiz) {
  return pastaEstado(raiz, 'auditoria', 'eventos.jsonl');
}

function hash(texto) {
  return createHash('sha256').update(texto).digest('hex');
}

function higienizar(valor, profundidade = 0) {
  if (profundidade > 5) return '[profundo]';
  if (typeof valor === 'string') return redigir(valor.length > LIMITE_CAMPO ? `${valor.slice(0, LIMITE_CAMPO)}…` : valor);
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => higienizar(v, profundidade + 1));
  if (valor && typeof valor === 'object') {
    const saida = {};
    for (const [k, v] of Object.entries(valor).slice(0, 50)) {
      if (/senha|password|secret|token|chave|apikey|api_key|authorization|cookie/i.test(k)) saida[k] = '[omitido]';
      else saida[k] = higienizar(v, profundidade + 1);
    }
    return saida;
  }
  return valor;
}

function ultimoHash(arquivo) {
  if (!existsSync(arquivo)) return GENESIS;
  const tam = statSync(arquivo).size;
  if (tam === 0) return GENESIS;
  // Lê só o final do arquivo para achar a última linha.
  const buf = readFileSync(arquivo);
  const texto = buf.subarray(Math.max(0, buf.length - 65536)).toString('utf8').trimEnd();
  const ultima = texto.slice(texto.lastIndexOf('\n') + 1);
  try {
    return JSON.parse(ultima).hash ?? GENESIS;
  } catch {
    return GENESIS;
  }
}

/** Registra um evento. `tipo` curto (ex.: "gancho.pre-ferramenta.bloqueio"). */
export function registrarEvento(raiz, tipo, dados = {}) {
  const arquivo = arquivoAuditoria(raiz);
  return comTrava(arquivo, () => {
    const anterior = ultimoHash(arquivo);
    const evento = { id: randomUUID(), em: new Date().toISOString(), tipo, dados: higienizar(dados), anterior };
    evento.hash = hash(`${anterior}|${evento.id}|${evento.em}|${evento.tipo}|${JSON.stringify(evento.dados)}`);
    appendFileSync(arquivo, `${JSON.stringify(evento)}\n`, { encoding: 'utf8', mode: 0o600 });
    // Âncora fora do workspace, assinada: guarda quantos eventos existem e o último hash.
    const ancora = lerAncora(raiz);
    const anteriores = ancora.valida ? ancora.dados.eventos : contarLinhas(arquivo) - 1;
    escreverJson(arquivoAncora(raiz), assinar(raiz, { eventos: anteriores + 1, ultimo: evento.hash, adulterada: ancora.adulterada || false }, 'ancora-auditoria'));
    return evento;
  });
}

export function arquivoAncora(raiz) {
  return arquivoChave(raiz).replace(/\.chave$/, '.ancora.json');
}

function contarLinhas(arquivo) {
  if (!existsSync(arquivo)) return 0;
  return readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).length;
}

function lerAncora(raiz) {
  const arq = arquivoAncora(raiz);
  if (!existsSync(arq)) return { existe: false, valida: false, adulterada: false };
  try {
    const dados = lerJson(arq);
    if (assinaturaValida(raiz, dados, 'ancora-auditoria')) return { existe: true, valida: true, adulterada: dados.adulterada === true, dados };
  } catch {
    // ilegível
  }
  return { existe: true, valida: false, adulterada: true };
}

/** Verifica a cadeia inteira. Retorna { integro, eventos, primeiraFalha }. */
export function verificarAuditoria(raiz) {
  const arquivo = arquivoAuditoria(raiz);
  const ancora = lerAncora(raiz);
  if (ancora.existe && !ancora.valida) return { integro: false, eventos: 0, primeiraFalha: { linha: null, motivo: 'âncora externa adulterada' } };
  if (ancora.adulterada) return { integro: false, eventos: 0, primeiraFalha: { linha: null, motivo: 'âncora registrou adulteração anterior' } };
  if (!existsSync(arquivo)) {
    if (ancora.valida && ancora.dados.eventos > 0) return { integro: false, eventos: 0, primeiraFalha: { linha: null, motivo: `trilha apagada (a âncora registra ${ancora.dados.eventos} eventos)` } };
    return { integro: true, eventos: 0, primeiraFalha: null };
  }
  const linhas = readFileSync(arquivo, 'utf8').split('\n').filter(Boolean);
  if (ancora.valida && ancora.dados.eventos !== linhas.length) {
    return { integro: false, eventos: linhas.length, primeiraFalha: { linha: null, motivo: `trilha truncada ou acrescida fora do BP (âncora: ${ancora.dados.eventos} eventos; arquivo: ${linhas.length})` } };
  }
  if (!ancora.existe && linhas.length > 0) return { integro: false, eventos: linhas.length, primeiraFalha: { linha: null, motivo: 'âncora externa ausente (trilha sem como provar completude)' } };
  let anterior = GENESIS;
  for (let i = 0; i < linhas.length; i++) {
    let e;
    try {
      e = JSON.parse(linhas[i]);
    } catch {
      return { integro: false, eventos: linhas.length, primeiraFalha: { linha: i + 1, motivo: 'JSON inválido' } };
    }
    if (e.anterior !== anterior) return { integro: false, eventos: linhas.length, primeiraFalha: { linha: i + 1, motivo: 'encadeamento quebrado (evento removido ou reordenado)' } };
    const esperado = hash(`${e.anterior}|${e.id}|${e.em}|${e.tipo}|${JSON.stringify(e.dados)}`);
    if (esperado !== e.hash) return { integro: false, eventos: linhas.length, primeiraFalha: { linha: i + 1, motivo: 'hash não confere (evento alterado)' } };
    anterior = e.hash;
  }
  if (ancora.valida && ancora.dados.ultimo !== anterior) return { integro: false, eventos: linhas.length, primeiraFalha: { linha: linhas.length, motivo: 'último hash difere da âncora (trilha reescrita)' } };
  return { integro: true, eventos: linhas.length, primeiraFalha: null };
}
