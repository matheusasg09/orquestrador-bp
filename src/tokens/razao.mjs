// Razão (ledger) de consumo estimado de tokens por ferramenta e sessão, alimentado
// pelos hooks PostToolUse/SubagentStop. Mostra onde o contexto está sendo gasto
// (ex.: leituras de arquivos enormes) para orientar a economia.

import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pastaEstado } from '../core/config.mjs';
import { estimarTokens } from '../rag/texto.mjs';

const arquivo = (raiz) => pastaEstado(raiz, 'tokens', 'razao.jsonl');

export function registrarConsumo(raiz, { sessao, ferramenta, entrada, saida, agente }) {
  const linha = {
    em: new Date().toISOString(),
    sessao: String(sessao ?? '').slice(0, 80),
    agente: agente ? String(agente).slice(0, 80) : undefined,
    ferramenta: String(ferramenta ?? '').slice(0, 80),
    tokensEntrada: estimarTokens(typeof entrada === 'string' ? entrada : JSON.stringify(entrada ?? '')),
    tokensSaida: estimarTokens(typeof saida === 'string' ? saida : JSON.stringify(saida ?? '')),
  };
  mkdirSync(dirname(arquivo(raiz)), { recursive: true });
  appendFileSync(arquivo(raiz), `${JSON.stringify(linha)}\n`, { mode: 0o600 });
  return linha;
}

export function relatorioConsumo(raiz) {
  if (!existsSync(arquivo(raiz))) return { total: 0, porFerramenta: [], maiores: [], recomendacoes: [] };
  const linhas = readFileSync(arquivo(raiz), 'utf8').split('\n').filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const por = new Map();
  let total = 0;
  for (const l of linhas) {
    const t = l.tokensEntrada + l.tokensSaida;
    total += t;
    const p = por.get(l.ferramenta) ?? { ferramenta: l.ferramenta, chamadas: 0, tokens: 0 };
    p.chamadas++;
    p.tokens += t;
    por.set(l.ferramenta, p);
  }
  const porFerramenta = [...por.values()].sort((a, b) => b.tokens - a.tokens);
  const maiores = [...linhas].sort((a, b) => b.tokensSaida - a.tokensSaida).slice(0, 10);
  const recomendacoes = [];
  const leitura = por.get('read_file');
  if (leitura && leitura.tokens / Math.max(1, total) > 0.4) recomendacoes.push('Leituras de arquivo dominam o consumo: use "rag contexto" com orçamento antes de abrir arquivos inteiros.');
  if (maiores[0]?.tokensSaida > 20000) recomendacoes.push(`Uma única saída de ${maiores[0].ferramenta} passou de 20 mil tokens: filtre a saída (grep, head) ou use os resumos do BP.`);
  const shell = [...por.values()].find((p) => /execute_(bash|pwsh)|shell/.test(p.ferramenta));
  if (shell && shell.tokens / Math.max(1, total) > 0.3) recomendacoes.push('Saídas de shell pesadas: rode testes por "node .bp/bp.mjs testes", que devolve só as falhas.');
  return { total, chamadas: linhas.length, porFerramenta, maiores, recomendacoes };
}
