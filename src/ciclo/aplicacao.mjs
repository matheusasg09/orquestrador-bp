// Sobe e para a aplicação local para QA no navegador. O comando vem da configuração
// (.bp/config.json, arquivo de governança), nunca do agente. A espera de prontidão só
// consulta URLs de hosts permitidos.

import { spawn } from 'node:child_process';
import { openSync, closeSync, existsSync, rmSync } from 'node:fs';
import { pastaEstado } from '../core/config.mjs';
import { escreverAssinado, lerAssinadoOuNulo } from '../estado/assinado.mjs';
import { localizarExecutavel, encerrarArvore } from '../core/processo.mjs';
import { avaliarUrl } from '../navegador/guarda.mjs';
import { BpErro, SAIDA } from '../core/erros.mjs';

const arqEstado = (raiz) => pastaEstado(raiz, 'app', 'processo.json');
const arqLog = (raiz) => pastaEstado(raiz, 'app', 'saida.log');

function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function responde(url, tempoMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), tempoMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    return r.status > 0 && r.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function iniciarAplicacao(raiz, config) {
  const cfg = config.aplicacao;
  if (!cfg?.comando?.length || !cfg.url) throw new BpErro('Configure aplicacao.comando e aplicacao.url em .bp/config.json (feito por uma pessoa).', { codigo: SAIDA.CONFIG });
  const guarda = avaliarUrl(cfg.url, config.navegador.hostsPermitidos);
  if (!guarda.permitido) throw new BpErro(`aplicacao.url fora dos hosts permitidos: ${guarda.motivo}`, { codigo: SAIDA.CONFIG });
  const atual = lerAssinadoOuNulo(raiz, arqEstado(raiz), 'app');
  if (atual && vivo(atual.pid)) {
    if (await responde(cfg.url, 3000)) return `[ok] aplicação já está no ar em ${cfg.url} (pid ${atual.pid})`;
  }
  const [prog, ...args] = cfg.comando;
  const exe = localizarExecutavel(prog);
  if (!exe) throw new BpErro(`Programa da aplicação não encontrado: ${prog}`, { codigo: SAIDA.CONFIG });
  const ehScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
  for (const a of args) if (ehScript && !/^[\w@%+=:,./\\-]*$/.test(a)) throw new BpErro(`Argumento inseguro em aplicacao.comando: ${a}`, { codigo: SAIDA.CONFIG });
  const log = openSync(arqLog(raiz), 'w', 0o600);
  const filho = ehScript
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[`"${exe}"`, ...args].join(' ')}"`], { cwd: raiz, detached: true, stdio: ['ignore', log, log], windowsHide: true, windowsVerbatimArguments: true, env: { ...process.env, ...(cfg.ambiente ?? {}), BROWSER: 'none', CI: '1' } })
    : spawn(exe, args, { cwd: raiz, detached: true, stdio: ['ignore', log, log], windowsHide: true, shell: false, env: { ...process.env, ...(cfg.ambiente ?? {}), BROWSER: 'none', CI: '1' } });
  closeSync(log);
  filho.unref();
  escreverAssinado(raiz, arqEstado(raiz), { pid: filho.pid, url: cfg.url, iniciadoEm: new Date().toISOString() }, 'app');
  const fim = Date.now() + (cfg.tempoInicioSeg ?? 90) * 1000;
  while (Date.now() < fim) {
    if (!vivo(filho.pid)) throw new BpErro(`A aplicação encerrou ao iniciar. Veja ${arqLog(raiz)}`, { codigo: SAIDA.FALHA });
    if (await responde(cfg.url, 3000)) return `[ok] aplicação no ar em ${cfg.url} (pid ${filho.pid}); log em .bp/estado/app/saida.log`;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new BpErro(`A aplicação não respondeu em ${cfg.tempoInicioSeg ?? 90}s em ${cfg.url}. Veja .bp/estado/app/saida.log`, { codigo: SAIDA.FALHA });
}

export function pararAplicacao(raiz) {
  if (!existsSync(arqEstado(raiz))) return '[ok] nenhuma aplicação iniciada pelo BP';
  // Só encerra o processo que o próprio BP registrou (assinado); PID forjado é recusado.
  const atual = lerAssinadoOuNulo(raiz, arqEstado(raiz), 'app');
  if (!atual) throw new BpErro('Registro da aplicação adulterado ou gravado fora do BP; nada foi encerrado.', { codigo: SAIDA.BLOQUEIO });
  if (!Number.isInteger(atual.pid) || atual.pid <= 4 || atual.pid === process.pid || atual.pid === process.ppid) throw new BpErro(`PID recusado: ${atual.pid}`, { codigo: SAIDA.BLOQUEIO });
  if (vivo(atual.pid)) {
    // Processo destacado: no POSIX encerra o grupo inteiro (-pid); no Windows, taskkill /t.
    encerrarArvore({
      pid: atual.pid,
      exitCode: null,
      kill: (sinal) => {
        try {
          if (process.platform !== 'win32' && atual.pid > 1) process.kill(-atual.pid, sinal);
          else process.kill(atual.pid, sinal);
        } catch {
          process.kill(atual.pid, sinal);
        }
      },
    });
  }
  if (existsSync(arqEstado(raiz))) rmSync(arqEstado(raiz), { force: true });
  return `[ok] aplicação (pid ${atual.pid}) encerrada`;
}

export async function statusAplicacao(raiz, config) {
  const atual = lerAssinadoOuNulo(raiz, arqEstado(raiz), 'app');
  if (!atual) return 'Aplicação não iniciada pelo BP.';
  const ok = vivo(atual.pid) && config.aplicacao?.url ? await responde(config.aplicacao.url, 3000) : false;
  return `Aplicação pid ${atual.pid}: ${ok ? 'respondendo' : 'sem resposta'} em ${atual.url}`;
}
