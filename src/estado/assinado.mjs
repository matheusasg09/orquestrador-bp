// Leitura e escrita de estado assinado (ver core/integridade.mjs).

import { existsSync } from 'node:fs';
import { lerJson, escreverJson } from '../core/json.mjs';
import { assinar, assinaturaValida } from '../core/integridade.mjs';
import { pastaEstado } from '../core/config.mjs';
import { BpErro, SAIDA } from '../core/erros.mjs';

export function escreverAssinado(raiz, caminho, dados, contexto) {
  escreverJson(caminho, assinar(raiz, dados, contexto));
}

/**
 * Lê estado assinado. Ausente: devolve `padrao`. Assinatura inválida: lança erro
 * (estado adulterado é incidente, não "dado ausente").
 */
export function lerAssinado(raiz, caminho, contexto, { padrao = null } = {}) {
  if (!existsSync(caminho)) return padrao;
  const dados = lerJson(caminho);
  if (!assinaturaValida(raiz, dados, contexto)) {
    throw new BpErro(`Estado adulterado ou gravado fora do BP: ${caminho}. Trate como incidente.`, { codigo: SAIDA.BLOQUEIO });
  }
  const { _assinatura, ...limpo } = dados;
  void _assinatura;
  return limpo;
}

/** Como lerAssinado, mas devolve null quando adulterado (para hooks que não podem lançar). */
export function lerAssinadoOuNulo(raiz, caminho, contexto) {
  try {
    return lerAssinado(raiz, caminho, contexto);
  } catch {
    return null;
  }
}

export const arquivoTestes = (raiz) => pastaEstado(raiz, 'testes', 'ultimo.json');
export const arquivoPortoes = (raiz) => pastaEstado(raiz, 'portoes', 'ultimo.json');
export const lerTestes = (raiz) => lerAssinado(raiz, arquivoTestes(raiz), 'testes');
export const lerPortoes = (raiz) => lerAssinado(raiz, arquivoPortoes(raiz), 'portoes');
