// Disparo headless (CI ou terminal) de uma execução completa pelo Kiro CLI nativo.
// Usa só a interface oficial (kiro-cli chat --v3 --no-interactive): os Termos do Kiro
// proíbem harnesses de terceiros que levem requisições para fora das interfaces nativas.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { pastaEstado } from '../core/config.mjs';
import { localizarExecutavel } from '../core/processo.mjs';
import { relativoPosix } from '../core/caminhos.mjs';
import { resolverLeituraSegura } from '../core/leitura.mjs';
import { BpErro, SAIDA } from '../core/erros.mjs';

const WORKFLOWS = new Set(['bp-entrega', 'bp-correcao', 'bp-revisao']);

export function montarPrompt(raiz, { workflow, arquivos }) {
  const lista = Object.entries(arquivos).filter(([, v]) => v).map(([entrada, caminho]) => `- ${entrada}: conteúdo integral de ${relativoPosix(raiz, caminho)}`);
  return [
    `Inicie agora o workflow ${workflow} e conduza-o até o fim sem pedir nenhuma confirmação ou informação adicional.`,
    'Leia os arquivos abaixo e passe o conteúdo de cada um, sem resumir, como a entrada indicada (entrada sem arquivo: "não informado"):',
    ...lista,
    'Se o recurso de workflows não estiver disponível, execute o mesmo ciclo pelo seu protocolo de subagentes.',
    'Ao final, responda com o resumo de .bp/estado/execucao/RELATORIO.md.',
  ].join('\n');
}

export function iniciarHeadless(raiz, opcoes) {
  const kiro = localizarExecutavel('kiro-cli');
  if (!kiro) throw new BpErro('kiro-cli não encontrado. Instale o Kiro CLI pelo canal homologado.', { codigo: SAIDA.CONFIG });
  const workflow = opcoes.workflow ?? 'bp-entrega';
  if (!WORKFLOWS.has(workflow)) throw new BpErro(`Workflow inválido: ${workflow}`, { codigo: SAIDA.USO });
  const chave = workflow === 'bp-correcao' ? { problema: opcoes.demanda, evidencias: opcoes.regras } : workflow === 'bp-revisao' ? { escopo: opcoes.demanda } : { demanda: opcoes.demanda, regras: opcoes.regras, layout: opcoes.layout, destino: opcoes.destino };
  const arquivos = {};
  for (const [k, v] of Object.entries(chave)) {
    if (!v) continue;
    const { absoluto: abs } = resolverLeituraSegura(raiz, v, k);
    if (!existsSync(abs)) throw new BpErro(`Arquivo não encontrado para ${k}: ${v}`, { codigo: SAIDA.USO });
    arquivos[k] = abs;
  }
  if (!Object.keys(arquivos).length) throw new BpErro('Informe ao menos --demanda-arquivo', { codigo: SAIDA.USO });
  // Sem --trust-all-tools: em headless o Kiro trata "ask" como negação, então só roda o que as
  // regras allow dos agentes permitem (lista positiva). Sandbox obrigatório: sem ele, não começa.
  const args = ['chat', '--v3', '--no-interactive', '--agent', 'bp-orquestrador', '--sandbox', '--output-format', 'stream-json'];
  args.push(montarPrompt(raiz, { workflow, arquivos }));
  mkdirSync(pastaEstado(raiz, 'sessoes'), { recursive: true });
  const registro = pastaEstado(raiz, 'sessoes', `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const saida = createWriteStream(registro, { mode: 0o600 });
  return new Promise((resolver) => {
    const ehScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(kiro);
    if (ehScript) throw new BpErro('kiro-cli como script .cmd não é suportado pelo disparo seguro; use o executável.', { codigo: SAIDA.CONFIG });
    const filho = spawn(kiro, args, { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false, env: { ...process.env } });
    filho.stdout.pipe(saida);
    filho.stderr.on('data', (d) => process.stderr.write(d));
    let ultimo = '';
    filho.stdout.on('data', (d) => {
      ultimo = (ultimo + d.toString('utf8')).slice(-4000);
    });
    filho.on('close', (codigo) => {
      saida.end();
      resolver({ codigo: codigo ?? 1, registro: relativoPosix(raiz, registro), final: ultimo.split('\n').filter(Boolean).slice(-3).join('\n') });
    });
  });
}
