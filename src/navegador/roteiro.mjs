// Roteiros E2E declarativos (JSON): executam passos e verificações sem gastar tokens.
// Alvos são localizados por papel e nome acessível (estáveis entre execuções),
// não por índice. Ideal para o loop de testes de regressão de interface.

import { join } from 'node:path';
import { Navegador } from './navegador.mjs';
import { executarAcao } from './acoes.mjs';
import { validar } from '../core/esquema.mjs';
import { lerJson, escreverJson } from '../core/json.mjs';
import { pastaEstado } from '../core/config.mjs';
import { BpErro, SAIDA, erroConfig } from '../core/erros.mjs';

const ESQUEMA = {
  type: 'object',
  required: ['nome', 'url', 'passos'],
  properties: {
    nome: { type: 'string', pattern: '^[\\w.-]{1,80}$' },
    url: { type: 'string', maxLength: 2000 },
    passos: {
      type: 'array',
      minItems: 1,
      maxItems: 300,
      items: {
        type: 'object',
        required: ['acao'],
        properties: {
          acao: { type: 'string', enum: ['navegar', 'clicar', 'digitar', 'selecionar', 'tecla', 'rolar', 'esperar', 'esperarTexto', 'verificarTexto', 'verificarAusente', 'verificarElemento', 'verificarSemErrosConsole', 'verificarSemFalhasRede', 'captura', 'voltar', 'recarregar'] },
          alvo: { type: 'object', properties: { papel: { type: 'string' }, nome: { type: 'string' }, exato: { type: 'boolean' }, ordem: { type: 'integer', minimum: 1 } } },
          texto: { type: 'string', maxLength: 10000 },
          url: { type: 'string' },
          tecla: { type: 'string' },
          opcao: { type: 'string' },
          enter: { type: 'boolean' },
          aceitarDialogo: { type: 'boolean' },
          ms: { type: 'integer', minimum: 0, maximum: 120000 },
          arquivo: { type: 'string' },
          direcao: { type: 'string', enum: ['cima', 'baixo'] },
          descricao: { type: 'string' },
        },
      },
    },
  },
};

/** Substitui ${env:BP_TESTE_*}. Só variáveis com esse prefixo, para não vazar o ambiente. */
export function resolverVariaveis(texto, segredos) {
  return texto.replace(/\$\{env:([A-Z0-9_]+)\}/g, (_, nome) => {
    if (!nome.startsWith('BP_TESTE_')) throw new BpErro(`Variável não permitida em roteiro: ${nome} (use o prefixo BP_TESTE_)`, { codigo: SAIDA.BLOQUEIO });
    const v = process.env[nome];
    if (v === undefined) throw new BpErro(`Variável de ambiente ausente: ${nome}`, { codigo: SAIDA.CONFIG });
    // Valor vindo do ambiente é tratado como segredo em toda saída do roteiro.
    if (segredos && v.length >= 3) segredos.add(v);
    return v;
  });
}

const dobrar = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Encontra o id de um elemento pelo papel/nome no último estado. */
export function localizarAlvo(ids, alvo) {
  const candidatos = [];
  for (const [id, info] of ids) {
    if (alvo.papel && dobrar(info.papel) !== dobrar(alvo.papel)) continue;
    if (alvo.nome !== undefined) {
      const n = dobrar(info.nome);
      const q = dobrar(alvo.nome);
      if (alvo.exato ? n !== q : !n.includes(q)) continue;
    }
    candidatos.push(id);
  }
  const ordem = alvo.ordem ?? 1;
  if (candidatos.length < ordem) {
    throw new BpErro(`Elemento não encontrado: ${JSON.stringify(alvo)} (${candidatos.length} candidato(s))`, { codigo: SAIDA.FALHA });
  }
  if (candidatos.length > 1 && !alvo.ordem && !alvo.exato) {
    // Ambiguidade explícita evita clicar no elemento errado.
    const exatos = candidatos.filter((id) => dobrar(ids.get(id).nome) === dobrar(alvo.nome ?? ''));
    if (exatos.length === 1) return exatos[0];
    throw new BpErro(`Alvo ambíguo: ${JSON.stringify(alvo)} casa ${candidatos.length} elementos; informe "exato" ou "ordem"`, { codigo: SAIDA.FALHA });
  }
  return candidatos[ordem - 1];
}

export function carregarRoteiro(caminho) {
  const r = lerJson(caminho, { limite: 1024 * 1024 });
  const erros = validar(ESQUEMA, r);
  if (erros.length) throw erroConfig(`Roteiro inválido: ${caminho}`, erros);
  return r;
}

