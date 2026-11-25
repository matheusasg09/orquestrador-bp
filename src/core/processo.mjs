// Execução de processos sem shell, com tempo limite, limite de saída e
// ambiente reduzido. Nunca interpola texto em linha de comando de shell.

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import { BpErro, SAIDA } from './erros.mjs';

const WINDOWS = process.platform === 'win32';
// Argumentos permitidos quando o Windows exige cmd.exe (.cmd/.bat): sem metacaracteres.
const ARG_SEGURO_CMD = /^[\w@%+=:,./\\-]*$/;
const VARIAVEIS_REPASSADAS = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData',
  'JAVA_HOME', 'MAVEN_HOME', 'GRADLE_USER_HOME', 'DOTNET_ROOT', 'NODE_OPTIONS_BP', 'LANG', 'LC_ALL',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'CI',
];

export function ambienteReduzido(extra = {}) {
  const env = {};
  for (const k of VARIAVEIS_REPASSADAS) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}

/** Localiza um executável no PATH (respeitando PATHEXT no Windows). */
export function localizarExecutavel(nome) {
  if (isAbsolute(nome)) return existsSync(nome) ? nome : null;
  if (nome.includes('/') || nome.includes('\\')) return existsSync(nome) ? nome : null;
  const pastas = (process.env.PATH || process.env.Path || '').split(delimiter).filter(Boolean);
  const extensoes = WINDOWS
    ? (extname(nome) ? [''] : (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()))
    : [''];
  for (const pasta of pastas) {
    for (const ext of extensoes) {
      const candidato = join(pasta, nome + ext);
      try {
        if (statSync(candidato).isFile()) return candidato;
      } catch {
        // continua procurando
      }
    }
  }
  return null;
}

/**
 * Executa `comando` (array: [programa, ...argumentos]) sem shell.
 * Resolve com { codigo, stdout, stderr, tempoMs, estourouTempo, truncado }.
 */
export function executar(comando, { cwd, tempoLimiteMs = 10 * 60 * 1000, limiteSaida = 4 * 1024 * 1024, env, entrada } = {}) {
  if (!Array.isArray(comando) || comando.length === 0 || comando.some((p) => typeof p !== 'string' || p.includes('\0'))) {
    return Promise.reject(new BpErro('Comando inválido: use um array de strings', { codigo: SAIDA.USO }));
  }
  const [programa, ...args] = comando;
  const resolvido = localizarExecutavel(programa);
  if (!resolvido) return Promise.reject(new BpErro(`Programa não encontrado no PATH: ${programa}`, { codigo: SAIDA.CONFIG }));

  let arquivo = resolvido;
  let argumentos = args;
  const opcoes = { cwd, env: env ?? ambienteReduzido(), windowsHide: true, shell: false };
  if (WINDOWS && /\.(cmd|bat)$/i.test(resolvido)) {
    // Desde o CVE-2024-27980 o Node exige cmd.exe para .cmd/.bat. Só aceitamos argumentos sem metacaracteres.
    for (const a of args) {
      if (!ARG_SEGURO_CMD.test(a)) {
        return Promise.reject(new BpErro(`Argumento recusado para script .cmd/.bat (caracteres não permitidos): ${a}`, { codigo: SAIDA.BLOQUEIO }));
      }
    }
    if (/[\s&|<>^"%]/.test(resolvido)) {
      // Caminho com espaço é aceito com aspas; demais metacaracteres não.
      if (/[&|<>^"%]/.test(resolvido)) return Promise.reject(new BpErro('Caminho de script inseguro', { codigo: SAIDA.BLOQUEIO }));
    }
    arquivo = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    argumentos = ['/d', '/s', '/c', `"${[`"${resolvido}"`, ...args].join(' ')}"`];
    opcoes.windowsVerbatimArguments = true;
  }

  return new Promise((resolverPromessa, rejeitar) => {
    const inicio = Date.now();
    let stdout = '';
    let stderr = '';
    let truncado = false;
    let estourouTempo = false;
    let filho;
    try {
      filho = spawn(arquivo, argumentos, opcoes);
    } catch (e) {
      rejeitar(new BpErro(`Falha ao iniciar ${programa}: ${e.message}`, { codigo: SAIDA.INTERNO }));
      return;
    }
    const acumular = (atual, parte) => {
      if (atual.length >= limiteSaida) {
        truncado = true;
        return atual;
      }
      const texto = parte.toString('utf8');
      const resto = limiteSaida - atual.length;
      if (texto.length > resto) truncado = true;
      return atual + texto.slice(0, resto);
    };
    filho.stdout?.on('data', (p) => { stdout = acumular(stdout, p); });
    filho.stderr?.on('data', (p) => { stderr = acumular(stderr, p); });
    const temporizador = setTimeout(() => {
      estourouTempo = true;
      encerrarArvore(filho);
    }, tempoLimiteMs);
    filho.on('error', (e) => {
      clearTimeout(temporizador);
      rejeitar(new BpErro(`Falha ao executar ${programa}: ${e.message}`, { codigo: SAIDA.INTERNO }));
    });
    filho.on('close', (codigo, sinal) => {
      clearTimeout(temporizador);
      resolverPromessa({ codigo: codigo ?? (sinal ? 128 : 1), stdout, stderr, tempoMs: Date.now() - inicio, estourouTempo, truncado });
    });
    if (entrada !== undefined) filho.stdin.end(entrada);
    else filho.stdin.end();
  });
}

export function encerrarArvore(filho) {
  if (!filho || filho.exitCode !== null) return;
  if (WINDOWS && filho.pid) {
    // taskkill encerra a árvore inteira; sem shell e com PID numérico.
    try {
      spawn('taskkill', ['/pid', String(filho.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore', shell: false });
    } catch {
      filho.kill();
    }
  } else {
    try {
      filho.kill('SIGTERM');
      setTimeout(() => { if (filho.exitCode === null) filho.kill('SIGKILL'); }, 3000).unref();
    } catch {
      // processo já terminou
    }
  }
}
