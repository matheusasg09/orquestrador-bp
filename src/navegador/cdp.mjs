// Cliente do Chrome DevTools Protocol sobre --remote-debugging-pipe.
// O navegador lê comandos no descritor 3 e escreve respostas/eventos no descritor 4;
// cada mensagem é um JSON terminado por \0. Nenhuma porta TCP é aberta, então
// nenhum outro processo local ou página consegue se conectar ao CDP.
// Implementação própria; desenho de transporte equivalente ao modo `pipe` do Puppeteer.

import { analisarJson } from '../core/json.mjs';

const LIMITE_MENSAGEM = 64 * 1024 * 1024; // capturas de tela grandes cabem; acima disso é anomalia

export class ConexaoCdp {
  /** @param {import('node:stream').Writable} escrita @param {import('node:stream').Readable} leitura */
  constructor(escrita, leitura, { tempoLimitePadraoMs = 20000 } = {}) {
    this.escrita = escrita;
    this.leitura = leitura;
    this.tempoLimitePadraoMs = tempoLimitePadraoMs;
    this.proximoId = 0;
    this.pendentes = new Map();
    this.ouvintes = new Set();
    this.fechada = false;
    this.buffer = Buffer.alloc(0);
    leitura.on('data', (parte) => this.#receber(parte));
    leitura.on('close', () => this.#encerrar(new Error('Conexão CDP encerrada pelo navegador')));
    leitura.on('error', (e) => this.#encerrar(e));
    escrita.on('error', (e) => this.#encerrar(e));
  }

  #receber(parte) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, parte]) : parte;
    if (this.buffer.length > LIMITE_MENSAGEM) {
      this.#encerrar(new Error('Mensagem CDP excede o limite'));
      return;
    }
    let fim;
    while ((fim = this.buffer.indexOf(0)) !== -1) {
      const bruto = this.buffer.subarray(0, fim).toString('utf8');
      this.buffer = this.buffer.subarray(fim + 1);
      let msg;
      try {
        msg = analisarJson(bruto, 'CDP');
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.pendentes.has(msg.id)) {
        const p = this.pendentes.get(msg.id);
        this.pendentes.delete(msg.id);
        clearTimeout(p.temporizador);
        if (msg.error) p.rejeitar(new ErroCdp(p.metodo, msg.error));
        else p.resolver(msg.result ?? {});
      } else if (msg.method) {
        for (const ouvinte of this.ouvintes) {
          try {
            ouvinte(msg);
          } catch {
            // um ouvinte com falha não derruba a conexão
          }
        }
      }
    }
  }

  #encerrar(erro) {
    if (this.fechada) return;
    this.fechada = true;
    for (const p of this.pendentes.values()) {
      clearTimeout(p.temporizador);
      p.rejeitar(erro);
    }
    this.pendentes.clear();
  }

  /** Envia um comando. `sessao` direciona a uma aba/iframe (modo flatten). */
  enviar(metodo, parametros = {}, { sessao, tempoLimiteMs } = {}) {
    if (this.fechada) return Promise.reject(new Error('Conexão CDP fechada'));
    const id = ++this.proximoId;
    const corpo = sessao ? { id, method: metodo, params: parametros, sessionId: sessao } : { id, method: metodo, params: parametros };
    return new Promise((resolver, rejeitar) => {
      const temporizador = setTimeout(() => {
        this.pendentes.delete(id);
        rejeitar(new Error(`Tempo esgotado no comando CDP ${metodo}`));
      }, tempoLimiteMs ?? this.tempoLimitePadraoMs);
      this.pendentes.set(id, { resolver, rejeitar, temporizador, metodo });
      this.escrita.write(`${JSON.stringify(corpo)}\0`);
    });
  }

  aoEvento(fn) {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  /** Aguarda um evento que satisfaça `filtro`, com tempo limite. */
  esperarEvento(filtro, tempoLimiteMs = 10000) {
    return new Promise((resolver, rejeitar) => {
      const remover = this.aoEvento((msg) => {
        if (filtro(msg)) {
          clearTimeout(t);
          remover();
          resolver(msg);
        }
      });
      const t = setTimeout(() => {
        remover();
        rejeitar(new Error('Tempo esgotado aguardando evento CDP'));
      }, tempoLimiteMs);
    });
  }
}

export class ErroCdp extends Error {
  constructor(metodo, erro) {
    super(`CDP ${metodo}: ${erro?.message ?? 'erro'}${erro?.data ? ` (${String(erro.data).slice(0, 200)})` : ''}`);
    this.name = 'ErroCdp';
    this.codigoCdp = erro?.code;
  }
}
