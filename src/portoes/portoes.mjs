// Portões determinísticos de qualidade e segurança. Rodam antes de qualquer revisão
// por LLM: o que um script verifica não deve consumir tokens de revisor.

import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { encontrarSegredos, encontrarPii, ehArquivoSensivel } from '../core/sensiveis.mjs';
import { casaAlgum } from '../core/glob.mjs';
import { avaliarLinha, CAMINHOS_GOVERNANCA, SEVERIDADES } from './regras.mjs';
import { ehRepositorio, arquivosAlterados, linhasAdicionadas, estatisticas } from './git.mjs';
import { varrer, ehBinario, tamanhoArquivo } from '../rag/varredura.mjs';
import { escreverAssinado, arquivoPortoes } from '../estado/assinado.mjs';
import { pastaEstado } from '../core/config.mjs';

const ARQUIVO_TESTE = /(^|\/)(tests?|__tests__|spec|specs|testes?|e2e|fixtures?|__fixtures__|mocks?)(\/|$)|\.(test|spec|e2e)\.[a-z]+$|Tests?\.(java|cs|kt)$|_test\.(go|py)$|^test_.*\.py$/i;
const LIMITE_ARQUIVO = 32 * 1024 * 1024;
const TAM_PEDACO = 4000;
const SOBREPOSICAO = 200;

/** Divide uma linha longa em pedaços com sobreposição: nada escapa por tamanho de linha. */
function pedacos(texto) {
  if (texto.length <= TAM_PEDACO) return [texto];
  const saida = [];
  for (let i = 0; i < texto.length; i += TAM_PEDACO - SOBREPOSICAO) saida.push(texto.slice(i, i + TAM_PEDACO));
  return saida;
}
const MAX_ACHADOS = 300;

const ordem = (s) => (s === 'suprimida' ? 99 : SEVERIDADES.indexOf(s));

/**
 * Supressão de arquivo inteiro: diretiva "bp-ignorar-arquivo: <justificativa>" nas 5 primeiras
 * linhas. Feita para catálogos de padrões (que contêm os textos que procuram). Fica no relatório.
 */
