import './_ambiente.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarExecucao, importarPlano, proximaTarefa, concluirTarefa, falharTarefa, registrarValidacao, statusExecucao } from '../src/estado/execucao.mjs';
import { registrarRevisao, consolidarRevisoes } from '../src/estado/revisao.mjs';
import { registrarEvento, verificarAuditoria, arquivoAuditoria } from '../src/estado/auditoria.mjs';
import { gerarRelatorio } from '../src/instalacao/relatorio.mjs';
import { escreverAssinado, arquivoTestes, arquivoPortoes } from '../src/estado/assinado.mjs';

const modelos = JSON.parse(readFileSync(new URL('../modelo/.bp/modelos.json', import.meta.url), 'utf8'));

function novo() {
  const raiz = mkdtempSync(join(tmpdir(), 'bp-exec-'));
  mkdirSync(join(raiz, '.bp', 'estado', 'entrada'), { recursive: true });
  return raiz;
}
const entrada = (raiz, nome, dados) => {
  const p = join(raiz, '.bp', 'estado', 'entrada', nome);
  writeFileSync(p, JSON.stringify(dados));
  return p;
};
const gravarTestes = (raiz, verde, geradoEm = new Date(Date.now() + 1000).toISOString()) => escreverAssinado(raiz, arquivoTestes(raiz), { verde, geradoEm, comandos: [] }, 'testes');
const gravarPortoes = (raiz, aprovado = true) => escreverAssinado(raiz, arquivoPortoes(raiz), { aprovado, modo: 'completo', base: null, contagem: { bloqueante: aprovado ? 0 : 1 }, achados: [] }, 'portoes');

const PLANO = {
  resumo: 'Resgate parcial',
  premissas: ['Arredondamento HALF_EVEN'],
  temInterface: false,
  tarefas: [
    { id: 'T1', titulo: 'Calcular imposto regressivo no resgate', tipo: 'backend', criterios: ['C1'], arquivos: ['src/resgate/Calculo.java'] },
    { id: 'T2', titulo: 'Renomear variável no README', tipo: 'mecanica', criterios: ['C2'], depende: ['T1'] },
    { id: 'T3', titulo: 'Tela de confirmação de resgate', tipo: 'frontend', criterios: ['C3'], depende: ['T2'] },
  ],
};

