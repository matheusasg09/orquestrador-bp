// Integração: simula pela CLI instalada o ciclo que os agentes do Kiro executam no
// workflow bp-entrega (sem o Kiro), com suíte real de testes via npm.
import './_ambiente.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { instalar } from '../src/instalacao/instalar.mjs';
import { localizarExecutavel } from '../src/core/processo.mjs';

const temNpm = Boolean(localizarExecutavel('npm'));
const temGit = Boolean(localizarExecutavel('git'));

test('ciclo completo pela CLI: demanda, plano, TDD, portões, revisões, validação e relatório', { skip: (!temNpm || !temGit) && 'npm ou git ausente', timeout: 300000 }, () => {
  const raiz = mkdtempSync(join(tmpdir(), 'bp-fluxo-'));
  const bp = (...args) => spawnSync(process.execPath, [join(raiz, '.bp', 'bp.mjs'), ...args], { cwd: raiz, encoding: 'utf8', timeout: 180000, env: { ...process.env, BP_RAIZ: raiz } });
  const git = (...args) => spawnSync('git', args, { cwd: raiz, encoding: 'utf8' });
  const entrada = (nome, dados) => writeFileSync(join(raiz, '.bp', 'estado', 'entrada', nome), typeof dados === 'string' ? dados : JSON.stringify(dados));
  try {
    writeFileSync(join(raiz, 'package.json'), JSON.stringify({ name: 'alvo', private: true, type: 'module', scripts: { test: 'node --test' } }));
    mkdirSync(join(raiz, 'src'));
    writeFileSync(join(raiz, 'src', 'resgate.js'), 'export function valorMinimo() { return 10000n; }\n');
    git('init', '-q');
    git('config', 'user.email', 'teste@exemplo.invalid');
    git('config', 'user.name', 'teste');
    instalar(raiz);
    git('add', '.');
    git('commit', '-qm', 'base');

    // Etapa preparar (bp-contexto)
    mkdirSync(join(raiz, '.bp', 'estado', 'entrada'), { recursive: true });
    entrada('demanda.md', 'Calcular o valor líquido do resgate parcial descontando o imposto regressivo.');
    entrada('regras.md', 'Alíquota de 10% após 10 anos; valores em centavos; arredondamento HALF_EVEN.');
    entrada('layout.md', 'não informado');
    entrada('destino.md', 'src/');
    assert.match(bp('exec', 'iniciar', '--demanda-arquivo', '.bp/estado/entrada/demanda.md', '--regras-arquivo', '.bp/estado/entrada/regras.md', '--layout-arquivo', '.bp/estado/entrada/layout.md', '--destino-arquivo', '.bp/estado/entrada/destino.md').stdout, /base Git/);
    assert.match(bp('rag', 'indexar').stdout, /Índice RAG/);
    assert.match(bp('rag', 'contexto', 'valor mínimo resgate', '--orcamento', '1500', '--saida', 'contexto.md').stdout, /salvo em \.bp\/estado\/entrada\/contexto\.md/);

    // Etapa planejar (bp-planejador)
    entrada('plano.json', {
      resumo: 'Cálculo do valor líquido do resgate',
      premissas: ['Prazo de acumulação informado em anos inteiros'],
      temInterface: false,
      tarefas: [{ id: 'T1', titulo: 'Calcular imposto regressivo e valor líquido do resgate', tipo: 'backend', arquivos: ['src/resgate.js', 'test/resgate.test.js'], criterios: ['QUANDO o prazo for maior que 10 anos, o sistema DEVE aplicar 10% de IR sobre o valor bruto em centavos.'], testes: ['deve_aplicar_10_por_cento_apos_10_anos'] }],
    });
    const plano = bp('exec', 'plano');
    assert.match(plano.stdout, /T1 \[alto\].*executor-critico/, plano.stdout + plano.stderr);

    // Etapa executar-tarefa (bp-despachante + bp-executor-critico com TDD)
    assert.match(bp('exec', 'proxima').stdout, /Delegar ao agente: bp-executor-critico/);
    mkdirSync(join(raiz, 'test'));
    writeFileSync(join(raiz, 'test', 'resgate.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { valorLiquido } from '../src/resgate.js';\ntest('deve_aplicar_10_por_cento_apos_10_anos', () => { assert.equal(valorLiquido(100000n, 11), 90000n); });\n");
    const vermelho = bp('testes');
    assert.equal(vermelho.status, 1, 'teste escrito antes do código falha');
    assert.match(vermelho.stdout, /VERMELHO/);
    assert.notEqual(bp('exec', 'concluir', 'T1', '--evidencia', 'x').status, 0, 'não conclui com testes vermelhos');
    writeFileSync(join(raiz, 'src', 'resgate.js'), 'export function valorMinimo() { return 10000n; }\n\nexport function valorLiquido(brutoCentavos, anos) {\n  const aliquota = anos > 10 ? 10n : 35n;\n  return brutoCentavos - (brutoCentavos * aliquota) / 100n;\n}\n');
    assert.match(bp('testes').stdout, /VERDE/);
    assert.match(bp('exec', 'concluir', 'T1', '--evidencia', 'test/resgate.test.js: deve_aplicar_10_por_cento_apos_10_anos').stdout, /complete=true/);

    // Etapas corrigir, revisões em paralelo e consolidar
    const portoes = bp('portoes');
    assert.equal(portoes.status, 0, portoes.stdout);
    assert.match(portoes.stdout, /APROVADO \(diferenca/);
    assert.match(bp('exec', 'diff', '--stat').stdout, /src\/resgate\.js/);
    entrada('revisao-codigo.json', { revisor: 'codigo', resumo: 'ok', achados: [{ severidade: 'alta', categoria: 'precisao', titulo: 'Divisão inteira trunca centavos sem HALF_EVEN', arquivo: 'src/resgate.js', linha: 5, cenarioFalha: 'bruto 333 centavos gera IR truncado', recomendacao: 'Aplicar arredondamento HALF_EVEN explícito' }] });
    entrada('revisao-seguranca.json', { revisor: 'seguranca', resumo: 'sem achados', achados: [] });
    bp('revisao', 'registrar', '--arquivo', '.bp/estado/entrada/revisao-codigo.json');
    bp('revisao', 'registrar', '--arquivo', '.bp/estado/entrada/revisao-seguranca.json');
    const r1 = bp('revisao', 'consolidar');
    assert.equal(r1.status, 1);
    assert.match(r1.stdout, /AJUSTES_NECESSARIOS/);
    assert.match(readFileSync(join(raiz, '.bp', 'estado', 'execucao', 'CORRECOES.md'), 'utf8'), /HALF_EVEN/);
    entrada('revisao-codigo.json', { revisor: 'codigo', resumo: 'corrigido', achados: [] });
    bp('revisao', 'registrar', '--arquivo', '.bp/estado/entrada/revisao-codigo.json');
    bp('revisao', 'registrar', '--arquivo', '.bp/estado/entrada/revisao-seguranca.json');
    assert.match(bp('revisao', 'consolidar').stdout, /VEREDITO: APROVADO/);

    // Etapa validar (bp-validador)
    entrada('validacao.json', { criterios: [{ tarefa: 'T1', criterio: 'QUANDO o prazo for maior que 10 anos, o sistema DEVE aplicar 10% de IR sobre o valor bruto em centavos.', atendido: true, evidencia: 'test/resgate.test.js: deve_aplicar_10_por_cento_apos_10_anos' }] });
    assert.match(bp('exec', 'validar').stdout, /APROVADA/);
    const rel = bp('exec', 'relatorio');
    assert.match(rel.stdout, /^PRONTO/, rel.stdout + rel.stderr);
    const md = readFileSync(join(raiz, '.bp', 'estado', 'execucao', 'RELATORIO.md'), 'utf8');
    assert.match(md, /PRONTA PARA REVISÃO HUMANA/);
    assert.match(md, /Trilha de auditoria: íntegra/);
    assert.match(md, /Prazo de acumulação informado em anos inteiros/);
    assert.match(bp('auditoria', 'verificar').stdout, /íntegra/);
    assert.ok(existsSync(join(raiz, '.bp', 'estado', 'execucao', 'status.json')));
    assert.equal(JSON.parse(readFileSync(join(raiz, '.bp', 'estado', 'execucao', 'status.json'), 'utf8')).validada, true);
  } finally {
    rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