function supressaoDeArquivo(raiz, rel) {
  try {
    const inicio = readFileSync(join(raiz, rel), 'utf8').slice(0, 2048).split(/\r?\n/).slice(0, 5).join('\n');
    const m = inicio.match(/bp-ignorar-arquivo:\s*(.{20,200})$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/** Conteúdo para varredura. Arquivo com byte nulo é lido como latin1 (segredos ainda aparecem). */
function linhasDoArquivo(raiz, rel) {
  const abs = join(raiz, rel);
  const tam = tamanhoArquivo(abs);
  if (tam < 0) return null;
  if (tam > LIMITE_ARQUIVO) return { grande: true, tamanho: tam };
  const buf = readFileSync(abs);
  const binario = ehBinario(buf);
  const texto = binario ? buf.toString('latin1') : buf.toString('utf8');
  return { binario, linhas: texto.split(/\r?\n/).map((t, i) => ({ linha: i + 1, texto: t })) };
}

/**
 * Executa os portões. Opções: base (ref Git), tudo (varre o repositório inteiro).
 * Retorna { aprovado, modo, arquivos, contagem, achados, estatisticas }.
 */
export async function executarPortoes(raiz, config, { base, tudo = false } = {}) {
  const cfg = config.portoes;
  const repo = await ehRepositorio(raiz);
  const modo = tudo || !repo ? 'completo' : 'diferenca';
  let arquivos;
  let porArquivo = new Map();
  if (modo === 'diferenca') {
    arquivos = await arquivosAlterados(raiz, base);
    const { mapa } = await linhasAdicionadas(raiz, base, arquivos);
    porArquivo = mapa;
  } else {
    arquivos = varrer(raiz, { incluir: ['**/*'], excluir: config.rag.excluir }).arquivos;
  }
  const achados = [];
  const vistos = new Set();
  const registrar = (a) => {
    // Pedaços sobrepostos de linhas longas podem achar o mesmo item duas vezes.
    const chave = `${a.arquivo}|${a.linha}|${a.regra}|${a.mensagem}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    if (achados.length < MAX_ACHADOS || a.severidade === 'bloqueante') achados.push(a);
  };
  let analisados = 0;
  for (const rel of arquivos) {
    // "ignorar" dispensa só as regras de código; segredos e PII são sempre verificados.
    const ignorado = casaAlgum(rel, cfg.ignorar);
    if (ehArquivoSensivel(rel, casaAlgum)) {
      registrar({ arquivo: rel, linha: null, regra: 'arquivo-sensivel', severidade: modo === 'diferenca' ? 'bloqueante' : 'alta', mensagem: 'Arquivo de credencial/segredo presente no conjunto versionável.', correcao: 'Remova do repositório, inclua no .gitignore e rotacione o segredo se já foi publicado.' });
      continue;
    }
    if (casaAlgum(rel, CAMINHOS_GOVERNANCA) && modo === 'diferenca') {
      registrar({ arquivo: rel, linha: null, regra: 'governanca-alterada', severidade: 'alta', mensagem: 'Arquivo de governança do orquestrador alterado.', correcao: 'Mudanças em agentes, hooks, permissões e política exigem revisão humana.' });
    }
    let linhas = porArquivo.get(rel);
    let binario = false;
    if (!linhas) {
      const c = linhasDoArquivo(raiz, rel);
      if (!c) continue;
      if (c.grande) {
        registrar({ arquivo: rel, linha: null, regra: 'arquivo-nao-analisado', severidade: 'alta', mensagem: `Arquivo com ${Math.round(c.tamanho / 1048576)} MiB acima do limite de varredura.`, correcao: 'Arquivos desse tamanho não devem ser versionados; revise manualmente.' });
        continue;
      }
      linhas = c.linhas;
      binario = c.binario;
    }
    analisados++;
    const ext = extname(rel).toLowerCase();
    const teste = ARQUIVO_TESTE.test(rel);
    const supArquivo = supressaoDeArquivo(raiz, rel);
    for (const { linha, texto } of linhas) {
      if (!texto) continue;
      if (modo === 'diferenca' && /bp-ignorar(?:-arquivo)?:/i.test(texto)) {
        registrar({ arquivo: rel, linha, regra: 'supressao-adicionada', severidade: 'alta', mensagem: 'Supressão de portão adicionada nesta mudança.', correcao: 'Supressão exige aprovação humana explícita na revisão; prefira corrigir o achado.' });
      }
      for (const pedaco of pedacos(texto)) varrerPedaco(pedaco, linha);
    }
    function varrerPedaco(texto, linha) {
      if (cfg.bloquearSegredos) {
        for (const s of encontrarSegredos(texto)) {
          registrar({ arquivo: rel, linha, regra: `segredo:${s.regra}`, severidade: 'bloqueante', mensagem: `${s.descricao} (${s.previa})`, correcao: 'Remova o segredo; leia de variável de ambiente ou cofre corporativo e rotacione a credencial.' });
        }
      }
      if (cfg.bloquearPii) {
        for (const p of encontrarPii(texto)) {
          registrar({ arquivo: rel, linha, regra: `pii:${p.regra}`, severidade: teste ? 'media' : 'bloqueante', mensagem: `${p.descricao} em ${teste ? 'teste' : 'código'} (${p.previa})`, correcao: teste ? 'Prefira dados sintéticos gerados; nunca use dados reais de clientes (LGPD).' : 'Dado pessoal não pode estar no código-fonte (LGPD).' });
        }
      }
      if (binario || ignorado) return;
      for (const r of avaliarLinha(texto, ext)) {
        if (r.regra === 'pendencia' && teste) continue;
        // Supressão de arquivo vale só para regras de código; segredos e PII nunca são suprimidos.
        if (supArquivo && r.severidade !== 'suprimida') registrar({ arquivo: rel, linha, regra: r.regra, severidade: 'suprimida', mensagem: r.mensagem, justificativa: `arquivo: ${supArquivo}` });
        else registrar({ arquivo: rel, linha, ...r });
      }
    }
  }
  const contagem = Object.fromEntries([...SEVERIDADES, 'suprimida'].map((s) => [s, 0]));
  for (const a of achados) contagem[a.severidade] = (contagem[a.severidade] ?? 0) + 1;
  let est = null;
  if (modo === 'diferenca') {
    est = { arquivosAlterados: arquivos.length, ...(await estatisticas(raiz, base)) };
    if (est.arquivosAlterados > cfg.maxArquivosAlterados || est.adicionadas + est.removidas > cfg.maxLinhasAlteradas) {
      achados.push({ arquivo: null, linha: null, regra: 'mudanca-grande', severidade: 'alta', mensagem: `Mudança grande (${est.arquivosAlterados} arquivos, +${est.adicionadas}/-${est.removidas}).`, correcao: 'Divida em entregas menores e revisáveis.' });
      contagem.alta++;
    }
  }
  achados.sort((a, b) => ordem(a.severidade) - ordem(b.severidade) || String(a.arquivo).localeCompare(String(b.arquivo)) || (a.linha ?? 0) - (b.linha ?? 0));
  const resultado = { aprovado: contagem.bloqueante === 0, modo, base: modo === 'diferenca' ? base ?? 'HEAD' : null, analisados, contagem, estatisticas: est, achados, geradoEm: new Date().toISOString() };
  escreverAssinado(raiz, arquivoPortoes(raiz), resultado, 'portoes');
  return resultado;
}

/** Resumo enxuto para o agente (economia de tokens): só o que exige ação. */
export function resumirPortoes(r, max = 25) {
  const linhas = [`Portões: ${r.aprovado ? 'APROVADO' : 'REPROVADO'} (${r.modo}, ${r.analisados} arquivo(s))`];
  linhas.push(`bloqueante=${r.contagem.bloqueante} alta=${r.contagem.alta} media=${r.contagem.media} baixa=${r.contagem.baixa} suprimida=${r.contagem.suprimida}`);
  const relevantes = r.achados.filter((a) => a.severidade !== 'suprimida' && a.severidade !== 'baixa');
  for (const a of relevantes.slice(0, max)) {
    linhas.push(`- [${a.severidade}] ${a.arquivo ?? '(geral)'}${a.linha ? `:${a.linha}` : ''} ${a.regra}${a.cwe ? ` ${a.cwe}` : ''}: ${a.mensagem} -> ${a.correcao}`);
  }
  if (relevantes.length > max) linhas.push(`... +${relevantes.length - max} achado(s) em .bp/estado/portoes/ultimo.json`);
  return linhas.join('\n');
}
