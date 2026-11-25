// Catálogo de modelos do Kiro e política de uso da Brasilprev.
// Fonte: https://kiro.dev/docs/models e https://kiro.dev/docs/models/available-models
// (consultadas em 2026-11-25). Multiplicadores relativos ao Auto (1.0x).

import { join } from 'node:path';
import { lerJson } from '../core/json.mjs';
import { validar } from '../core/esquema.mjs';
import { erroConfig } from '../core/erros.mjs';

/** Catálogo de referência. `idConfirmado` indica ID visto na documentação oficial. */
export const CATALOGO = Object.freeze({
  'claude-opus-5.5': { fornecedor: 'anthropic', multiplicador: 2.0, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: 'EU' }, idConfirmado: true },
  'claude-sonnet-5.5': { fornecedor: 'anthropic', multiplicador: 1.3, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: 'EU' }, idConfirmado: true },
  'claude-haiku-5.5': { fornecedor: 'anthropic', multiplicador: 0.06, multiplicadorLongo: 0.3, faixaCurtaTokens: 100_000, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: 'EU' }, idConfirmado: false },
  'claude-haiku-4.5': { fornecedor: 'anthropic', multiplicador: 0.4, contexto: 200_000, status: 'Active', regiao: { US: 'US', EU: 'EU' }, idConfirmado: true },
  'claude-opus-5': { fornecedor: 'anthropic', multiplicador: 2.2, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: 'EU' }, idConfirmado: true },
  'claude-sonnet-5': { fornecedor: 'anthropic', multiplicador: 1.3, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: 'EU' }, idConfirmado: true },
  'claude-opus-4.8': { fornecedor: 'anthropic', multiplicador: 2.2, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: 'EU' }, idConfirmado: true },
  'claude-sonnet-4.6': { fornecedor: 'anthropic', multiplicador: 1.3, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: 'EU' }, idConfirmado: true },
  'gpt-5.6-sol': { fornecedor: 'openai', multiplicador: 4.4, multiplicadorLongo: 8.8, faixaCurtaTokens: 272_000, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: 'Global' }, idConfirmado: true },
  'gpt-5.6-terra': { fornecedor: 'openai', multiplicador: 2.2, multiplicadorLongo: 4.4, faixaCurtaTokens: 272_000, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: 'Global' }, idConfirmado: true },
  'gpt-5.6-luna': { fornecedor: 'openai', multiplicador: 0.6, multiplicadorLongo: 1.2, faixaCurtaTokens: 272_000, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: 'Global' }, idConfirmado: true },
  'claude-fable-5.1': { fornecedor: 'anthropic', multiplicador: 6.0, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: null }, retencao30Dias: true, idConfirmado: true },
  'claude-fable-5.2': { fornecedor: 'anthropic', multiplicador: 6.0, contexto: 1_000_000, status: 'Experimental', regiao: { US: 'US', EU: null }, excluido: true, retencao30Dias: true, idConfirmado: true },
  'kimi-k3': { fornecedor: 'moonshot', multiplicador: 2.4, contexto: 1_000_000, status: 'Active', regiao: { US: 'US', EU: null }, excluido: true, idConfirmado: false },
  'grok-4.7': { fornecedor: 'xai', multiplicador: 2.7, contexto: 500_000, status: 'Experimental', regiao: { US: 'US', EU: null }, excluido: true, idConfirmado: false },
  'qwen3-coder-next': { fornecedor: 'qwen', multiplicador: 0.05, contexto: 256_000, status: 'Experimental', regiao: { US: 'US', EU: 'EU' }, excluido: true, idConfirmado: true },
  'deepseek-3.2': { fornecedor: 'deepseek', multiplicador: 0.25, contexto: 128_000, status: 'Experimental', regiao: { US: 'US', EU: null }, excluido: true, idConfirmado: true },
  'minimax-m2.5': { fornecedor: 'minimax', multiplicador: 0.25, contexto: 200_000, status: 'Active', regiao: { US: 'US', EU: 'EU' }, idConfirmado: true },
  'glm-5': { fornecedor: 'zhipu', multiplicador: 0.5, contexto: 200_000, status: 'Active', regiao: { US: 'US', EU: null }, idConfirmado: true },
  auto: { fornecedor: 'kiro', multiplicador: 1.0, contexto: null, status: 'Active', regiao: { US: 'US', EU: 'Global' }, idConfirmado: true },
});

export const ESFORCOS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

/** Papéis do orquestrador. Cada agente Kiro do BP corresponde a um papel. */
export const PAPEIS = Object.freeze([
  'orquestrador', 'despachante', 'contexto', 'planejador', 'revisor-plano', 'executor', 'executor-critico', 'executor-rapido',
  'testador', 'revisor-codigo', 'revisor-seguranca', 'qa-navegador', 'validador',
]);

