// Loop de testes: detecta e executa a suíte do projeto e devolve um resumo de falhas
// compacto (só o que importa para corrigir), economizando tokens do agente.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { executar } from '../core/processo.mjs';
import { analisarJson } from '../core/json.mjs';
import { escreverAssinado, arquivoTestes } from '../estado/assinado.mjs';
import { pastaEstado } from '../core/config.mjs';
import { redigir } from '../core/sensiveis.mjs';
import { cortarParaOrcamento } from '../rag/texto.mjs';

const WIN = process.platform === 'win32';

/** Detecta comandos de teste pelo que existe na raiz. Sem instalar nada. */
export function detectarComandos(raiz) {
  const cmds = [];
  const pkg = join(raiz, 'package.json');
  if (existsSync(pkg)) {
    try {
      const p = analisarJson(readFileSync(pkg, 'utf8'), pkg);
      const t = p.scripts?.test;
      if (t && !/no test specified/i.test(t)) cmds.push(['npm', 'test', '--silent']);
    } catch {
      // package.json inválido: ignora
    }
  }
  if (existsSync(join(raiz, 'pom.xml'))) {
    const mvnw = join(raiz, WIN ? 'mvnw.cmd' : 'mvnw');
    cmds.push([existsSync(mvnw) ? mvnw : 'mvn', '-q', '-B', 'test']);
  }
  if (existsSync(join(raiz, 'build.gradle')) || existsSync(join(raiz, 'build.gradle.kts'))) {
    const gw = join(raiz, WIN ? 'gradlew.bat' : 'gradlew');
    cmds.push([existsSync(gw) ? gw : 'gradle', 'test', '--console=plain', '-q']);
  }
  let entradas = [];
  try {
    entradas = readdirSync(raiz);
  } catch {
    // raiz ilegível
  }
  if (entradas.some((f) => /\.(sln|slnx|csproj)$/i.test(f))) cmds.push(['dotnet', 'test', '--nologo', '-v', 'q']);
  if (entradas.includes('pytest.ini') || entradas.includes('conftest.py') || (entradas.includes('pyproject.toml') && /pytest/.test(readFileSync(join(raiz, 'pyproject.toml'), 'utf8')))) {
    cmds.push([WIN ? 'python' : 'python3', '-m', 'pytest', '-q', '--no-header', '-rfE']);
  }
  if (entradas.includes('go.mod')) cmds.push(['go', 'test', './...']);
  return cmds;
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const SINAL_FALHA = /(not ok\b|✖|✗|×|\bFAIL(?:ED|URE)?\b|\bfail(?:ed|ure|ing)?\b|\bERRO(?:R)?\b|\berror\b|Exception\b|AssertionError|assert|expected|received|esperado|recebido|Tests run:.*Failures: [1-9]|Tests run:.*Errors: [1-9]|^\s*E\s{2,}|--- FAIL:|Error Message:|Stack Trace:|panic:)/i;
const RUIDO = /(node_modules[\\/]|node:internal|\(node:[a-z_]+|at Module\.|at Object\.<anonymous> \(node:|at (?:async )?Test\.|at TestContext\.|^\s+(?:generatedMessage|code|operator|diff): |java\.base\/|jdk\.internal|sun\.reflect|org\.junit\.platform|org\.apache\.maven|System\.RuntimeMethodHandle|_pytest[\\/]|site-packages[\\/]pluggy)/;

/** Ambiente dos testes do projeto: sem variáveis do executor de testes do próprio BP. */
function ambienteTestes() {
  const env = { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  // Sem isso, um "node --test" filho reporta ao processo pai e sai com 0 mesmo falhando.
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** Extrai as linhas de falha com contexto, sem repetição, até o orçamento de tokens. */
export function resumirFalhas(saida, orcamento = 1500) {
  const linhas = saida.replace(ANSI, '').split(/\r?\n/);
  const escolhidas = new Set();
  linhas.forEach((l, i) => {
    if (!SINAL_FALHA.test(l) || RUIDO.test(l)) return;
    for (let j = Math.max(0, i - 1); j <= Math.min(linhas.length - 1, i + 3); j++) if (!RUIDO.test(linhas[j])) escolhidas.add(j);
  });
  const vistos = new Set();
  const final = [];
  for (const i of [...escolhidas].sort((a, b) => a - b)) {
    const t = linhas[i].trimEnd();
    const chave = t.trim();
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    final.push(t.length > 300 ? `${t.slice(0, 300)}…` : t);
  }
  const texto = final.length ? final.join('\n') : linhas.filter((l) => l.trim()).slice(-40).join('\n');
  return cortarParaOrcamento(redigir(texto), orcamento).texto;
}

/** Executa os testes. Retorna { verde, comandos: [...] } e grava estado para o workflow. */
export async function executarTestes(raiz, config, { comandosExtras } = {}) {
  const comandos = comandosExtras?.length ? comandosExtras : config.testes.comandos.length ? config.testes.comandos : detectarComandos(raiz);
  const resultado = { verde: false, comandos: [], geradoEm: new Date().toISOString() };
  if (!comandos.length) {
    resultado.semTestes = true;
    resultado.mensagem = 'Nenhuma suíte de testes detectada. Configure testes.comandos em .bp/config.json.';
    escreverAssinado(raiz, arquivoTestes(raiz), resultado, 'testes');
    return resultado;
  }
  let todosOk = true;
  for (const cmd of comandos) {
    const r = await executar(cmd, { cwd: raiz, tempoLimiteMs: config.testes.tempoLimiteSeg * 1000, env: ambienteTestes() }).catch((e) => ({ codigo: -1, stdout: '', stderr: e.message, tempoMs: 0, estourouTempo: false }));
    const ok = r.codigo === 0 && !r.estourouTempo;
    todosOk &&= ok;
    resultado.comandos.push({
      comando: cmd.map((c) => (c.includes(raiz) ? c.replace(raiz, '.') : c)).join(' '),
      codigo: r.codigo,
      ok,
      tempoMs: r.tempoMs,
      estourouTempo: r.estourouTempo,
      falhas: ok ? '' : resumirFalhas(`${r.stdout}\n${r.stderr}`, config.tokens.orcamentoFalhas),
    });
  }
  resultado.verde = todosOk;
  escreverAssinado(raiz, arquivoTestes(raiz), resultado, 'testes');
  return resultado;
}

export function resumirTestes(r) {
  if (r.semTestes) return `Testes: SEM SUÍTE. ${r.mensagem}`;
  const linhas = [`Testes: ${r.verde ? 'VERDE' : 'VERMELHO'}`];
  for (const c of r.comandos) {
    linhas.push(`- ${c.ok ? 'ok' : 'FALHOU'} (${Math.round(c.tempoMs / 1000)}s${c.estourouTempo ? ', tempo esgotado' : ''}) ${c.comando}`);
    if (!c.ok && c.falhas) linhas.push(c.falhas.split('\n').map((l) => `    ${l}`).join('\n'));
  }
  return linhas.join('\n');
}
