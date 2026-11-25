// Consultas Git somente leitura usadas pelos portões (sem shell, argumentos fixos).

import { executar, localizarExecutavel } from '../core/processo.mjs';

const REF_SEGURA = /^[\w./~^@{}-]{1,200}$/;

export function gitDisponivel() {
  return Boolean(localizarExecutavel('git'));
}

// Neutraliza configurações do repositório que executam programas durante leituras
// (um agente poderia gravá-las para rodar código com os privilégios de quem chama o BP).
const NULO = process.platform === 'win32' ? 'NUL' : '/dev/null';
const SEGURO = [
  '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${NULO}`, '-c', 'core.pager=cat',
  '-c', 'diff.external=', '-c', 'core.sshCommand=', '-c', 'credential.helper=', '-c', 'protocol.allow=never',
  '-c', 'core.untrackedCache=false', '-c', 'diff.noprefix=false',
];
const AMBIENTE_GIT = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_EXTERNAL_DIFF: '', GIT_CONFIG_NOSYSTEM: '1' };

async function git(raiz, args, tempoLimiteMs = 60000) {
  const [sub, ...resto] = args;
  // Em diff, sem textconv nem diff externo (filtros de conteúdo definidos no repositório).
  const extras = sub === 'diff' ? ['--no-ext-diff', '--no-textconv'] : [];
  return executar(['git', ...SEGURO, sub, ...extras, ...resto], { cwd: raiz, tempoLimiteMs, limiteSaida: 32 * 1024 * 1024, env: { ...process.env, ...AMBIENTE_GIT } });
}

export async function ehRepositorio(raiz) {
  if (!gitDisponivel()) return false;
  const r = await git(raiz, ['rev-parse', '--is-inside-work-tree']).catch(() => null);
  return Boolean(r && r.codigo === 0 && r.stdout.trim() === 'true');
}

/** Arquivos alterados (rastreados vs base e não rastreados). Caminhos POSIX relativos à raiz do repositório. */
export async function arquivosAlterados(raiz, base) {
  if (base && !REF_SEGURA.test(base)) throw new Error(`Referência Git inválida: ${base}`);
  const alvo = base ?? 'HEAD';
  const temHead = (await git(raiz, ['rev-parse', '--verify', '--quiet', 'HEAD'])).codigo === 0;
  const lista = new Set();
  if (temHead) {
    const d = await git(raiz, ['diff', '--name-only', '--diff-filter=ACMR', '-z', alvo, '--']);
    d.stdout.split('\0').filter(Boolean).forEach((f) => lista.add(f));
  }
  const u = await git(raiz, ['ls-files', '--others', '--exclude-standard', '-z']);
  u.stdout.split('\0').filter(Boolean).forEach((f) => lista.add(f));
  const st = await git(raiz, ['diff', '--name-only', '--cached', '--diff-filter=ACMR', '-z']);
  st.stdout.split('\0').filter(Boolean).forEach((f) => lista.add(f));
  return [...lista].sort();
}

/**
 * Linhas adicionadas por arquivo: Map<caminho, Array<{linha:number, texto:string}>>.
 * Arquivos não rastreados entram inteiros.
 */
export async function linhasAdicionadas(raiz, base, arquivos) {
  const alvo = base ?? 'HEAD';
  const mapa = new Map();
  const temHead = (await git(raiz, ['rev-parse', '--verify', '--quiet', 'HEAD'])).codigo === 0;
  if (temHead) {
    const d = await git(raiz, ['diff', '--unified=0', '--no-color', '--no-ext-diff', alvo, '--']);
    let atual = null;
    let numero = 0;
    for (const linha of d.stdout.split('\n')) {
      if (linha.startsWith('+++ ')) {
        const caminho = linha.slice(4).trim();
        atual = caminho === '/dev/null' ? null : caminho.replace(/^b\//, '');
        if (atual && !mapa.has(atual)) mapa.set(atual, []);
        continue;
      }
      const h = linha.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (h) {
        numero = Number(h[1]);
        continue;
      }
      if (atual && linha.startsWith('+') && !linha.startsWith('+++')) {
        mapa.get(atual).push({ linha: numero, texto: linha.slice(1) });
        numero++;
      }
    }
  }
  return { mapa, completos: arquivos.filter((a) => !mapa.has(a)) };
}

const EXCLUSOES_DIFF = [':(exclude)package-lock.json', ':(exclude)yarn.lock', ':(exclude)pnpm-lock.yaml', ':(exclude)*.min.js', ':(exclude)*.map', ':(exclude).bp/estado', ':(exclude).bp/ferramenta'];

export async function commitAtual(raiz) {
  const r = await git(raiz, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => null);
  return r && r.codigo === 0 ? r.stdout.trim() : null;
}

/** Diff textual para revisores (sem lockfiles e estado do BP). `arquivo` restringe a um caminho. */
export async function diffTexto(raiz, base, { arquivo, stat = false } = {}) {
  if (base && !REF_SEGURA.test(base)) throw new Error(`Referência Git inválida: ${base}`);
  if (arquivo && (arquivo.startsWith('-') || arquivo.includes('\0'))) throw new Error('Caminho inválido');
  const alvo = base ?? 'HEAD';
  const filtro = arquivo ? [arquivo] : ['.', ...EXCLUSOES_DIFF];
  const args = stat ? ['diff', '--stat=200', '--no-color', alvo, '--', ...filtro] : ['diff', '--no-color', '--no-ext-diff', '--unified=3', alvo, '--', ...filtro];
  const r = await git(raiz, args);
  const novos = (await git(raiz, ['ls-files', '--others', '--exclude-standard', '--', ...filtro])).stdout.split('\n').filter((f) => f && !f.startsWith('.bp/estado/'));
  return { texto: r.stdout, novos };
}

export async function estatisticas(raiz, base) {
  const alvo = base ?? 'HEAD';
  const r = await git(raiz, ['diff', '--numstat', alvo, '--']).catch(() => null);
  let adicionadas = 0;
  let removidas = 0;
  for (const l of r?.stdout.split('\n') ?? []) {
    const [a, rem] = l.split('\t');
    if (/^\d+$/.test(a)) adicionadas += Number(a);
    if (/^\d+$/.test(rem)) removidas += Number(rem);
  }
  return { adicionadas, removidas };
}
