// Máquina de estados da execução: demanda -> plano -> tarefas -> revisão -> validação.
// Fonte única de verdade em arquivos, para que cada etapa (sessão nova, contexto limpo)
// saiba exatamente o que fazer sem reler a conversa. É também o que os workflows do
// Kiro consultam por fileCheck em status.json.

import { existsSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pastaEstado } from '../core/config.mjs';
import { lerJson, escreverAtomico } from '../core/json.mjs';
import { comTrava } from '../core/trava.mjs';
import { escreverAssinado, lerAssinado, lerTestes } from './assinado.mjs';
import { validar } from '../core/esquema.mjs';
import { redigir } from '../core/sensiveis.mjs';
import { BpErro, SAIDA, erroConfig } from '../core/erros.mjs';
import { classificarTarefa, resolverModelo } from '../modelos/roteador.mjs';
import { registrarEvento } from './auditoria.mjs';

export const ESTADOS_TAREFA = Object.freeze(['pendente', 'em_andamento', 'concluida', 'bloqueada']);
const MAX_TENTATIVAS = 3;

const ESQUEMA_PLANO = {
  type: 'object',
  required: ['tarefas'],
  properties: {
    resumo: { type: 'string', maxLength: 4000 },
    premissas: { type: 'array', items: { type: 'string', maxLength: 1000 } },
    riscos: { type: 'array', items: { type: 'string', maxLength: 1000 } },
    temInterface: { type: 'boolean' },
    urlAplicacao: { type: 'string', maxLength: 500 },
    tarefas: {
      type: 'array',
      minItems: 1,
      maxItems: 60,
      items: {
        type: 'object',
        required: ['id', 'titulo', 'criterios'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,40}$' },
          titulo: { type: 'string', minLength: 3, maxLength: 300 },
          descricao: { type: 'string', maxLength: 6000 },
          tipo: { type: 'string', enum: ['backend', 'frontend', 'mecanica', 'teste', 'dados', 'infra', 'documentacao'] },
          arquivos: { type: 'array', maxItems: 80, items: { type: 'string', maxLength: 300 } },
          criterios: { type: 'array', minItems: 1, items: { type: 'string', maxLength: 1500 } },
          testes: { type: 'array', items: { type: 'string', maxLength: 1500 } },
          depende: { type: 'array', items: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,40}$' } },
          requisitos: { type: 'array', items: { type: 'string', maxLength: 40 } },
        },
      },
    },
  },
};

const dir = (raiz, ...p) => pastaEstado(raiz, 'execucao', ...p);
const arqExecucao = (raiz) => dir(raiz, 'execucao.json');
const arqStatus = (raiz) => dir(raiz, 'status.json');

export function carregarExecucao(raiz, { obrigatoria = true } = {}) {
  if (!existsSync(arqExecucao(raiz))) {
    if (!obrigatoria) return null;
    throw new BpErro('Nenhuma execução ativa. Rode: node .bp/bp.mjs exec iniciar --demanda "..."', { codigo: SAIDA.FALHA });
  }
  // Assinatura inválida = execução adulterada fora do BP: falha em vez de seguir com dado forjado.
  return lerAssinado(raiz, arqExecucao(raiz), 'execucao');
}

/** Executa ler-modificar-gravar da execução sob trava (subagentes e hooks em paralelo). */
function mutar(raiz, fn) {
  return comTrava(arqExecucao(raiz), () => fn());
}

export function calcularStatus(ex) {
  const pendentes = ex.tarefas.filter((t) => t.estado === 'pendente' || t.estado === 'em_andamento').length;
  return {
    id: ex.id,
    fase: ex.fase,
    planejada: ex.tarefas.length > 0,
    complete: ex.tarefas.length > 0 && pendentes === 0,
    pendentes,
    bloqueadas: ex.tarefas.filter((t) => t.estado === 'bloqueada').length,
    revisaoAprovada: ex.revisao?.aprovada === true,
    validada: ex.validacao?.aprovada === true,
  };
}

function salvar(raiz, ex) {
  ex.atualizadaEm = new Date().toISOString();
  escreverAssinado(raiz, arqExecucao(raiz), ex, 'execucao');
  // status.json é lido pelo fileCheck dos workflows do Kiro; a fonte de verdade é execucao.json assinado.
  const status = calcularStatus(ex);
  escreverAssinado(raiz, arqStatus(raiz), status, 'status');
  return status;
}