export async function executarRoteiro(raiz, config, roteiro) {
  const nav = new Navegador({
    executavel: config.navegador.executavel,
    semJanela: config.navegador.semJanela,
    largura: config.navegador.largura,
    altura: config.navegador.altura,
    hostsPermitidos: config.navegador.hostsPermitidos,
    tempoLimiteMs: config.navegador.tempoLimiteMs,
  });
  const resultado = { roteiro: roteiro.nome, inicio: new Date().toISOString(), passos: [], aprovado: false };
  const ctx = { raiz };
  const segredos = new Set();
  const ocultar = (texto) => {
    if (typeof texto !== 'string') return texto;
    let t = texto;
    for (const v of segredos) t = t.split(v).join('<oculto>');
    return t;
  };
  try {
    await nav.iniciar();
    resultado.navegador = nav.produto;
    await nav.navegar(resolverVariaveis(roteiro.url, segredos));
    for (const [i, passo] of roteiro.passos.entries()) {
      const registro = { n: i + 1, acao: passo.acao, descricao: passo.descricao ?? null };
      const inicio = Date.now();
      try {
        const alvoId = async () => {
          await nav.estado();
          return localizarAlvo(nav.ultimosIds, passo.alvo ?? {});
        };
        let saida;
        switch (passo.acao) {
          case 'clicar':
            saida = await executarAcao(nav, 'clicar', { id: await alvoId(), aceitarDialogo: passo.aceitarDialogo === true }, ctx);
            break;
          case 'digitar':
            saida = await executarAcao(nav, 'digitar', { id: await alvoId(), texto: resolverVariaveis(passo.texto ?? '', segredos), enter: passo.enter === true }, ctx);
            break;
          case 'selecionar':
            saida = await executarAcao(nav, 'selecionar', { id: await alvoId(), opcao: passo.opcao ?? '' }, ctx);
            break;
          case 'esperarTexto':
            saida = await nav.esperarTexto(passo.texto ?? '', passo.ms ?? 10000);
            break;
          case 'verificarTexto': {
            const vis = await nav.textoVisivel();
            if (!vis.includes(dobrar(passo.texto ?? ''))) throw new BpErro(`Texto esperado ausente: "${passo.texto}"`, { codigo: SAIDA.FALHA });
            saida = '[ok] texto presente';
            break;
          }
          case 'verificarAusente': {
            const vis = await nav.textoVisivel();
            if (vis.includes(dobrar(passo.texto ?? ''))) throw new BpErro(`Texto proibido presente: "${passo.texto}"`, { codigo: SAIDA.FALHA });
            saida = '[ok] texto ausente';
            break;
          }
          case 'verificarElemento':
            saida = `[ok] elemento [${await alvoId()}] presente`;
            break;
          case 'verificarSemErrosConsole': {
            const erros = nav.relatorioConsole().filter((c) => /error|excecao|assert/.test(c.nivel));
            if (erros.length) throw new BpErro(`${erros.length} erro(s) no console; último: ${erros.at(-1).texto}`, { codigo: SAIDA.FALHA });
            saida = '[ok] console sem erros';
            break;
          }
          case 'verificarSemFalhasRede': {
            const { falhas, bloqueios } = nav.relatorioRede();
            if (falhas.length || bloqueios.length) throw new BpErro(`${falhas.length} falha(s) de rede e ${bloqueios.length} bloqueio(s); ${JSON.stringify(falhas.at(-1) ?? bloqueios.at(-1))}`, { codigo: SAIDA.FALHA });
            saida = '[ok] rede sem falhas';
            break;
          }
          case 'navegar':
            saida = await nav.navegar(resolverVariaveis(passo.url ?? '', segredos));
            break;
          case 'esperar':
            saida = await executarAcao(nav, 'esperar', { ms: passo.ms ?? 500 }, ctx);
            break;
          default:
            saida = await executarAcao(nav, passo.acao, { tecla: passo.tecla, direcao: passo.direcao, arquivo: passo.arquivo ?? `${roteiro.nome}-${i + 1}` }, ctx);
        }
        registro.ok = true;
        registro.saida = ocultar(typeof saida === 'string' ? saida : JSON.stringify(saida).slice(0, 300));
      } catch (e) {
        registro.ok = false;
        registro.erro = ocultar(e.message);
        registro.ms = Date.now() - inicio;
        resultado.passos.push(registro);
        // Evidência da falha: captura e estado compacto para diagnóstico sem rodar de novo.
        await nav.captura(join(pastaEstado(raiz, 'navegador', 'capturas'), `${roteiro.nome}-falha-${i + 1}.png`)).catch(() => {});
        resultado.estadoNaFalha = ocultar(await nav.estado({ maxCaracteres: 2500 }).catch(() => null));
        break;
      }
      registro.ms = Date.now() - inicio;
      resultado.passos.push(registro);
    }
    resultado.aprovado = resultado.passos.length === roteiro.passos.length && resultado.passos.every((p) => p.ok);
  } finally {
    resultado.console = nav.relatorioConsole().map((c) => ({ ...c, texto: ocultar(c.texto) })).filter((c) => /error|excecao|assert|warning/.test(c.nivel)).slice(-10);
    resultado.rede = nav.relatorioRede();
    await nav.fechar();
  }
  resultado.fim = new Date().toISOString();
  escreverJson(pastaEstado(raiz, 'navegador', 'roteiros', `${roteiro.nome}.json`), resultado);
  return resultado;
}
