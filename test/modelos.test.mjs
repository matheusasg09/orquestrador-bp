import './_ambiente.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { avaliarModelo, validarPapeis, custoRelativo, PAPEIS } from '../src/modelos/politica.mjs';
import { classificarTarefa, resolverModelo } from '../src/modelos/roteador.mjs';

const modelos = JSON.parse(readFileSync(new URL('../modelo/.bp/modelos.json', import.meta.url), 'utf8'));
const politica = modelos.politica;

test('política padrão do modelo é válida para todos os papéis', () => {
  const v = validarPapeis(modelos);
  assert.ok(v.ok, JSON.stringify(v.problemas));
  for (const p of PAPEIS) assert.ok(modelos.papeis[p], `papel ${p} configurado`);
});

test('política bloqueia Auto, excluídos, experimentais, Global e retenção estendida', () => {
  assert.ok(avaliarModelo('auto', politica).length > 0);
  assert.ok(avaliarModelo('kimi-k3', politica).some((m) => /Excluded/.test(m)));
  assert.ok(avaliarModelo('qwen3-coder-next', politica).some((m) => /Experimental/.test(m)));
  assert.ok(avaliarModelo('claude-fable-5.1', politica).some((m) => /30 dias/.test(m)));
  assert.ok(avaliarModelo('gpt-5.6-terra', { ...politica, perfil: 'EU', fornecedoresPermitidos: [] }).some((m) => /Global/.test(m)));
  assert.deepEqual(avaliarModelo('gpt-5.6-terra', { ...politica, perfil: 'US', fornecedoresPermitidos: [] }), []);
  assert.ok(avaliarModelo('gpt-5.6-terra', politica).some((m) => /fornecedor/.test(m)));
  assert.ok(avaliarModelo('claude-haiku-5.5', politica).some((m) => /não confirmado/.test(m)));
  assert.deepEqual(avaliarModelo('claude-haiku-5.5', { ...politica, modelosConfirmados: ['claude-haiku-5.5'] }), []);
  assert.ok(avaliarModelo('modelo-inventado', politica).length > 0);
});

test('custo relativo considera faixa de contexto longo', () => {
  assert.equal(custoRelativo('claude-haiku-5.5', 50_000).multiplicador, 0.06);
  assert.equal(custoRelativo('claude-haiku-5.5', 150_000).multiplicador, 0.3);
  assert.equal(custoRelativo('gpt-5.6-sol', 300_000).multiplicador, 8.8);
  assert.equal(custoRelativo('inexistente', 1), null);
});

test('roteador: risco alto vai para o executor crítico, mecânico para o rápido', () => {
  const alto = classificarTarefa({ descricao: 'Calcular imposto no resgate e validar saldo do participante' });
  assert.equal(alto.risco, 'alto');
  assert.equal(alto.papel, 'executor-critico');
  const caminho = classificarTarefa({ descricao: 'Ajustar listagem', arquivos: ['src/auth/Sessao.java'] });
  assert.equal(caminho.risco, 'alto');
  const baixo = classificarTarefa({ descricao: 'Renomear variável e corrigir typo no README', arquivos: ['README.md'] });
  assert.equal(baixo.risco, 'baixo');
  assert.equal(baixo.papel, 'executor-rapido');
  const medio = classificarTarefa({ descricao: 'Criar componente de tabela de planos na tela inicial' });
  assert.equal(medio.papel, 'executor');
  assert.equal(medio.natureza, 'frontend');
  assert.equal(classificarTarefa({ descricao: 'remover block de código antigo' }).risco, 'medio', '"lock" não casa dentro de "block"');
  const r = resolverModelo(modelos, 'executor-critico', 'alto');
  assert.equal(r.agente, 'bp-executor-critico');
  assert.equal(r.modelo, 'claude-opus-5.5');
});