/** Inicia uma execução nova; a anterior é arquivada (nunca apagada). */
export function iniciarExecucao(raiz, { demanda, regras, layout, destino }) {
  if (!demanda || demanda.trim().length < 10) throw new BpErro('Descreva a demanda (mínimo de 10 caracteres)', { codigo: SAIDA.USO });
  if (existsSync(arqExecucao(raiz))) {
    const antiga = lerJson(arqExecucao(raiz));
    let destinoArquivo = `${dir(raiz)}-${String(antiga.id).replace(/[^\w-]/g, '_')}`;
    if (existsSync(destinoArquivo)) destinoArquivo += `-${Date.now()}`;
    escreverAtomico(join(dir(raiz), '.arquivado'), new Date().toISOString());
    renameSync(dir(raiz), destinoArquivo);
  }
  const ex = {
    id: `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8)}`,
    criadaEm: new Date().toISOString(),
    fase: 'planejamento',
    demanda: redigir(demanda.trim()),
    regrasNegocio: regras ? redigir(regras.trim()) : null,
    layout: layout ? redigir(layout.trim()) : null,
    destino: destino ?? null,
    tarefas: [],
    premissas: [],
    riscos: [],
  };
  escreverAtomico(dir(raiz, 'DEMANDA.md'), [
    `# Demanda ${ex.id}`, '', ex.demanda, '',
    '## Regras de negócio', '', ex.regrasNegocio ?? '_não informadas: o planejador registra premissas explícitas_', '',
    '## Layout e interface', '', ex.layout ?? '_não informado_', '',
    '## Destino', '', ex.destino ?? '_repositório atual_', '',
  ].join('\n'));
  const status = salvar(raiz, ex);
  registrarEvento(raiz, 'execucao.iniciada', { id: ex.id });
  return { execucao: ex, status };
}

function detectarCiclo(tarefas) {
  const porId = new Map(tarefas.map((t) => [t.id, t]));
  const visitando = new Set();
  const feito = new Set();
  const visitar = (id, caminho) => {
    if (feito.has(id)) return;
    if (visitando.has(id)) throw erroConfig(`Dependência circular no plano: ${[...caminho, id].join(' -> ')}`);
    visitando.add(id);
    for (const d of porId.get(id)?.depende ?? []) visitar(d, [...caminho, id]);
    visitando.delete(id);
    feito.add(id);
  };
  for (const t of tarefas) visitar(t.id, []);
}

/** Importa o plano escrito pelo planejador e roteia cada tarefa para papel/modelo. */
function _importarPlano(raiz, modelos, caminhoPlano) {
  const ex = carregarExecucao(raiz);
  const plano = lerJson(caminhoPlano, { limite: 2 * 1024 * 1024 });
  const erros = validar(ESQUEMA_PLANO, plano);
  if (erros.length) throw erroConfig('Plano inválido', erros);
  const ids = new Set();
  for (const t of plano.tarefas) {
    if (ids.has(t.id)) throw erroConfig(`ID de tarefa duplicado: ${t.id}`);
    ids.add(t.id);
  }
  for (const t of plano.tarefas) for (const d of t.depende ?? []) if (!ids.has(d)) throw erroConfig(`Tarefa ${t.id} depende de ${d}, que não existe`);
  detectarCiclo(plano.tarefas);
  ex.tarefas = plano.tarefas.map((t) => {
    const c = classificarTarefa({ descricao: `${t.titulo} ${t.descricao ?? ''} ${(t.criterios ?? []).join(' ')}`, arquivos: t.arquivos ?? [] });
    // Tipo declarado pelo planejador só reduz custo quando o risco não é alto.
    let papel = c.papel;
    if (c.risco !== 'alto' && t.tipo === 'mecanica') papel = 'executor-rapido';
    else if (c.risco !== 'alto' && t.tipo === 'teste') papel = 'testador';
    else if (c.risco === 'baixo' && t.tipo && t.tipo !== 'mecanica' && t.tipo !== 'documentacao') papel = 'executor';
    const rota = resolverModelo(modelos, papel, c.risco) ?? { papel, agente: `bp-${papel}`, modelo: null, esforco: null };
    return { ...t, estado: 'pendente', tentativas: 0, risco: c.risco, natureza: t.tipo ?? c.natureza, rota, motivosRisco: c.motivos };
  });
  ex.resumoPlano = plano.resumo ?? null;
  ex.premissas = plano.premissas ?? [];
  ex.riscos = plano.riscos ?? [];
  ex.temInterface = plano.temInterface === true;
  ex.urlAplicacao = plano.urlAplicacao ?? null;
  ex.fase = 'implementacao';
  const status = salvar(raiz, ex);
  registrarEvento(raiz, 'execucao.plano', { id: ex.id, tarefas: ex.tarefas.length });
  return { execucao: ex, status };
}

