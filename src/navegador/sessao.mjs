// Sessão persistente do navegador entre comandos do agente.
// Um processo servidor mantém o navegador (CDP por pipe) e atende comandos por IPC local:
// named pipe no Windows, socket Unix com permissão 0600 nos demais. Cada comando exige um
// token aleatório de 256 bits gravado em arquivo de estado restrito ao usuário.

import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Navegador } from './navegador.mjs';
import { executarAcao, ACOES } from './acoes.mjs';
import { pastaEstado } from '../core/config.mjs';
import { escreverJson, lerJson, analisarJson } from '../core/json.mjs';
import { BpErro, SAIDA } from '../core/erros.mjs';

const OCIOSO_MS = 15 * 60 * 1000;
const LIMITE_PEDIDO = 64 * 1024;
const ENTRADA_CLI = fileURLToPath(new URL('../../bin/bp.mjs', import.meta.url));

export function arquivoSessao(raiz) {
  return pastaEstado(raiz, 'navegador', 'sessao.json');
}

function opcoesNavegador(config) {
  const n = config.navegador;
  return { executavel: n.executavel, semJanela: n.semJanela, largura: n.largura, altura: n.altura, hostsPermitidos: n.hostsPermitidos, tempoLimiteMs: n.tempoLimiteMs };
}

/** Processo servidor (iniciado em segundo plano por `nav abrir`). */
export async function executarServidor(raiz, config, nonce) {
  const nav = new Navegador(opcoesNavegador(config));
  await nav.iniciar();
  const token = randomBytes(32).toString('hex');
  const sufixo = randomBytes(8).toString('hex');
  const endereco = process.platform === 'win32' ? `\\\\.\\pipe\\bp-nav-${sufixo}` : join(tmpdir(), `bp-nav-${sufixo}.sock`);
  let fila = Promise.resolve();
  let ocioso;
  let encerrando = false;

  const encerrar = async () => {
    if (encerrando) return;
    encerrando = true;
    clearTimeout(ocioso);
    servidor.close();
    await nav.fechar();
    rmSync(arquivoSessao(raiz), { force: true });
    if (process.platform !== 'win32') rmSync(endereco, { force: true });
    process.exit(0);
  };
  const reiniciarOcioso = () => {
    clearTimeout(ocioso);
    ocioso = setTimeout(encerrar, OCIOSO_MS);
  };

  const servidor = net.createServer((socket) => {
    let dados = '';
    socket.setEncoding('utf8');
    socket.setTimeout(150000, () => socket.destroy());
    socket.on('data', (parte) => {
      dados += parte;
      if (dados.length > LIMITE_PEDIDO) {
        socket.destroy();
        return;
      }
      const fim = dados.indexOf('\n');
      if (fim === -1) return;
      const linha = dados.slice(0, fim);
      fila = fila.then(async () => {
        let pedido;
        try {
          pedido = analisarJson(linha, 'pedido');
          const recebido = Buffer.from(String(pedido.token ?? ''), 'utf8');
          const esperado = Buffer.from(token, 'utf8');
          if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) throw new BpErro('Token inválido', { codigo: SAIDA.BLOQUEIO });
          reiniciarOcioso();
          if (pedido.acao === 'fechar') {
            socket.end(`${JSON.stringify({ ok: true, resultado: '[ok] navegador fechado' })}\n`);
            setTimeout(encerrar, 50);
            return;
          }
          const resultado = await executarAcao(nav, String(pedido.acao), pedido.args ?? {}, { raiz });
          socket.end(`${JSON.stringify({ ok: true, resultado })}\n`);
        } catch (e) {
          socket.end(`${JSON.stringify({ ok: false, erro: e.message, codigo: e.codigo ?? SAIDA.FALHA })}\n`);
        }
        if (nav.encerrado) setTimeout(encerrar, 50);
      });
    });
    socket.on('error', () => {});
  });
  await new Promise((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(endereco, resolver);
  });
  if (process.platform !== 'win32') chmodSync(endereco, 0o600);
  escreverJson(arquivoSessao(raiz), { pid: process.pid, endereco, token, nonce, produto: nav.produto, iniciadoEm: new Date().toISOString() });
  reiniciarOcioso();
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);
  nav.processo.on('exit', () => setTimeout(encerrar, 50));
}

function enviarPedido(sessao, acao, args, tempoLimiteMs) {
  return new Promise((resolver, rejeitar) => {
    const socket = net.connect(sessao.endereco);
    let resposta = '';
    const t = setTimeout(() => {
      socket.destroy();
      rejeitar(new BpErro(`Tempo esgotado na ação ${acao}`, { codigo: SAIDA.FALHA }));
    }, tempoLimiteMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ token: sessao.token, acao, args })}\n`));
    socket.on('data', (p) => { resposta += p; });
    socket.on('end', () => {
      clearTimeout(t);
      try {
        resolver(analisarJson(resposta.trim(), 'resposta do navegador'));
      } catch (e) {
        rejeitar(e);
      }
    });
    socket.on('error', (e) => {
      clearTimeout(t);
      rejeitar(Object.assign(new BpErro(`Sessão do navegador indisponível: ${e.code ?? e.message}`, { codigo: SAIDA.FALHA }), { semSessao: true }));
    });
  });
}

export async function sessaoAtiva(raiz) {
  const arq = arquivoSessao(raiz);
  if (!existsSync(arq)) return null;
  const sessao = lerJson(arq);
  try {
    await enviarPedido(sessao, 'abas', {}, 5000);
    return sessao;
  } catch (e) {
    if (e.semSessao) rmSync(arq, { force: true });
    return null;
  }
}

/** Garante uma sessão (inicia o servidor em segundo plano se preciso). */
export async function garantirSessao(raiz) {
  const ativa = await sessaoAtiva(raiz);
  if (ativa) return { sessao: ativa, nova: false };
  const nonce = randomBytes(12).toString('hex');
  const filho = spawn(process.execPath, [ENTRADA_CLI, 'nav', '_servidor', '--nonce', nonce], {
    cwd: raiz,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, BP_RAIZ: raiz },
  });
  filho.unref();
  const fim = Date.now() + 40000;
  while (Date.now() < fim) {
    await new Promise((r) => setTimeout(r, 200));
    if (existsSync(arquivoSessao(raiz))) {
      try {
        const s = lerJson(arquivoSessao(raiz));
        if (s.nonce === nonce) return { sessao: s, nova: true };
      } catch {
        // arquivo ainda sendo escrito
      }
    }
    if (filho.exitCode !== null) break;
  }
  throw new BpErro('O navegador não iniciou. Rode "node .bp/bp.mjs doutor" para diagnosticar.', { codigo: SAIDA.FALHA });
}

export async function comandoSessao(raiz, acao, args = {}) {
  if (acao !== 'fechar' && !ACOES.includes(acao)) throw new BpErro(`Ação desconhecida: ${acao}`, { codigo: SAIDA.USO });
  const { sessao } = await garantirSessao(raiz);
  const tempo = acao === 'esperar' ? Math.min(Number(args.ms) || 10000, 120000) + 15000 : 130000;
  const r = await enviarPedido(sessao, acao, args, tempo);
  if (!r.ok) throw new BpErro(r.erro, { codigo: r.codigo ?? SAIDA.FALHA });
  return r.resultado;
}

export async function fecharSessao(raiz) {
  const ativa = await sessaoAtiva(raiz);
  if (!ativa) return '[ok] nenhum navegador aberto';
  const r = await enviarPedido(ativa, 'fechar', {}, 15000);
  return r.resultado;
}
