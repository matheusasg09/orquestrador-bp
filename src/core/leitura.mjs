// Leitura segura de arquivos indicados por agente (argumentos da CLI): caminho canônico,
// dentro do projeto, sem forma ambígua e nunca um arquivo de segredo.

import { resolverConfinado, analisarCaminho } from './caminhos.mjs';
import { casaAlgum } from './glob.mjs';
import { ehArquivoSensivel } from './sensiveis.mjs';
import { BpErro, SAIDA } from './erros.mjs';

export function resolverLeituraSegura(raiz, caminho, rotulo = 'arquivo') {
  const abs = resolverConfinado(raiz, caminho, rotulo);
  const { relativo } = analisarCaminho(raiz, abs);
  if (ehArquivoSensivel(relativo, casaAlgum)) throw new BpErro(`${rotulo} recusado: arquivo de segredo (${relativo})`, { codigo: SAIDA.BLOQUEIO });
  return { absoluto: abs, relativo };
}