/** Próxima tarefa executável (dependências concluídas). Marca como em andamento. */
function _proximaTarefa(raiz) {
  const ex = carregarExecucao(raiz);
  const emAndamento = ex.tarefas.find((t) => t.estado === 'em_andamento');
  if (emAndamento) return { tarefa: emAndamento, retomada: true, status: salvar(raiz, ex) };
  const concluidas = new Set(ex.tarefas.filter((t) => t.estado === 'concluida').map((t) => t.id));
  const bloqueadas = new Set(ex.tarefas.filter((t) => t.estado === 'bloqueada').map((t) => t.id));
  for (const t of ex.tarefas) {
    if (t.estado !== 'pendente') continue;
    const deps = t.depende ?? [];
    if (deps.some((d) => bloqueadas.has(d))) {
      t.estado = 'bloqueada';
      t.motivoBloqueio = `depende de tarefa bloqueada (${deps.filter((d) => bloqueadas.has(d)).join(', ')})`;
      bloqueadas.add(t.id);
      continue;
    }
    if (deps.every((d) => concluidas.has(d))) {
      t.estado = 'em_andamento';
      t.iniciadaEm = new Date().toISOString();
      t.tentativas++;
      const status = salvar(raiz, ex);
      registrarEvento(raiz, 'tarefa.iniciada', { id: t.id, rota: t.rota });
      return { tarefa: t, retomada: false, status };
    }
  }
  return { tarefa: null, status: salvar(raiz, ex) };
}

/** Conclui a tarefa exigindo testes verdes registrados depois do início dela. */
function _concluirTarefa(raiz, id, { evidencia, semTestesJustificativa }) {
  const ex = carregarExecucao(raiz);
  // Só vale resultado de testes gravado e assinado pelo próprio BP.
  const ultimoTeste = semTestesJustificativa ? null : lerTestes(raiz);
  const t = ex.tarefas.find((x) => x.id === id);
  if (!t) throw new BpErro(`Tarefa não encontrada: ${id}`, { codigo: SAIDA.USO });
  if (t.estado !== 'em_andamento') throw new BpErro(`Tarefa ${id} não está em andamento (${t.estado})`, { codigo: SAIDA.FALHA });
  if (!semTestesJustificativa) {
    if (!ultimoTeste || ultimoTeste.semTestes) throw new BpErro('Sem resultado de testes. Rode "node .bp/bp.mjs testes" antes de concluir (ou justifique com --sem-testes)', { codigo: SAIDA.FALHA });
    if (!ultimoTeste.verde) throw new BpErro('Testes vermelhos: corrija antes de concluir a tarefa', { codigo: SAIDA.FALHA });
    if (t.iniciadaEm && ultimoTeste.geradoEm < t.iniciadaEm) throw new BpErro('O último resultado de testes é anterior ao início da tarefa: rode os testes de novo', { codigo: SAIDA.FALHA });
  } else {
    if (semTestesJustificativa.trim().length < 15) throw new BpErro('Justificativa de --sem-testes muito curta', { codigo: SAIDA.USO });
    // Sem testes só para documentação: código sempre passa pelo loop de testes.
    const soDocumentacao = t.tipo === 'documentacao' || (t.arquivos?.length > 0 && t.arquivos.every((a) => /\.(md|txt|adoc|rst)$/i.test(a)));
    if (!soDocumentacao) throw new BpErro(`--sem-testes só é aceito em tarefa de documentação; ${id} exige testes verdes`, { codigo: SAIDA.FALHA });
  }
  t.estado = 'concluida';
  t.concluidaEm = new Date().toISOString();
  t.evidencia = redigir(String(evidencia ?? '').slice(0, 2000));
  if (semTestesJustificativa) t.semTestes = redigir(semTestesJustificativa.slice(0, 500));
  const status = salvar(raiz, ex);
  registrarEvento(raiz, 'tarefa.concluida', { id, semTestes: Boolean(semTestesJustificativa) });
  return { tarefa: t, status };
}

