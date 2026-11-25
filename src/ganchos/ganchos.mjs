// Manipuladores dos hooks do Kiro (.kiro/hooks/*.json). Cada hook chama
// `node .bp/bp.mjs gancho <tipo>` e recebe o evento em JSON pela entrada padrão.
// Contrato do Kiro (docs/hooks/types): PreToolUse com exit 2 bloqueia e devolve
// stderr ao modelo; Stop com {"decision":"block","reason":...} pede mais um turno;
// stdout de UserPromptSubmit/SessionStart/PostCompact entra no contexto.
// Regra de economia: em caso de sucesso sem nada a dizer, não escrever nada.

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { analisarJson, lerJson, escreverJson, escreverAtomico } from '../core/json.mjs';
import { estaDentro, analisarCaminho } from '../core/caminhos.mjs';
import { casaAlgum } from '../core/glob.mjs';
import { encontrarSegredos, encontrarPii, ehArquivoSensivel } from '../core/sensiveis.mjs';
import { pastaEstado } from '../core/config.mjs';
import { avaliarComando } from './guarda-shell.mjs';
import { lerAssinadoOuNulo, arquivoTestes } from '../estado/assinado.mjs';
import { registrarEvento } from '../estado/auditoria.mjs';
import { registrarConsumo } from '../tokens/razao.mjs';
import { statusExecucao } from '../estado/execucao.mjs';
import { gerarContexto } from '../rag/contexto.mjs';
import { caminhosIndice } from '../rag/indice.mjs';
import { avaliarLinha } from '../portoes/regras.mjs';
import { cortarParaOrcamento } from '../rag/texto.mjs';

/// Nomes da CLI V3 e variantes do IDE (que usa ferramentas próprias do editor).
const SHELL = /^(execute_bash|execute_pwsh|execute_cmd|run_command|executeBash|executePwsh|executeCommand|control_bash_process|control_pwsh_process|controlBashProcess|controlPwshProcess|shell|bash|powershell)$/i;
const ESCRITA = /^(fs_write|fs_append|str_replace|delete_file|write|create_file|edit_file|apply_patch|strReplace|fsWrite|fsAppend|deleteFile|smartRelocate|move_file|rename_file)$/i;
const ARQUIVO_TESTE = /(^|\/)(tests?|__tests__|spec|testes?|e2e|fixtures?)(\/|$)|\.(test|spec)\.[a-z]+$|Tests?\.(java|cs|kt)$|_test\.(go|py)$/i;
const CHAVES_CAMINHO = /^(path|paths|file|files|filePath|file_path|filePaths|target|targetFile|targetPath|destination|destinationPath|source|sourcePath|oldPath|newPath|from|to|dir|directory|caminho|arquivo|uri)$/i;
const LIMITE_CONTEUDO = 16 * 1024 * 1024;

/**
 * Escrita proibida ao agente: toda a governança e todo o estado do BP, exceto a área de
 * entrada (.bp/estado/entrada) e as specs do Kiro; Git interno; configurações de IDE e de CI
 * (podem executar comandos ao abrir a pasta ou no pipeline).
 */
const ESCRITA_PROIBIDA = [
  '.kiro/**', '.kiroignore', '.bp/**', '.git/**', '.gitattributes', '.gitmodules',
  '.vscode/**', '.idea/**', '.github/**', '.gitlab-ci.yml', '.gitlab/**', 'azure-pipelines*.yml', '.azure-pipelines/**',
  'Jenkinsfile', '.circleci/**', 'bitbucket-pipelines.yml', '.husky/**', '.pre-commit-config.yaml',
];
const ESCRITA_PERMITIDA_EXCECAO = ['.kiro/specs/**', '.bp/estado/entrada/**'];

