// Registro e consolidação determinística das revisões (código, segurança, QA).
// Os revisores (LLM) só produzem achados estruturados; o veredito é calculado por
// regra fixa, sem tokens e sem margem para "aprovar no texto e reprovar no JSON".

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pastaEstado } from '../core/config.mjs';
import { lerJson, escreverAtomico } from '../core/json.mjs';
import { escreverAssinado, lerAssinadoOuNulo, lerTestes, lerPortoes } from './assinado.mjs';
import { validar } from '../core/esquema.mjs';
import { redigir } from '../core/sensiveis.mjs';
import { erroConfig } from '../core/erros.mjs';
import { carregarExecucao, definirFase } from './execucao.mjs';
import { registrarEvento } from './auditoria.mjs';

export const SEVERIDADES_REVISAO = Object.freeze(['bloqueante', 'alta', 'media', 'baixa', 'sugestao']);
const REVISORES = ['codigo', 'seguranca', 'qa', 'validacao'];

const ESQUEMA = {
  type: 'object',
  required: ['revisor', 'achados'],
  properties: {
    revisor: { type: 'string', enum: REVISORES },
    resumo: { type: 'string', maxLength: 4000 },
    achados: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        required: ['severidade', 'titulo'],
        properties: {
          severidade: { type: 'string', enum: SEVERIDADES_REVISAO },
          categoria: { type: 'string', maxLength: 60 },
          titulo: { type: 'string', minLength: 3, maxLength: 300 },
          arquivo: { type: 'string', maxLength: 400 },
          linha: { type: 'integer', minimum: 0 },
          descricao: { type: 'string', maxLength: 4000 },
          recomendacao: { type: 'string', maxLength: 4000 },
          cenarioFalha: { type: 'string', maxLength: 2000 },
          referencia: { type: 'string', maxLength: 200 },
        },
      },
    },
  },
};

const pasta = (raiz) => pastaEstado(raiz, 'execucao', 'revisoes');

export function registrarRevisao(raiz, caminho) {
  const ex = carregarExecucao(raiz);
  const r = lerJson(caminho, { limite: 2 * 1024 * 1024 });
  const erros = validar(ESQUEMA, r);
  if (erros.length) throw erroConfig('Revisão inválida', erros);
  const rodada = ex.rodadaRevisao ?? 1;
  const limpa = {
    ...r,
    rodada,
    registradaEm: new Date().toISOString(),
    resumo: redigir(r.resumo ?? ''),
    achados: r.achados.map((a) => ({ ...a, descricao: redigir(a.descricao ?? ''), recomendacao: redigir(a.recomendacao ?? '') })),
  };
  escreverAssinado(raiz, join(pasta(raiz), `${r.revisor}.json`), limpa, `revisao:${ex.id}`);
  registrarEvento(raiz, 'revisao.registrada', { revisor: r.revisor, rodada, achados: r.achados.length });
  return limpa;
}

/**
 * Consolida: APROVADO somente se portões aprovados, testes verdes, nenhuma revisão com
 * achado bloqueante/alto e revisões obrigatórias presentes (código e segurança; QA quando há interface).
 */
export function consolidarRevisoes(raiz) {
  const ex = carregarExecucao(raiz);
  // Entradas só valem se gravadas e assinadas pelo BP (lança se adulteradas).
  const portoes = lerPortoes(raiz);
  const testes = lerTestes(raiz);
  const obrigatorias = ['codigo', 'seguranca', ...(ex.temInterface ? ['qa'] : [])];
  const revisoes = existsSync(pasta(raiz))
    ? readdirSync(pasta(raiz)).filter((f) => f.endsWith('.json') && f !== 'veredito.json').map((f) => ({ arquivo: f, dados: lerAssinadoOuNulo(raiz, join(pasta(raiz), f), `revisao:${ex.id}`) }))
    : [];
  const rodada = ex.rodadaRevisao ?? 1;
  const adulteradas = revisoes.filter((r) => !r.dados).map((r) => r.arquivo);
  const atuais = revisoes.map((r) => r.dados).filter((r) => r && r.rodada === rodada);
  const motivos = [];
  for (const o of obrigatorias) if (!atuais.some((r) => r.revisor === o)) motivos.push(`revisão "${o}" ausente na rodada ${rodada}`);
  for (const a of adulteradas) motivos.push(`revisão ${a} adulterada ou gravada fora do BP (ignorada)`);
  if (!portoes) motivos.push('portões não executados');
  else if (ex.baseGit && portoes.modo === 'diferenca' && portoes.base !== ex.baseGit) motivos.push(`portões executados contra a base ${portoes.base}, não contra a base da execução`);
  else if (!portoes.aprovado) motivos.push(`portões reprovados (${portoes.contagem.bloqueante} bloqueante(s))`);
  if (!testes || testes.semTestes) motivos.push('sem resultado de testes');
  else if (!testes.verde) motivos.push('testes vermelhos');
  const pendencias = [];
  for (const r of atuais) for (const a of r.achados) if (a.severidade === 'bloqueante' || a.severidade === 'alta') pendencias.push({ revisor: r.revisor, ...a });
  if (pendencias.length) motivos.push(`${pendencias.length} achado(s) bloqueante(s)/alto(s) das revisões`);
  const aprovado = motivos.length === 0;
  const veredito = { rodada, aprovado, veredito: aprovado ? 'APROVADO' : 'AJUSTES_NECESSARIOS', motivos, pendencias, geradoEm: new Date().toISOString() };
  escreverAssinado(raiz, join(pasta(raiz), 'veredito.json'), veredito, 'veredito');
  // Lista de correções para a próxima iteração (o executor lê só isto, não as revisões inteiras).
  const correcoes = [
    `# Correções da rodada ${rodada}`, '',
    ...(aprovado ? ['Nada a corrigir: VEREDITO APROVADO.'] : [
      ...motivos.map((m) => `- ${m}`), '',
      ...pendencias.map((p, i) => `${i + 1}. [${p.severidade}] (${p.revisor}) ${p.titulo}${p.arquivo ? ` em ${p.arquivo}${p.linha ? `:${p.linha}` : ''}` : ''}\n   ${p.recomendacao || p.descricao || ''}`.trimEnd()),
    ]),
  ].join('\n');
  escreverAtomico(pastaEstado(raiz, 'execucao', 'CORRECOES.md'), `${correcoes}\n`);
  definirFase(raiz, aprovado ? 'validacao' : 'correcao', { revisao: { aprovada: aprovado, rodada }, rodadaRevisao: aprovado ? rodada : rodada + 1 });
  registrarEvento(raiz, 'revisao.consolidada', { rodada, aprovado, motivos: motivos.length });
  return veredito;
}
