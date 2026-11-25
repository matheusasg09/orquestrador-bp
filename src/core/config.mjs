// Configuração do Orquestrador BP (.bp/config.json) com padrões seguros.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { lerJson } from './json.mjs';
import { validar } from './esquema.mjs';
import { erroConfig } from './erros.mjs';

export const PASTA_BP = '.bp';
export const PASTA_ESTADO = join(PASTA_BP, 'estado');

export const PADROES = Object.freeze({
  versao: 1,
  projeto: { nome: 'projeto' },
  rag: {
    incluir: ['**/*'],
    excluir: [
      '.git/**', 'node_modules/**', '**/node_modules/**', 'dist/**', 'build/**', 'target/**', 'out/**', 'bin/Debug/**',
      'bin/Release/**', 'obj/**', '.next/**', 'coverage/**', '.venv/**', 'venv/**', '__pycache__/**', '.gradle/**',
      '.idea/**', '.vscode/**', '.bp/estado/**', '.bp/ferramenta/**', '*.min.js', '*.map', '*.lock', 'package-lock.json',
    ],
    tamanhoMaxArquivoKb: 512,
    tokensPorTrecho: 380,
    sobreposicaoLinhas: 2,
    prioridade: { 'docs/negocio/**': 1.6, '.kiro/specs/**': 1.4, '**/*.md': 1.1 },
  },
  testes: { comandos: [], tempoLimiteSeg: 900 },
  portoes: {
    bloquearSegredos: true,
    bloquearPii: true,
    maxArquivosAlterados: 60,
    maxLinhasAlteradas: 2500,
    ignorar: ['**/test/fixtures/**', '**/__fixtures__/**'],
  },
  navegador: {
    executavel: null,
    hostsPermitidos: ['localhost', '127.0.0.1', '[::1]'],
    semJanela: true,
    largura: 1366,
    altura: 768,
    tempoLimiteMs: 30000,
  },
  tokens: { orcamentoContexto: 4000, orcamentoGancho: 1200, orcamentoFalhas: 1500, orcamentoDiff: 12000 },
  ganchos: { maxContinuacoesParada: 3, contextoNoPrompt: true },
  aplicacao: { comando: [], url: null, tempoInicioSeg: 90, ambiente: {} },
});

const ESQUEMA = {
  type: 'object',
  properties: {
    versao: { type: 'integer', enum: [1] },
    projeto: { type: 'object', properties: { nome: { type: 'string', maxLength: 120 } } },
    rag: {
      type: 'object',
      properties: {
        incluir: { type: 'array', items: { type: 'string' } },
        excluir: { type: 'array', items: { type: 'string' } },
        tamanhoMaxArquivoKb: { type: 'integer', minimum: 1, maximum: 10240 },
        tokensPorTrecho: { type: 'integer', minimum: 64, maximum: 2000 },
        sobreposicaoLinhas: { type: 'integer', minimum: 0, maximum: 20 },
        prioridade: { type: 'object', additionalProperties: { type: 'number', minimum: 0.1, maximum: 5 } },
      },
    },
    testes: {
      type: 'object',
      properties: {
        comandos: { type: 'array', maxItems: 10, items: { type: 'array', minItems: 1, items: { type: 'string', maxLength: 400 } } },
        tempoLimiteSeg: { type: 'integer', minimum: 10, maximum: 7200 },
      },
    },
    portoes: {
      type: 'object',
      properties: {
        bloquearSegredos: { type: 'boolean' },
        bloquearPii: { type: 'boolean' },
        maxArquivosAlterados: { type: 'integer', minimum: 1 },
        maxLinhasAlteradas: { type: 'integer', minimum: 1 },
        ignorar: { type: 'array', items: { type: 'string' } },
      },
    },
    navegador: {
      type: 'object',
      properties: {
        executavel: { type: ['string', 'null'] },
        hostsPermitidos: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^[A-Za-z0-9.*\\[\\]:-]+$' } },
        semJanela: { type: 'boolean' },
        largura: { type: 'integer', minimum: 320, maximum: 3840 },
        altura: { type: 'integer', minimum: 240, maximum: 2160 },
        tempoLimiteMs: { type: 'integer', minimum: 1000, maximum: 300000 },
      },
    },
    tokens: {
      type: 'object',
      properties: {
        orcamentoContexto: { type: 'integer', minimum: 200, maximum: 60000 },
        orcamentoGancho: { type: 'integer', minimum: 100, maximum: 8000 },
        orcamentoFalhas: { type: 'integer', minimum: 200, maximum: 20000 },
        orcamentoDiff: { type: 'integer', minimum: 1000, maximum: 80000 },
      },
    },
    aplicacao: {
      type: 'object',
      properties: {
        comando: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } },
        url: { type: ['string', 'null'], maxLength: 500 },
        tempoInicioSeg: { type: 'integer', minimum: 5, maximum: 900 },
        ambiente: { type: 'object', additionalProperties: { type: 'string', maxLength: 500 } },
      },
    },
    ganchos: {
      type: 'object',
      properties: { maxContinuacoesParada: { type: 'integer', minimum: 0, maximum: 10 }, contextoNoPrompt: { type: 'boolean' } },
    },
  },
};

function mesclar(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra ?? base;
  const saida = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    saida[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? mesclar(base[k], v)
      : v;
  }
  return saida;
}

/** Encontra a raiz do projeto subindo a partir de `inicio` até achar .bp, .kiro ou .git. */
export function encontrarRaiz(inicio = process.cwd()) {
  if (process.env.BP_RAIZ) return resolve(process.env.BP_RAIZ);
  let atual = resolve(inicio);
  for (;;) {
    if (existsSync(join(atual, PASTA_BP, 'config.json')) || existsSync(join(atual, '.kiro')) || existsSync(join(atual, '.git'))) return atual;
    const pai = dirname(atual);
    if (pai === atual) return resolve(inicio);
    atual = pai;
  }
}

export function carregarConfig(raiz) {
  const arquivo = join(raiz, PASTA_BP, 'config.json');
  const usuario = lerJson(arquivo, { padrao: {} });
  const erros = validar(ESQUEMA, usuario);
  if (erros.length) throw erroConfig(`Configuração inválida em ${arquivo}`, erros);
  return Object.freeze(mesclar(PADROES, usuario));
}

export function pastaEstado(raiz, ...partes) {
  return join(raiz, PASTA_ESTADO, ...partes);
}
