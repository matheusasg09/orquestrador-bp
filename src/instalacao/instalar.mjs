// Instalação do Orquestrador BP em um repositório alvo: copia o modelo (.kiro, .bp)
// e a ferramenta para .bp/ferramenta. Não sobrescreve nada sem --forcar (e, com ele,
// guarda cópia de segurança). Só pode ser executada por um humano em terminal.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escreverAtomico } from '../core/json.mjs';
import { paraPosix } from '../core/caminhos.mjs';
import { BpErro, SAIDA } from '../core/erros.mjs';

const RAIZ_PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELO = join(RAIZ_PACOTE, 'modelo');

export function exigirHumano(acao) {
  // Sem variável de escape: qualquer atalho por ambiente seria usável pelo próprio agente.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BpErro(`"${acao}" altera a governança do orquestrador e só pode ser executado por uma pessoa em um terminal interativo.`, { codigo: SAIDA.BLOQUEIO });
  }
}

function listarArquivos(base, rel = '') {
  const saida = [];
  for (const e of readdirSync(join(base, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) saida.push(...listarArquivos(base, r));
    else if (e.isFile()) saida.push(r);
  }
  return saida;
}

export function instalar(destino, { forcar = false } = {}) {
  const alvo = resolve(destino);
  if (!existsSync(alvo) || !statSync(alvo).isDirectory()) throw new BpErro(`Destino inexistente: ${alvo}`, { codigo: SAIDA.USO });
  if (alvo === RAIZ_PACOTE) throw new BpErro('O destino não pode ser o próprio pacote do orquestrador', { codigo: SAIDA.USO });
  const arquivos = listarArquivos(MODELO);
  const conflitos = arquivos.filter((f) => existsSync(join(alvo, f)));
  if (conflitos.length && !forcar) {
    throw new BpErro(`Arquivos já existem no destino (use --forcar para sobrescrever com backup):\n${conflitos.slice(0, 20).map((c) => `- ${c}`).join('\n')}`, { codigo: SAIDA.FALHA });
  }
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(alvo, '.bp', `backup-${carimbo}`);
  const relatorio = { copiados: [], substituidos: [], backup: null };
  for (const f of arquivos) {
    const de = join(MODELO, f);
    const para = join(alvo, f);
    if (existsSync(para)) {
      mkdirSync(dirname(join(backup, f)), { recursive: true });
      cpSync(para, join(backup, f));
      relatorio.substituidos.push(f);
      relatorio.backup = paraPosix(relative(alvo, backup));
    }
    mkdirSync(dirname(para), { recursive: true });
    cpSync(de, para);
    relatorio.copiados.push(f);
  }
  // Ferramenta: só código (bin, src), sem testes nem documentação.
  const ferramenta = join(alvo, '.bp', 'ferramenta');
  for (const pasta of ['bin', 'src']) cpSync(join(RAIZ_PACOTE, pasta), join(ferramenta, pasta), { recursive: true, force: true });
  cpSync(join(RAIZ_PACOTE, 'package.json'), join(ferramenta, 'package.json'), { force: true });
  if (existsSync(join(RAIZ_PACOTE, 'THIRD_PARTY_NOTICES.md'))) cpSync(join(RAIZ_PACOTE, 'THIRD_PARTY_NOTICES.md'), join(ferramenta, 'THIRD_PARTY_NOTICES.md'), { force: true });
  escreverAtomico(join(alvo, '.bp', 'bp.mjs'), "#!/usr/bin/env node\n// Ponto de entrada do Orquestrador BP neste repositório.\nawait import('./ferramenta/bin/bp.mjs');\n");
  const gi = join(alvo, '.gitignore');
  const atual = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const linhas = ['.bp/estado/', '.bp/backup-*/'];
  const faltando = linhas.filter((l) => !atual.split(/\r?\n/).includes(l));
  if (faltando.length) {
    appendFileSync(gi, `${atual && !atual.endsWith('\n') ? '\n' : ''}# Orquestrador BP: estado local (não versionar)\n${faltando.join('\n')}\n`);
    relatorio.gitignore = faltando;
  }
  return relatorio;
}
