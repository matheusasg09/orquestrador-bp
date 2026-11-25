import './_ambiente.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { instalar } from '../src/instalacao/instalar.mjs';
import { diagnosticar } from '../src/instalacao/doutor.mjs';
import { aplicarModelos, listarAgentes, validarAgente, validarWorkflow, listarWorkflows, validarHooks } from '../src/instalacao/kiro.mjs';
import { carregarModelos } from '../src/modelos/politica.mjs';
import { localizarNavegador } from '../src/navegador/localizar.mjs';

function instalado() {
  const raiz = mkdtempSync(join(tmpdir(), 'bp-inst-'));
  writeFileSync(join(raiz, 'package.json'), JSON.stringify({ name: 'alvo', scripts: { test: 'node --test' } }));
  instalar(raiz);
  return raiz;
}

const cli = (raiz, args, entrada) => spawnSync(process.execPath, [join(raiz, '.bp', 'bp.mjs'), ...args], { cwd: raiz, input: entrada, encoding: 'utf8', timeout: 120000, env: { ...process.env, BP_RAIZ: raiz } });

test('instalação copia modelo e ferramenta, protege .gitignore e não sobrescreve', () => {
  const raiz = instalado();
  try {
    for (const f of ['.kiro/agents/bp-orquestrador.json', '.kiro/hooks/bp-guardas.json', '.kiro/workflows/bp-entrega.workflow.json', '.kiro/steering/bp-essencial.md', '.kiro/skills/bp-seguranca-appsec/SKILL.md', '.kiro/settings/cli.json', '.kiro/settings/sandbox.json', '.kiroignore', '.bp/config.json', '.bp/modelos.json', '.bp/bp.mjs', '.bp/ferramenta/src/cli.mjs', '.bp/prompts/bp-executor.md']) {
      assert.ok(existsSync(join(raiz, f)), `existe ${f}`);
    }
    assert.ok(!existsSync(join(raiz, '.bp', 'ferramenta', 'test')), 'testes não vão para o alvo');
    assert.match(readFileSync(join(raiz, '.gitignore'), 'utf8'), /\.bp\/estado\//);
    assert.throws(() => instalar(raiz), /já existem/);
    const r = instalar(raiz, { forcar: true });
    assert.ok(r.substituidos.length > 0 && r.backup.startsWith('.bp/backup-'));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('configuração Kiro gerada é válida: agentes, hooks, workflows e política', async () => {
  const raiz = instalado();
  try {
    const modelos = carregarModelos(raiz);
    const agentes = listarAgentes(raiz);
    assert.equal(agentes.length, 13);
    for (const a of agentes) assert.deepEqual(validarAgente(raiz, a, modelos), [], a.nome);
    assert.deepEqual(validarHooks(raiz), []);
    const nomes = new Set(agentes.map((a) => a.nome));
    for (const w of listarWorkflows(raiz)) {
      const r = validarWorkflow(raiz, w, nomes);
      assert.deepEqual(r.problemas, [], r.nome);
    }
    assert.deepEqual(aplicarModelos(raiz, modelos), [], 'modelo já está alinhado com a política');
    const d = await diagnosticar(raiz, { consultarKiro: false });
    const erros = d.itens.filter((i) => i.nivel === 'erro');
    assert.deepEqual(erros, [], JSON.stringify(erros));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('aplicar modelos propaga mudança da política para agentes e workflows', () => {
  const raiz = instalado();
  try {
    const caminho = join(raiz, '.bp', 'modelos.json');
    const m = JSON.parse(readFileSync(caminho, 'utf8'));
    m.papeis['revisor-codigo'] = { modelo: 'claude-opus-5', esforco: 'max' };
    writeFileSync(caminho, JSON.stringify(m));
    const alt = aplicarModelos(raiz, carregarModelos(raiz));
    assert.ok(alt.some((a) => a.includes('bp-revisor-codigo')));
    assert.equal(JSON.parse(readFileSync(join(raiz, '.kiro', 'agents', 'bp-revisor-codigo.json'), 'utf8')).model, 'claude-opus-5');
    const wf = readFileSync(join(raiz, '.kiro', 'workflows', 'bp-entrega.workflow.json'), 'utf8');
    assert.match(wf, /"agent": "bp-revisor-codigo",\s+"modelId": "claude-opus-5",\s+"effortLevel": "max"/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('CLI instalada: ajuda, governança só por humano, hooks e fluxo de execução', () => {
  const raiz = instalado();
  try {
    assert.match(cli(raiz, ['ajuda']).stdout, /Orquestrador BP/);
    const init = cli(raiz, ['init', '--destino', '.']);
    assert.equal(init.status, 2, 'init fora de terminal interativo é bloqueado');
    assert.equal(cli(raiz, ['modelos', 'aplicar']).status, 2);
    const bloqueio = cli(raiz, ['gancho', 'pre-ferramenta'], JSON.stringify({ tool_name: 'execute_pwsh', tool_input: { command: 'git push origin main' }, cwd: raiz, session_id: 'x' }));
    assert.equal(bloqueio.status, 2);
    assert.match(bloqueio.stderr, /BP-GUARDA/);
    assert.equal(cli(raiz, ['gancho', 'pre-ferramenta'], JSON.stringify({ tool_name: 'execute_pwsh', tool_input: { command: 'npm test' }, cwd: raiz })).status, 0);
    assert.match(cli(raiz, ['rag', 'indexar']).stdout, /Índice RAG/);
    assert.match(cli(raiz, ['rag', 'buscar', 'revisão', 'segurança', 'financeira']).stdout, /bp-revisao-codigo-financeiro|bp-seguranca/);
    mkdirSync(join(raiz, '.bp', 'estado', 'entrada'), { recursive: true });
    writeFileSync(join(raiz, '.bp', 'estado', 'entrada', 'demanda.md'), 'Criar consulta de saldo do participante com mascaramento de CPF');
    assert.match(cli(raiz, ['exec', 'iniciar', '--demanda-arquivo', '.bp/estado/entrada/demanda.md']).stdout, /iniciada/);
    writeFileSync(join(raiz, '.bp', 'estado', 'entrada', 'plano.json'), JSON.stringify({ tarefas: [{ id: 'T1', titulo: 'Consulta de saldo com mascaramento de CPF', criterios: ['CPF exibido mascarado'], tipo: 'backend' }] }));
    const plano = cli(raiz, ['exec', 'plano']);
    assert.match(plano.stdout, /executor-critico/);
    assert.match(cli(raiz, ['exec', 'proxima']).stdout, /Delegar ao agente: bp-executor-critico/);
    const concluir = cli(raiz, ['exec', 'concluir', 'T1', '--evidencia', 'x']);
    assert.notEqual(concluir.status, 0, 'não conclui sem testes');
    const portoes = cli(raiz, ['portoes', '--tudo']);
    assert.match(portoes.stdout, /Portões:/);
    assert.match(cli(raiz, ['auditoria', 'verificar']).stdout, /íntegra/);
    assert.match(cli(raiz, ['modelos', 'rota', '--tarefa', 'corrigir texto do botão']).stdout, /executor/);
    const doutor = cli(raiz, ['doutor']);
    assert.match(doutor.stdout, /Agentes Kiro \(13\)/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

const exe = localizarNavegador();

test('sessão persistente do navegador pela CLI (IPC com token)', { skip: !exe && 'Chrome/Edge não encontrado', timeout: 180000 }, async () => {
  const raiz = instalado();
  const servidor = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Painel</title><h1>Meus planos</h1><button onclick="document.title=\'Clicado\'">Detalhar</button>');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${servidor.address().port}/`;
  const cliAsync = (args) => new Promise((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const p = spawn(process.execPath, [join(raiz, '.bp', 'bp.mjs'), ...args], { cwd: raiz, env: { ...process.env, BP_RAIZ: raiz } });
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { err += d; });
      p.on('close', (status) => resolve({ status, stdout: out, stderr: err }));
    });
  });
  try {
    const abrir = await cliAsync(['nav', 'abrir', url]);
    assert.equal(abrir.status, 0, abrir.stderr);
    assert.match(abrir.stdout, /## Meus planos/);
    const sessao = JSON.parse(readFileSync(join(raiz, '.bp', 'estado', 'navegador', 'sessao.json'), 'utf8'));
    assert.equal(sessao.token.length, 64);
    const id = abrir.stdout.match(/\[(\d+)\] button "Detalhar"/)[1];
    const clique = await cliAsync(['nav', 'clicar', id]);
    assert.match(clique.stdout, /\[ok\] clicar/, clique.stderr);
    assert.match((await cliAsync(['nav', 'estado'])).stdout, /\[estado\] Clicado/);
    assert.notEqual((await cliAsync(['nav', 'ir', 'https://exemplo.com/'])).status, 0, 'guarda vale na sessão persistente');
    assert.match((await cliAsync(['nav', 'fechar'])).stdout, /fechado/);
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok(!existsSync(join(raiz, '.bp', 'estado', 'navegador', 'sessao.json')));
  } finally {
    await cliAsync(['nav', 'fechar']);
    servidor.close();
    rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  void readdirSync;
});