test('ciclo completo: plano, roteamento, dependências, testes e conclusão', () => {
  const raiz = novo();
  try {
    const { execucao } = iniciarExecucao(raiz, { demanda: 'Permitir resgate parcial com cálculo de IR', regras: 'Regime regressivo', layout: 'Tela com valor e botão Confirmar' });
    assert.ok(existsSync(join(raiz, '.bp', 'estado', 'execucao', 'DEMANDA.md')));
    const { execucao: ex } = importarPlano(raiz, modelos, entrada(raiz, 'plano.json', PLANO));
    assert.equal(ex.tarefas[0].rota.agente, 'bp-executor-critico', 'imposto e resgate são risco alto');
    assert.equal(ex.tarefas[1].rota.agente, 'bp-executor-rapido');
    const p1 = proximaTarefa(raiz);
    assert.equal(p1.tarefa.id, 'T1');
    assert.equal(proximaTarefa(raiz).retomada, true, 'tarefa em andamento é retomada, não pulada');
    assert.throws(() => concluirTarefa(raiz, 'T1', { evidencia: 'x' }), /Sem resultado de testes/);
    gravarTestes(raiz, false);
    assert.throws(() => concluirTarefa(raiz, 'T1', { evidencia: 'x' }), /vermelhos/);
    gravarTestes(raiz, true, '2000-01-01T00:00:00Z');
    assert.throws(() => concluirTarefa(raiz, 'T1', { evidencia: 'x' }), /anterior/);
    writeFileSync(arquivoTestes(raiz), JSON.stringify({ verde: true, geradoEm: new Date(Date.now() + 5000).toISOString(), comandos: [] }));
    assert.throws(() => concluirTarefa(raiz, 'T1', { evidencia: 'x' }), /adulterado/, 'resultado forjado sem assinatura é recusado');
    gravarTestes(raiz, true);
    concluirTarefa(raiz, 'T1', { evidencia: 'teste CalculoTest' });
    assert.equal(proximaTarefa(raiz).tarefa.id, 'T2');
    assert.throws(() => concluirTarefa(raiz, 'T2', { evidencia: 'ok', semTestesJustificativa: 'Somente documentação, sem código executável.' }), /só é aceito em tarefa de documentação/);
    gravarTestes(raiz, true);
    concluirTarefa(raiz, 'T2', { evidencia: 'ok' });
    assert.equal(proximaTarefa(raiz).tarefa.id, 'T3');
    gravarTestes(raiz, true);
    concluirTarefa(raiz, 'T3', { evidencia: 'ok' });
    const s = statusExecucao(raiz);
    assert.equal(s.status.complete, true);
    assert.equal(proximaTarefa(raiz).tarefa, null);
    assert.ok(execucao.id);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('falhas: devolve à fila e bloqueia após 3 tentativas, propagando a dependentes', () => {
  const raiz = novo();
  try {
    iniciarExecucao(raiz, { demanda: 'Demanda de teste de falhas' });
    importarPlano(raiz, modelos, entrada(raiz, 'plano.json', PLANO));
    for (let i = 0; i < 3; i++) {
      assert.equal(proximaTarefa(raiz).tarefa.id, 'T1');
      falharTarefa(raiz, 'T1', `erro ${i}`);
    }
    const r = proximaTarefa(raiz);
    assert.equal(r.tarefa, null);
    const s = statusExecucao(raiz);
    assert.equal(s.status.bloqueadas, 3, 'T2 e T3 dependem da bloqueada');
    assert.equal(s.status.complete, true, 'execução não fica presa em laço');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('plano inválido é recusado: duplicado, dependência inexistente e ciclo', () => {
  const raiz = novo();
  try {
    iniciarExecucao(raiz, { demanda: 'Demanda para validar o plano' });
    assert.throws(() => importarPlano(raiz, modelos, entrada(raiz, 'p1.json', { tarefas: [{ id: 'A', titulo: 'aaa', criterios: ['c'] }, { id: 'A', titulo: 'bbb', criterios: ['c'] }] })), /duplicado/);
    assert.throws(() => importarPlano(raiz, modelos, entrada(raiz, 'p2.json', { tarefas: [{ id: 'A', titulo: 'aaa', criterios: ['c'], depende: ['Z'] }] })), /não existe/);
    assert.throws(() => importarPlano(raiz, modelos, entrada(raiz, 'p3.json', { tarefas: [{ id: 'A', titulo: 'aaa', criterios: ['c'], depende: ['B'] }, { id: 'B', titulo: 'bbb', criterios: ['c'], depende: ['A'] }] })), /circular/);
    assert.throws(() => importarPlano(raiz, modelos, entrada(raiz, 'p4.json', { tarefas: [{ id: 'A', titulo: 'aaa' }] })), /Plano inválido/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('revisões: veredito determinístico e lista de correções', () => {
  const raiz = novo();
  try {
    iniciarExecucao(raiz, { demanda: 'Demanda para revisão determinística' });
    importarPlano(raiz, modelos, entrada(raiz, 'plano.json', { tarefas: [{ id: 'T1', titulo: 'Tarefa de revisão', criterios: ['c'] }] }));
    gravarPortoes(raiz, true);
    gravarTestes(raiz, true);
    let v = consolidarRevisoes(raiz);
    assert.equal(v.aprovado, false);
    assert.ok(v.motivos.some((m) => m.includes('"codigo" ausente')));
    registrarRevisao(raiz, entrada(raiz, 'rc.json', { revisor: 'codigo', achados: [{ severidade: 'alta', titulo: 'Arredondamento no lugar errado', arquivo: 'src/a.java', linha: 10, recomendacao: 'Arredonde no total' }] }));
    registrarRevisao(raiz, entrada(raiz, 'rs.json', { revisor: 'seguranca', achados: [{ severidade: 'baixa', titulo: 'Cabeçalho ausente' }] }));
    v = consolidarRevisoes(raiz);
    assert.equal(v.veredito, 'AJUSTES_NECESSARIOS');
    assert.equal(v.pendencias.length, 1);
    const correcoes = readFileSync(join(raiz, '.bp', 'estado', 'execucao', 'CORRECOES.md'), 'utf8');
    assert.match(correcoes, /Arredondamento no lugar errado/);
    registrarRevisao(raiz, entrada(raiz, 'rc2.json', { revisor: 'codigo', achados: [] }));
    registrarRevisao(raiz, entrada(raiz, 'rs2.json', { revisor: 'seguranca', achados: [] }));
    gravarTestes(raiz, false);
    v = consolidarRevisoes(raiz);
    gravarTestes(raiz, true);
    assert.equal(v.aprovado, false, 'testes vermelhos impedem aprovação');
    v = consolidarRevisoes(raiz);
    assert.equal(v.aprovado, false, 'revisões da rodada anterior não valem na nova rodada');
    registrarRevisao(raiz, entrada(raiz, 'rc3.json', { revisor: 'codigo', achados: [] }));
    registrarRevisao(raiz, entrada(raiz, 'rs3.json', { revisor: 'seguranca', achados: [{ severidade: 'media', titulo: 'Endurecer CSP' }] }));
    v = consolidarRevisoes(raiz);
    assert.equal(v.aprovado, true, JSON.stringify(v.motivos));
    assert.equal(statusExecucao(raiz).status.revisaoAprovada, true);
    assert.throws(() => registrarRevisao(raiz, entrada(raiz, 'ruim.json', { revisor: 'outro', achados: [] })), /inválida/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('validação final exige evidência para cada critério e relatório reflete o estado', () => {
  const raiz = novo();
  try {
    iniciarExecucao(raiz, { demanda: 'Demanda para validação final' });
    importarPlano(raiz, modelos, entrada(raiz, 'plano.json', { tarefas: [{ id: 'T1', titulo: 'Tarefa validada', criterios: ['C1', 'C2'] }] }));
    proximaTarefa(raiz);
    gravarTestes(raiz, true);
    concluirTarefa(raiz, 'T1', { evidencia: 'ok' });
    let r = registrarValidacao(raiz, entrada(raiz, 'v1.json', { criterios: [{ tarefa: 'T1', criterio: 'C1', atendido: true, evidencia: 'teste x' }] }));
    assert.equal(r.validacao.aprovada, false);
    assert.equal(r.validacao.semEvidencia.length, 1);
    r = registrarValidacao(raiz, entrada(raiz, 'v2.json', { criterios: [{ tarefa: 'T1', criterio: 'C1', atendido: true, evidencia: 'teste x' }, { tarefa: 'T1', criterio: 'C2', atendido: true, evidencia: 'teste y' }] }));
    assert.equal(r.validacao.aprovada, true);
    const rel = gerarRelatorio(raiz);
    assert.equal(rel.pronto, false, 'sem portões e revisões ainda não está pronto');
    assert.match(rel.markdown, /Validação dos critérios de aceite: todos atendidos/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('nova execução arquiva a anterior sem apagar', () => {
  const raiz = novo();
  try {
    const a = iniciarExecucao(raiz, { demanda: 'Primeira demanda de arquivo' }).execucao.id;
    iniciarExecucao(raiz, { demanda: 'Segunda demanda de arquivo' });
    const pastas = readdirSync(join(raiz, '.bp', 'estado'));
    assert.ok(pastas.some((p) => p.startsWith('execucao-') && p.includes(a)));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('trilha de auditoria detecta alteração e remoção', () => {
  const raiz = novo();
  try {
    for (let i = 0; i < 5; i++) registrarEvento(raiz, 'teste', { i, senha: 'nao-gravar', texto: 'cpf 000.000.001-91' });
    assert.deepEqual(verificarAuditoria(raiz), { integro: true, eventos: 5, primeiraFalha: null });
    const arq = arquivoAuditoria(raiz);
    const bruto = readFileSync(arq, 'utf8');
    assert.ok(!bruto.includes('nao-gravar') && !bruto.includes('000.000.001-91'), 'segredo e PII nunca gravados');
    const linhas = bruto.trim().split('\n');
    writeFileSync(arq, `${[linhas[0], ...linhas.slice(2)].join('\n')}\n`);
    assert.equal(verificarAuditoria(raiz).integro, false);
    writeFileSync(arq, `${linhas.map((l, i) => (i === 3 ? l.replace('"i":3', '"i":9') : l)).join('\n')}\n`);
    assert.match(verificarAuditoria(raiz).primeiraFalha.motivo, /alterado/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
