// Proxy de saída do navegador: todo o tráfego (HTTP, HTTPS via CONNECT, WebSocket via
// upgrade ou CONNECT) passa por aqui e só segue para hosts permitidos. Complementa a guarda
// do CDP (Fetch.requestPaused), que não enxerga WebSocket. Escuta só em 127.0.0.1.

import http from 'node:http';
import net from 'node:net';
import { avaliarUrl } from './guarda.mjs';

const CABECALHOS_SALTO = new Set(['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade']);

function negar(socket, motivo) {
  try {
    socket.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nBloqueado pela guarda do BP: ${motivo}\r\n`);
  } catch {
    socket.destroy();
  }
}

function hostPorta(autoridade, padrao) {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(autoridade) ?? /^([^:]+):(\d+)$/.exec(autoridade);
  if (m) return { host: m[1], porta: Number(m[2]), autoridade };
  return { host: autoridade.replace(/^\[|\]$/g, ''), porta: padrao, autoridade };
}

/**
 * Inicia o proxy. `aoBloquear(url, motivo)` registra tentativas negadas.
 * Retorna { porta, fechar() }.
 */
export async function iniciarProxy(hostsPermitidos, aoBloquear = () => {}) {
  const sockets = new Set();
  const servidor = http.createServer((req, res) => {
    // Requisição HTTP em forma de proxy: req.url é absoluta.
    const { permitido, motivo } = avaliarUrl(req.url, hostsPermitidos);
    if (!permitido || !/^http:\/\//i.test(req.url)) {
      aoBloquear(req.url, motivo || 'esquema não suportado pelo proxy');
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Bloqueado pela guarda do BP');
      return;
    }
    const alvo = new URL(req.url);
    const cabecalhos = {};
    for (const [k, v] of Object.entries(req.headers)) if (!CABECALHOS_SALTO.has(k.toLowerCase())) cabecalhos[k] = v;
    const saida = http.request({ host: alvo.hostname.replace(/^\[|\]$/g, ''), port: alvo.port || 80, method: req.method, path: `${alvo.pathname}${alvo.search}`, headers: cabecalhos }, (resp) => {
      const h = {};
      for (const [k, v] of Object.entries(resp.headers)) if (!CABECALHOS_SALTO.has(k.toLowerCase())) h[k] = v;
      res.writeHead(resp.statusCode ?? 502, h);
      resp.pipe(res);
    });
    saida.on('error', () => {
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
    req.pipe(saida);
  });

  // HTTPS e WSS: túnel CONNECT só para host:porta permitidos.
  servidor.on('connect', (req, cliente, cabeca) => {
    const { host, porta, autoridade } = hostPorta(req.url, 443);
    const { permitido, motivo } = avaliarUrl(`https://${autoridade}/`, hostsPermitidos);
    if (!permitido) {
      aoBloquear(`https://${autoridade}/`, motivo);
      negar(cliente, motivo);
      return;
    }
    const destino = net.connect(porta, host, () => {
      cliente.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (cabeca?.length) destino.write(cabeca);
      destino.pipe(cliente);
      cliente.pipe(destino);
    });
    destino.on('error', () => cliente.destroy());
    cliente.on('error', () => destino.destroy());
  });

  // WebSocket sem TLS (ws://) chega como upgrade com URL absoluta.
  servidor.on('upgrade', (req, cliente, cabeca) => {
    const urlWs = req.url.replace(/^http/i, 'ws');
    const { permitido, motivo } = avaliarUrl(urlWs, hostsPermitidos);
    if (!permitido || !/^wss?:\/\//i.test(urlWs)) {
      aoBloquear(urlWs, motivo || 'websocket inválido');
      negar(cliente, motivo || 'websocket inválido');
      return;
    }
    const alvo = new URL(req.url);
    const destino = net.connect(Number(alvo.port || 80), alvo.hostname.replace(/^\[|\]$/g, ''), () => {
      const linhas = [`${req.method} ${alvo.pathname}${alvo.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (/^proxy-/i.test(req.rawHeaders[i])) continue;
        linhas.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      destino.write(`${linhas.join('\r\n')}\r\n\r\n`);
      if (cabeca?.length) destino.write(cabeca);
      destino.pipe(cliente);
      cliente.pipe(destino);
    });
    destino.on('error', () => cliente.destroy());
    cliente.on('error', () => destino.destroy());
  });

  servidor.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(0, '127.0.0.1', resolver);
  });
  return {
    porta: servidor.address().port,
    fechar: () => new Promise((r) => {
      for (const s of sockets) s.destroy();
      servidor.close(() => r());
    }),
  };
}
