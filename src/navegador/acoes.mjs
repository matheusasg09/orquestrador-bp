// Despacho de ações do navegador, compartilhado pelo servidor (sessão persistente)
// e pelo executor de roteiros (execução única, determinística, sem tokens).

import { join } from 'node:path';
import { resolverLeituraSegura } from '../core/leitura.mjs';
import { pastaEstado } from '../core/config.mjs';
import { BpErro, SAIDA } from '../core/erros.mjs';

const ID = /^\d{1,12}$/;

function idValido(v) {
  const s = String(v ?? '');
  if (!ID.test(s)) throw new BpErro(`Índice de elemento inválido: ${s}`, { codigo: SAIDA.USO });
  return Number(s);
}

function nomeArquivoSeguro(nome, extensao) {
  const base = String(nome ?? '').replace(/[^\w.-]/g, '_').slice(0, 80) || `captura-${Date.now()}`;
  return base.toLowerCase().endsWith(extensao) ? base : `${base}${extensao}`;
}

export const ACOES = Object.freeze(['estado', 'navegar', 'voltar', 'avancar', 'recarregar', 'clicar', 'digitar', 'selecionar', 'tecla', 'rolar', 'esperar', 'captura', 'console', 'rede', 'abas', 'aba', 'upload']);

/** Executa `acao` com `args` (objeto) no navegador `nav`. Retorna texto ou objeto serializável. */
export async function executarAcao(nav, acao, args, { raiz }) {
  switch (acao) {
    case 'estado':
      return nav.estado({ maxCaracteres: args.max ? Math.min(Number(args.max) || 6000, 40000) : undefined });
    case 'navegar':
      if (typeof args.url !== 'string') throw new BpErro('Informe a URL', { codigo: SAIDA.USO });
      return nav.navegar(args.url);
    case 'voltar':
      return nav.historico(-1);
    case 'avancar':
      return nav.historico(1);
    case 'recarregar':
      return nav.recarregar();
    case 'clicar':
      return nav.clicar(idValido(args.id), { aceitarDialogo: args.aceitarDialogo === true });
    case 'digitar':
      return nav.digitar(idValido(args.id), String(args.texto ?? ''), { enter: args.enter === true });
    case 'selecionar':
      return nav.selecionar(idValido(args.id), String(args.opcao ?? ''));
    case 'tecla':
      return nav.tecla(String(args.tecla ?? ''));
    case 'rolar':
      return nav.rolar(args.direcao === 'cima' ? 'cima' : 'baixo', args.paginas ?? 1);
    case 'esperar':
      if (args.texto) return nav.esperarTexto(String(args.texto), Number(args.ms) || 10000);
      await new Promise((r) => setTimeout(r, Math.min(Number(args.ms) || 1000, 30000)));
      return '[ok] esperar';
    case 'captura': {
      const pasta = pastaEstado(raiz, 'navegador', 'capturas');
      const destino = join(pasta, nomeArquivoSeguro(args.arquivo, '.png'));
      return nav.captura(destino, { paginaInteira: args.paginaInteira === true });
    }
    case 'console':
      return nav.relatorioConsole();
    case 'rede':
      return nav.relatorioRede();
    case 'abas':
      return nav.abas();
    case 'aba':
      return nav.trocarAba(Number(args.indice));
    case 'upload': {
      const { absoluto, relativo } = resolverLeituraSegura(raiz, String(args.arquivo ?? ''), 'arquivo de upload');
      return nav.upload(idValido(args.id), absoluto, raiz, relativo);
    }
    default:
      throw new BpErro(`Ação desconhecida: ${acao}. Ações: ${ACOES.join(', ')}`, { codigo: SAIDA.USO });
  }
}