const ESQUEMA = {
  type: 'object',
  required: ['versao', 'politica', 'papeis'],
  properties: {
    versao: { type: 'integer', enum: [1] },
    politica: {
      type: 'object',
      required: ['perfil'],
      properties: {
        perfil: { type: 'string', enum: ['US', 'EU'] },
        permitirRoteamentoGlobal: { type: 'boolean' },
        permitirExcluidos: { type: 'boolean' },
        permitirExperimentais: { type: 'boolean' },
        permitirAuto: { type: 'boolean' },
        permitirRetencao30Dias: { type: 'boolean' },
        fornecedoresPermitidos: { type: 'array', items: { type: 'string' } },
        modelosConfirmados: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9.-]+$' } },
      },
    },
    papeis: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['modelo', 'esforco'],
        properties: {
          modelo: { type: 'string', pattern: '^[a-z0-9.-]+$' },
          esforco: { type: 'string', enum: ESFORCOS },
          escalonar: { type: 'object', properties: { modelo: { type: 'string' }, esforco: { type: 'string', enum: ESFORCOS } } },
          rebaixar: { type: 'object', properties: { modelo: { type: 'string' }, esforco: { type: 'string', enum: ESFORCOS } } },
        },
      },
    },
  },
};

export function carregarModelos(raiz) {
  const arquivo = join(raiz, '.bp', 'modelos.json');
  const dados = lerJson(arquivo);
  const erros = validar(ESQUEMA, dados);
  if (erros.length) throw erroConfig(`Política de modelos inválida em ${arquivo}`, erros);
  return dados;
}

/** Avalia se `id` é permitido pela política. Retorna lista de motivos de bloqueio (vazia = permitido). */
export function avaliarModelo(id, politica) {
  const motivos = [];
  const m = CATALOGO[id];
  if (!m) {
    if (!(politica.modelosConfirmados ?? []).includes(id)) motivos.push(`modelo desconhecido pelo catálogo do BP: ${id}`);
    return motivos;
  }
  if (id === 'auto' && !politica.permitirAuto) motivos.push('Auto pode rotear para modelos fora da lista aprovada e para roteamento Global');
  if (m.excluido && !politica.permitirExcluidos) motivos.push('Kiro Excluded Model: sem indenização de saída (AWS Service Terms 50.10)');
  if (m.status !== 'Active' && !politica.permitirExperimentais) motivos.push(`status ${m.status}: comportamento pode mudar sem aviso`);
  const regiao = m.regiao[politica.perfil];
  if (regiao === null || regiao === undefined) motivos.push(`indisponível no perfil ${politica.perfil}`);
  if (regiao === 'Global' && !politica.permitirRoteamentoGlobal) motivos.push(`no perfil ${politica.perfil} usa roteamento Global (processamento fora da geografia)`);
  if (m.retencao30Dias && !politica.permitirRetencao30Dias) motivos.push('todo o tráfego retido por até 30 dias para detecção de abuso');
  if (politica.fornecedoresPermitidos?.length && !politica.fornecedoresPermitidos.includes(m.fornecedor)) motivos.push(`fornecedor ${m.fornecedor} fora da lista permitida`);
  if (!m.idConfirmado && !(politica.modelosConfirmados ?? []).includes(id)) {
    motivos.push(`ID não confirmado na documentação; confirme com "kiro-cli chat --list-models --format json" e adicione a politica.modelosConfirmados`);
  }
  return motivos;
}

/** Valida todos os papéis; retorna { ok, problemas: [{papel, modelo, motivos}] }. */
export function validarPapeis(modelos) {
  const problemas = [];
  for (const papel of PAPEIS) {
    if (!modelos.papeis[papel]) problemas.push({ papel, modelo: null, motivos: ['papel sem modelo configurado'] });
  }
  for (const [papel, cfg] of Object.entries(modelos.papeis)) {
    for (const variante of [cfg, cfg.escalonar, cfg.rebaixar].filter(Boolean)) {
      if (!variante.modelo) continue;
      const motivos = avaliarModelo(variante.modelo, modelos.politica);
      if (motivos.length) problemas.push({ papel, modelo: variante.modelo, motivos });
    }
  }
  return { ok: problemas.length === 0, problemas };
}

/** Custo relativo estimado (em "créditos Auto") para um volume de tokens de entrada+saída. */
export function custoRelativo(id, tokens) {
  const m = CATALOGO[id];
  if (!m) return null;
  const mult = m.faixaCurtaTokens && tokens > m.faixaCurtaTokens ? m.multiplicadorLongo : m.multiplicador;
  return { multiplicador: mult, faixaLonga: Boolean(m.faixaCurtaTokens && tokens > m.faixaCurtaTokens), faixaCurtaTokens: m.faixaCurtaTokens ?? null };
}