function caminhosDaEntrada(entrada) {
  const caminhos = [];
  const visitar = (v, chave, nivel) => {
    if (nivel > 8) return;
    if (typeof v === 'string' && CHAVES_CAMINHO.test(chave ?? '')) caminhos.push(v.replace(/^file:\/\//i, ''));
    else if (Array.isArray(v)) v.forEach((x) => visitar(x, chave, nivel + 1));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visitar(x, k, nivel + 1);
  };
  visitar(entrada, null, 0);
  return caminhos;
}

function textosDaEntrada(entrada) {
  const textos = [];
  const visitar = (v, chave, nivel) => {
    if (nivel > 8) return;
    if (typeof v === 'string' && !CHAVES_CAMINHO.test(chave ?? '')) textos.push(v);
    else if (Array.isArray(v)) v.forEach((x) => visitar(x, chave, nivel + 1));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visitar(x, k, nivel + 1);
  };
  visitar(entrada, null, 0);
  return textos;
}

function bloquear(raiz, evento, motivo, alternativa) {
  try {
    registrarEvento(raiz, 'gancho.bloqueio', { ferramenta: evento.tool_name, motivo, sessao: evento.session_id });
  } catch {
    // auditoria indisponível não libera a ação: o bloqueio continua
  }
  return { codigo: 2, stderr: `[BP-GUARDA] Bloqueado: ${motivo}. ${alternativa ?? ''}`.trim() };
}

/** Classifica a chamada: o tipo explícito do hook (matcher) vence o nome da ferramenta. */
function tipoDaChamada(tipoHook, nome, entrada) {
  if (tipoHook === 'shell' || tipoHook === 'escrita' || tipoHook === 'leitura') return tipoHook;
  if (SHELL.test(nome) || typeof entrada.command === 'string') return 'shell';
  if (ESCRITA.test(nome)) return 'escrita';
  return caminhosDaEntrada(entrada).length ? 'leitura' : 'outro';
}

/** PreToolUse: guarda de shell, escrita e leitura. Qualquer dúvida bloqueia. */
export function preFerramenta(raiz, evento, tipoHook) {
  const nome = String(evento.tool_name ?? '');
  const entrada = evento.tool_input && typeof evento.tool_input === 'object' ? evento.tool_input : {};
  const tipo = tipoDaChamada(tipoHook, nome, entrada);
  if (tipo === 'shell') {
    const comando = typeof entrada.command === 'string' ? entrada.command : '';
    const r = avaliarComando(comando, raiz);
    if (r) return bloquear(raiz, evento, r.motivo, r.alternativa);
    for (const extra of ['cwd', 'working_directory', 'workingDirectory']) {
      if (typeof entrada[extra] === 'string' && !estaDentro(raiz, entrada[extra])) return bloquear(raiz, evento, 'diretório de execução fora do workspace', 'Execute comandos dentro do projeto.');
    }
    return { codigo: 0 };
  }
  if (tipo === 'outro') return { codigo: 0 };
  const caminhos = caminhosDaEntrada(entrada);
  if (tipo === 'escrita' && caminhos.length === 0) return bloquear(raiz, evento, 'escrita sem caminho identificável', 'Use as ferramentas de escrita com caminho explícito.');
  const base = typeof evento.cwd === 'string' && estaDentro(raiz, evento.cwd) ? evento.cwd : raiz;
  for (const bruto of caminhos) {
    const alvo = isAbsolute(bruto) ? bruto : resolve(base, bruto);
    const a = analisarCaminho(raiz, alvo);
    if (a.suspeita) return bloquear(raiz, evento, `caminho com forma ambígua (${a.suspeita}): ${bruto}`, 'Use o caminho normal do arquivo.');
    if (!a.dentro) return bloquear(raiz, evento, `${tipo === 'escrita' ? 'escrita' : 'leitura'} fora do workspace (${bruto})`, 'O agente trabalha somente dentro do projeto.');
    if (ehArquivoSensivel(a.relativo, casaAlgum)) return bloquear(raiz, evento, `acesso a arquivo de segredo (${a.relativo})`, 'Use arquivos de exemplo sem valores reais.');
    if (tipo === 'escrita' && casaAlgum(a.relativo, ESCRITA_PROIBIDA) && !casaAlgum(a.relativo, ESCRITA_PERMITIDA_EXCECAO)) {
      return bloquear(raiz, evento, `escrita em governança, estado do BP, Git ou configuração de IDE/CI (${a.relativo})`, 'Essas áreas só mudam pelos comandos do BP ou por revisão humana. Artefatos do agente vão em .bp/estado/entrada/.');
    }
  }
  if (tipo === 'escrita') {
    const textos = textosDaEntrada(entrada);
    const tamanho = textos.reduce((s, t) => s + t.length, 0);
    if (tamanho > LIMITE_CONTEUDO) return bloquear(raiz, evento, 'conteúdo grande demais para verificação', 'Divida a alteração em arquivos menores.');
    const teste = caminhos.every((c) => ARQUIVO_TESTE.test(c.replace(/\\/g, '/')));
    for (const texto of textos) {
      if (/bp-ignorar(?:-arquivo)?:/i.test(texto)) return bloquear(raiz, evento, 'inclusão de supressão dos portões (bp-ignorar)', 'Supressões são decisão humana registrada em revisão; corrija o achado em vez de suprimi-lo.');
      const segredos = encontrarSegredos(texto);
      if (segredos.length) return bloquear(raiz, evento, `conteúdo com segredo (${segredos[0].descricao})`, 'Leia segredos de variável de ambiente ou cofre; nunca grave no código.');
      if (!teste) {
        const pii = encontrarPii(texto);
        if (pii.length) return bloquear(raiz, evento, `conteúdo com dado pessoal (${pii[0].descricao})`, 'Não grave dados pessoais reais (LGPD). Em testes, use dados sintéticos.');
      }
    }
  }
  return { codigo: 0 };
}

/** PostToolUse: razão de tokens e alerta precoce de padrões inseguros no que foi escrito. */
export function posFerramenta(raiz, evento) {
  try {
    registrarConsumo(raiz, { sessao: evento.session_id, ferramenta: evento.tool_name, entrada: evento.tool_input, saida: evento.tool_response });
  } catch {
    // razão de tokens é informativa
  }
  if (!ESCRITA.test(String(evento.tool_name ?? ''))) return { codigo: 0 };
  const alvo = caminhosDaEntrada(evento.tool_input ?? {})[0];
  if (!alvo) return { codigo: 0 };
  const ext = (alvo.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '').toLowerCase();
  const avisos = [];
  for (const texto of textosDaEntrada(evento.tool_input ?? {})) {
    texto.split(/\r?\n/).forEach((linha, i) => {
      for (const a of avaliarLinha(linha, ext)) if (a.severidade === 'bloqueante' || a.severidade === 'alta') avisos.push(`${a.regra} (linha ~${i + 1}): ${a.mensagem} ${a.correcao}`);
    });
  }
  if (!avisos.length) return { codigo: 0 };
  return { codigo: 0, stdout: `[BP] Atenção em ${alvo}:\n- ${avisos.slice(0, 5).join('\n- ')}${avisos.length > 5 ? `\n- ... +${avisos.length - 5}` : ''}\nCorrija agora: o portão final reprova esses padrões.` };
}

function resumoExecucao(raiz) {
  const s = statusExecucao(raiz);
  if (!s) return null;
  const ex = s.execucao;
  const andamento = ex.tarefas.find((t) => t.estado === 'em_andamento');
  const partes = [`[BP] Execução ${ex.id} | fase: ${ex.fase} | tarefas: ${ex.tarefas.filter((t) => t.estado === 'concluida').length}/${ex.tarefas.length} concluídas, ${s.status.bloqueadas} bloqueada(s)`];
  if (andamento) partes.push(`Tarefa em andamento: ${andamento.id} - ${andamento.titulo}`);
  return partes.join('\n');
}

/** UserPromptSubmit: injeta contexto RAG enxuto e o estado da execução. */
export async function aoEnviarPrompt(raiz, config, evento) {
  const prompt = String(evento.prompt ?? '');
  const partes = [];
  const resumo = resumoExecucao(raiz);
  if (resumo) partes.push(resumo);
  if (config.ganchos.contextoNoPrompt && prompt.trim().length >= 20 && existsSync(caminhosIndice(raiz).manifesto)) {
    try {
      const pacote = await gerarContexto(raiz, config, prompt, { orcamento: config.tokens.orcamentoGancho, k: 8 });
      if (pacote.itens.length) partes.push(pacote.markdown);
    } catch {
      // sem índice utilizável: segue sem contexto extra
    }
  }
  return { codigo: 0, stdout: partes.length ? partes.join('\n\n') : undefined };
}

/** SessionStart: orientação mínima (o restante vem por steering/skills sob demanda). */
export function aoIniciarSessao(raiz) {
  const resumo = resumoExecucao(raiz);
  return { codigo: 0, stdout: resumo ? `${resumo}\nUse "node .bp/bp.mjs exec status" para detalhes.` : undefined };
}

/**
 * Stop: impede encerrar o turno com tarefa em andamento e testes vermelhos ou não
 * executados depois do início da tarefa. Limitado por sessão para não criar laço infinito.
 */
export function aoParar(raiz, config, evento) {
  const s = statusExecucao(raiz);
  if (!s) return { codigo: 0 };
  const t = s.execucao.tarefas.find((x) => x.estado === 'em_andamento');
  if (!t) return { codigo: 0 };
  const testes = lerAssinadoOuNulo(raiz, arquivoTestes(raiz), 'testes');
  let motivo = null;
  if (!testes || testes.geradoEm < t.iniciadaEm) motivo = `A tarefa ${t.id} está em andamento e os testes não foram executados depois do início dela. Rode "node .bp/bp.mjs testes", corrija o que falhar e conclua com "node .bp/bp.mjs exec concluir ${t.id} --evidencia ...".`;
  else if (!testes.verde && !testes.semTestes) motivo = `Os testes estão vermelhos na tarefa ${t.id}. Corrija as falhas (veja "node .bp/bp.mjs testes") antes de encerrar. Se não houver solução após 3 tentativas, registre com "node .bp/bp.mjs exec falhar ${t.id} --motivo ...".`;
  if (!motivo) return { codigo: 0 };
  const sessao = String(evento.session_id ?? 'sem-sessao').replace(/[^\w-]/g, '_').slice(0, 80);
  const arq = pastaEstado(raiz, 'ganchos', `parada-${sessao}.json`);
  const contador = lerJson(arq, { padrao: { n: 0 } });
  if (contador.n >= config.ganchos.maxContinuacoesParada) return { codigo: 0 };
  contador.n++;
  escreverJson(arq, contador);
  return { codigo: 0, stdout: JSON.stringify({ decision: 'block', reason: motivo }) };
}

/** SubagentStop: registra no razão de tokens o tamanho da resposta devolvida ao pai. */
export function aoPararSubagente(raiz, evento) {
  try {
    registrarConsumo(raiz, { sessao: evento.session_id, agente: evento.agent_name, ferramenta: 'subagente', entrada: '', saida: evento.last_assistant_message ?? '' });
  } catch {
    // informativo
  }
  return { codigo: 0 };
}

/** PreCompact/PostCompact: preserva o essencial da execução através da compactação. */
export function aoCompactar(raiz, fase) {
  const s = statusExecucao(raiz);
  if (!s) return { codigo: 0 };
  const ex = s.execucao;
  const linhas = [
    `[BP] Preserve após a compactação: execução ${ex.id}, fase ${ex.fase}.`,
    `Demanda: ${ex.demanda.slice(0, 600)}`,
    ...ex.tarefas.filter((t) => t.estado !== 'concluida').slice(0, 10).map((t) => `- ${t.id} [${t.estado}] ${t.titulo}`),
    'Fonte de verdade: .bp/estado/execucao/ (DEMANDA.md, execucao.json, CORRECOES.md). Releia de lá em vez de confiar no resumo.',
  ];
  const texto = cortarParaOrcamento(linhas.join('\n'), 700).texto;
  if (fase === 'pre') escreverAtomico(pastaEstado(raiz, 'compactacao', `${Date.now()}.md`), `${texto}\n`);
  return { codigo: 0, stdout: texto };
}

const TIPOS_PRE = { 'pre-ferramenta': null, 'pre-shell': 'shell', 'pre-escrita': 'escrita', 'pre-leitura': 'leitura' };
const BLOQUEIO_FALHA = { codigo: 2, stderr: '[BP-GUARDA] Falha ao verificar a ação; bloqueada por segurança.' };

/** Despacho dos hooks. Para PreToolUse, qualquer erro (evento ilegível, exceção) bloqueia. */
export async function executarGancho(raiz, config, tipo, textoEntrada) {
  const pre = Object.hasOwn(TIPOS_PRE, tipo);
  let evento = {};
  if (textoEntrada && textoEntrada.trim()) {
    try {
      evento = analisarJson(textoEntrada, 'evento do hook');
    } catch {
      return pre ? { codigo: 2, stderr: '[BP-GUARDA] Evento do hook ilegível; ação bloqueada por segurança.' } : { codigo: 0 };
    }
  } else if (pre) {
    return { codigo: 2, stderr: '[BP-GUARDA] Evento do hook vazio; ação bloqueada por segurança.' };
  }
  if (pre) {
    try {
      return preFerramenta(raiz, evento, TIPOS_PRE[tipo]);
    } catch {
      return BLOQUEIO_FALHA;
    }
  }
  switch (tipo) {
    case 'pos-ferramenta':
      return posFerramenta(raiz, evento);
    case 'prompt':
      return aoEnviarPrompt(raiz, config, evento);
    case 'inicio-sessao':
      return aoIniciarSessao(raiz);
    case 'parada':
      return aoParar(raiz, config, evento);
    case 'subagente-parada':
      return aoPararSubagente(raiz, evento);
    case 'pre-compactacao':
      return aoCompactar(raiz, 'pre');
    case 'pos-compactacao':
      return aoCompactar(raiz, 'pos');
    default:
      return { codigo: 64, stderr: `Tipo de gancho desconhecido: ${tipo}` };
  }
}
