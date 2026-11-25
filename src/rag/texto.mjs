// Normalização, tokenização e estimativa de tokens para português, inglês e código.

const STOP = new Set(`
a o as os um uma uns umas de do da dos das em no na nos nas por para pra com sem sob sobre entre e ou
que se nao não mais menos muito pouco ja já ainda tambem também como quando onde qual quais quem cujo
este esta estes estas esse essa esses essas aquele aquela isso isto aquilo ser estar ter haver foi era
sao são ao aos à às pelo pela pelos pelas seu sua seus suas meu minha nosso nossa lhe lhes ele ela eles elas
the an and or of to in on at by for with without from is are was were be been being it its this that these
those as if then else when where which who whom what how not no yes do does did done can could should would
will shall may might must have has had i we you they he she them our your their
`.split(/\s+/).filter(Boolean));

/** Remove acentos e baixa a caixa. */
export function normalizar(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Radicalização leve PT/EN: reduz plurais e sufixos comuns sem dicionário. */
export function radical(t) {
  if (t.length <= 3 || /\d/.test(t)) return t;
  let r = t;
  const regras = [
    [/coes$/, 'cao'], [/soes$/, 'sao'], [/oes$/, 'ao'], [/aes$/, 'ao'], [/ais$/, 'al'], [/eis$/, 'el'],
    [/mente$/, ''], [/idades?$/, 'idade'], [/ies$/, 'y'], [/ing$/, ''], [/edly$/, ''], [/ed$/, ''],
    [/res$/, 'r'], [/zes$/, 'z'], [/ns$/, 'm'], [/s$/, ''],
  ];
  for (const [re, sub] of regras) {
    if (re.test(r) && r.replace(re, sub).length >= 3) {
      r = r.replace(re, sub);
      break;
    }
  }
  return r;
}

/** Divide identificadores: valorTotalContribuicao -> valor total contribuicao; snake_case e kebab-case também. */
export function dividirIdentificador(palavra) {
  return palavra
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.$]+/)
    .filter(Boolean);
}

/**
 * Tokeniza texto para BM25: palavras normalizadas, radicalizadas, sem stopwords.
 * Identificadores compostos geram as partes e também o identificador inteiro.
 */
export function tokenizar(texto) {
  const saida = [];
  const brutos = texto.match(/[\p{L}\p{N}_$]+(?:[.\-][\p{L}\p{N}_$]+)*/gu) ?? [];
  for (const bruto of brutos) {
    if (bruto.length > 80) continue;
    const partes = dividirIdentificador(bruto);
    if (partes.length > 1) {
      const inteiro = normalizar(bruto.replace(/[.\-$]/g, '_'));
      if (inteiro.length >= 3) saida.push(inteiro);
    }
    for (const p of partes) {
      const n = normalizar(p);
      if (n.length < 2 || STOP.has(n)) continue;
      saida.push(radical(n));
    }
  }
  return saida;
}

/** Trigramas de caracteres de cada termo, para similaridade aproximada (tolerante a variações). */
export function trigramas(termos) {
  const saida = [];
  for (const t of termos) {
    const s = `#${t}#`;
    if (s.length <= 3) {
      saida.push(s);
      continue;
    }
    for (let i = 0; i + 3 <= s.length; i++) saida.push(s.slice(i, i + 3));
  }
  return saida;
}

/**
 * Estimativa conservadora de tokens (o Kiro usa tokenizadores diferentes por modelo).
 * ~3,5 caracteres por token em código e ~3,8 em prosa; caracteres não ASCII pesam mais.
 */
export function estimarTokens(texto) {
  if (!texto) return 0;
  let ascii = 0;
  let outros = 0;
  for (let i = 0; i < texto.length; i++) {
    if (texto.charCodeAt(i) < 128) ascii++;
    else outros++;
  }
  const simbolos = (texto.match(/[{}()[\];,.=<>+\-*/&|!:"'`]/g) ?? []).length;
  const fator = simbolos / Math.max(1, texto.length) > 0.08 ? 3.3 : 3.8;
  return Math.ceil(ascii / fator + outros / 1.6);
}

/** Corta texto para caber em `orcamento` tokens, preservando linhas inteiras. */
export function cortarParaOrcamento(texto, orcamento) {
  if (estimarTokens(texto) <= orcamento) return { texto, cortado: false };
  const linhas = texto.split('\n');
  const saida = [];
  let usado = 0;
  for (const linha of linhas) {
    const custo = estimarTokens(linha) + 1;
    if (usado + custo > orcamento) break;
    saida.push(linha);
    usado += custo;
  }
  return { texto: `${saida.join('\n')}\n[... cortado para caber no orçamento de ${orcamento} tokens]`, cortado: true };
}

/** Hash FNV-1a 32 bits (determinístico, sem dependências) para hashing de atributos. */
export function fnv1a(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