/** Bloqueia ou devolve à fila (até MAX_TENTATIVAS); nunca para a execução inteira. */
function _falharTarefa(raiz, id, motivo) {
  const ex = carregarExecucao(raiz);
  const t = ex.tarefas.find((x) => x.id === id);
  if (!t) throw new BpErro(`Tarefa não encontrada: ${id}`, { codigo: SAIDA.USO });
  t.historicoFalhas = [...(t.historicoFalhas ?? []), redigir(String(motivo ?? '').slice(0, 1000))].slice(-5);
  t.estado = t.tentativas >= MAX_TENTATIVAS ? 'bloqueada' : 'pendente';
  if (t.estado === 'bloqueada') t.motivoBloqueio = `excedeu ${MAX_TENTATIVAS} tentativas`;
  const status = salvar(raiz, ex);
  registrarEvento(raiz, 'tarefa.falha', { id, estado: t.estado });
  return { tarefa: t, status };
}

const ESQUEMA_VALIDACAO = {
  type: 'object',
  required: ['criterios'],
  properties: {
    observacoes: { type: 'string', maxLength: 4000 },
    criterios: {
      type: 'array',
      minItems: 1,
      maxItems: 400,
      items: {
        type: 'object',
        required: ['tarefa', 'criterio', 'atendido', 'evidencia'],
        properties: {
          tarefa: { type: 'string', maxLength: 40 },
          criterio: { type: 'string', maxLength: 1500 },
          atendido: { type: 'boolean' },
          evidencia: { type: 'string', minLength: 5, maxLength: 1500 },
        },
      },
    },
  },
};

/** Validação final: cada critério de aceite de cada tarefa concluída precisa de evidência. */
function _registrarValidacao(raiz, caminho) {
  const ex = carregarExecucao(raiz);
  const v = lerJson(caminho, { limite: 2 * 1024 * 1024 });
  const erros = validar(ESQUEMA_VALIDACAO, v);
  if (erros.length) throw erroConfig('Validação inválida', erros);
  const esperados = ex.tarefas.filter((t) => t.estado === 'concluida').flatMap((t) => t.criterios.map((c) => ({ tarefa: t.id, criterio: c })));
  const cobertos = new Set(v.criterios.map((c) => `${c.tarefa}::${c.criterio.trim()}`));
  const semEvidencia = esperados.filter((e) => !cobertos.has(`${e.tarefa}::${e.criterio.trim()}`));
  const naoAtendidos = v.criterios.filter((c) => !c.atendido);
  ex.validacao = {
    aprovada: semEvidencia.length === 0 && naoAtendidos.length === 0 && ex.tarefas.every((t) => t.estado === 'concluida'),
    criterios: v.criterios.map((c) => ({ ...c, evidencia: redigir(c.evidencia) })),
    semEvidencia,
    naoAtendidos: naoAtendidos.map((c) => `${c.tarefa}: ${c.criterio}`),
    observacoes: redigir(v.observacoes ?? ''),
    em: new Date().toISOString(),
  };
  ex.fase = ex.validacao.aprovada ? 'concluida' : 'validacao';
  const status = salvar(raiz, ex);
  registrarEvento(raiz, 'execucao.validada', { aprovada: ex.validacao.aprovada, semEvidencia: semEvidencia.length, naoAtendidos: naoAtendidos.length });
  return { validacao: ex.validacao, status };
}

function _definirFase(raiz, fase, dados = {}) {
  const ex = carregarExecucao(raiz);
  ex.fase = fase;
  Object.assign(ex, dados);
  return salvar(raiz, ex);
}

/** Somente leitura: nunca regrava (evita desfazer atualização concorrente). */
export function statusExecucao(raiz) {
  const ex = carregarExecucao(raiz, { obrigatoria: false });
  if (!ex) return null;
  return { execucao: ex, status: calcularStatus(ex) };
}

export function listarHistorico(raiz) {
  const base = pastaEstado(raiz);
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((n) => n.startsWith('execucao-')).sort();
}

// Mutações sob trava: ler, modificar e gravar sem perder atualização concorrente.
export const importarPlano = (raiz, ...a) => mutar(raiz, () => _importarPlano(raiz, ...a));
export const proximaTarefa = (raiz, ...a) => mutar(raiz, () => _proximaTarefa(raiz, ...a));
export const concluirTarefa = (raiz, ...a) => mutar(raiz, () => _concluirTarefa(raiz, ...a));
export const falharTarefa = (raiz, ...a) => mutar(raiz, () => _falharTarefa(raiz, ...a));
export const registrarValidacao = (raiz, ...a) => mutar(raiz, () => _registrarValidacao(raiz, ...a));
export const definirFase = (raiz, ...a) => mutar(raiz, () => _definirFase(raiz, ...a));
