// Validação da configuração do Kiro gerada pelo BP (agentes, hooks, workflows,
// settings) e aplicação da política de modelos como fonte única de verdade.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerJson, escreverJson } from '../core/json.mjs';
import { avaliarModelo, ESFORCOS } from '../modelos/politica.mjs';

export const GATILHOS = Object.freeze(['UserPromptSubmit', 'Stop', 'SubagentStop', 'SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostFileCreate', 'PostFileSave', 'PostFileDelete', 'PreTaskExec', 'PostTaskExec']);
export const AGENTES_EMBUTIDOS_WORKFLOW = Object.freeze(['wf-planner', 'wf-coder', 'wf-design', 'wf-design-reviewer', 'wf-review-aggregator', 'wf-pr-submitter', 'wf-pr-responder', 'wf-auto-researcher', 'semantic_reviewer']);
const FERRAMENTAS_PROIBIDAS = new Set(['*', '@builtin', '@mcp', 'web', 'web_fetch', 'web_search', 'remote_web_search', '@powers']);

/** Mapa agente -> papel (o nome do arquivo é bp-<papel>.json). */
export function papelDoAgente(nome) {
  return nome.startsWith('bp-') ? nome.slice(3) : null;
}

export function listarAgentes(raiz) {
  const dir = join(raiz, '.kiro', 'agents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ arquivo: join(dir, f), nome: f.replace(/\.json$/, ''), dados: lerJson(join(dir, f)) }));
}

/** Valida um agente do BP. Retorna lista de problemas. */
export function validarAgente(raiz, agente, modelos) {
  const p = [];
  const a = agente.dados;
  if (a.name !== agente.nome) p.push(`name "${a.name}" difere do arquivo`);
  if (!a.description || a.description.length < 20) p.push('description ausente ou curta (o Kiro escolhe subagentes por ela)');
  if ('hooks' in a) p.push('campo hooks no agente faz o IDE ignorar o agente inteiro; use .kiro/hooks/*.json');
  if (a.mcpServers && Object.keys(a.mcpServers).length) p.push('mcpServers proibido (ambiente sem MCP)');
  if (a.includeMcpJson !== false) p.push('includeMcpJson deve ser false');
  if (a.includePowers !== false) p.push('includePowers deve ser false');
  for (const t of a.tools ?? []) if (FERRAMENTAS_PROIBIDAS.has(t) || String(t).startsWith('@')) p.push(`ferramenta proibida em tools: ${t}`);
  if (!(a.excludedTools ?? []).includes('web')) p.push('excludedTools deve conter "web"');
  const regras = a.permissions?.rules ?? [];
  for (const cap of ['web_fetch', 'web_search', 'mcp', 'power']) {
    if (!regras.some((r) => r.capability === cap && r.effect === 'deny')) p.push(`falta regra deny para ${cap}`);
  }
  if (typeof a.prompt === 'string' && a.prompt.startsWith('file://')) {
    const rel = a.prompt.slice('file://'.length);
    if (!existsSync(join(raiz, '.kiro', 'agents', rel))) p.push(`prompt não encontrado: ${rel}`);
  }
  for (const r of a.resources ?? []) {
    if (typeof r === 'string' && r.startsWith('file://')) {
      const rel = r.slice('file://'.length);
      if (!rel.includes('*') && !existsSync(join(raiz, rel))) p.push(`resource não encontrado: ${rel}`);
    }
  }
  if (!a.model) p.push('model ausente');
  else if (modelos) {
    const motivos = avaliarModelo(a.model, modelos.politica);
    if (motivos.length) p.push(`modelo ${a.model}: ${motivos.join('; ')}`);
    const papel = papelDoAgente(agente.nome);
    if (papel && modelos.papeis[papel] && modelos.papeis[papel].modelo !== a.model) p.push(`modelo difere da política (${modelos.papeis[papel].modelo}); rode "modelos aplicar"`);
  }
  return p;
}

export function validarHooks(raiz) {
  const dir = join(raiz, '.kiro', 'hooks');
  const problemas = [];
  if (!existsSync(dir)) return ['pasta .kiro/hooks ausente'];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let h;
    try {
      h = lerJson(join(dir, f));
    } catch (e) {
      problemas.push(`${f}: ${e.message}`);
      continue;
    }
    if (h.version !== 'v1') problemas.push(`${f}: version deve ser "v1"`);
    if (!Array.isArray(h.hooks) || !h.hooks.length) problemas.push(`${f}: hooks vazio`);
    for (const k of h.hooks ?? []) {
      if (!k.name) problemas.push(`${f}: hook sem name`);
      if (!GATILHOS.includes(k.trigger)) problemas.push(`${f}/${k.name}: gatilho desconhecido ${k.trigger}`);
      if (k.action?.type === 'command' && !/^node \.bp\/bp\.mjs gancho [a-z-]+$/.test(k.action.command ?? '')) problemas.push(`${f}/${k.name}: comando fora do padrão do BP`);
      if (k.action?.type === 'agent') problemas.push(`${f}/${k.name}: ação "agent" consome créditos a cada disparo; prefira "command"`);
    }
  }
  return problemas;
}

function profundidadeEPassos(nos, nivel = 1, acc = { passos: 0, prof: 0, ids: [] }) {
  acc.prof = Math.max(acc.prof, nivel);
  for (const n of nos ?? []) {
    acc.ids.push(n.id);
    if (n.type === 'step') acc.passos++;
    if (n.steps) profundidadeEPassos(n.steps, nivel + 1, acc);
    if (n.branches) profundidadeEPassos(n.branches, nivel + 1, acc);
  }
  return acc;
}

/** Validação estrutural local (complementa o validate_workflow do Kiro). */
export function validarWorkflow(raiz, arquivo, agentesExistentes) {
  const p = [];
  const w = lerJson(arquivo);
  if (!w.name) p.push('name ausente');
  if (!Array.isArray(w.steps) || !w.steps.length) p.push('steps vazio');
  const { passos, prof, ids } = profundidadeEPassos(w.steps);
  if (passos > 50) p.push(`mais de 50 steps (${passos})`);
  if (prof > 8) p.push(`profundidade maior que 8 (${prof})`);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) p.push(`ids duplicados: ${[...new Set(dup)].join(', ')}`);
  const entradas = new Set(Object.keys(w.inputs ?? {}));
  const visitar = (nos, anteriores) => {
    const vistos = new Set(anteriores);
    for (const n of nos ?? []) {
      if (!n.id || !n.type) p.push('nó sem id ou type');
      if (n.type === 'step') {
        if (!n.agent || !n.prompt) p.push(`${n.id}: step exige agent e prompt`);
        if (n.agent && !agentesExistentes.has(n.agent) && !AGENTES_EMBUTIDOS_WORKFLOW.includes(n.agent)) p.push(`${n.id}: agente inexistente ${n.agent}`);
        if (n.effortLevel && !ESFORCOS.includes(n.effortLevel)) p.push(`${n.id}: effortLevel inválido`);
        for (const m of String(n.prompt ?? '').matchAll(/\{\{([^}]+)\}\}/g)) {
          const ref = m[1].trim();
          if (ref === 'previous.output' || ref.startsWith('artifacts.')) continue;
          const [id, campo] = ref.split('.');
          if (campo === 'output') {
            if (!vistos.has(id)) p.push(`${n.id}: referência {{${ref}}} a etapa que não roda antes`);
          } else if (!entradas.has(ref)) p.push(`${n.id}: variável {{${ref}}} não declarada em inputs`);
        }
      }
      if (n.type === 'repeat') {
        if (!Number.isInteger(n.maxIterations) || n.maxIterations < 1) p.push(`${n.id}: repeat exige maxIterations finito`);
        if (!['abort', 'continue', 'pause'].includes(n.onMaxIterations)) p.push(`${n.id}: onMaxIterations inválido`);
        if (n.stopCondition && n.stopWhen) p.push(`${n.id}: use stopCondition ou stopWhen, não ambos`);
        const jp = n.stopCondition?.fileCheck?.jsonPath;
        if (jp && /[[\]*]|\.\./.test(jp)) p.push(`${n.id}: jsonPath com sintaxe não suportada`);
      }
      if (n.type === 'parallel' && !['all', 'allSettled', 'any'].includes(n.joinPolicy)) p.push(`${n.id}: joinPolicy inválido`);
      if (n.type === 'watch' && n.handler === 'command' && /\{\{/.test(n.config?.command ?? '')) p.push(`${n.id}: template proibido em command`);
      if (n.steps) visitar(n.steps, vistos);
      if (n.branches) for (const b of n.branches) visitar([b], vistos);
      vistos.add(n.id);
    }
  };
  visitar(w.steps, []);
  return { nome: w.name, problemas: p, passos };
}

export function listarWorkflows(raiz) {
  const dir = join(raiz, '.kiro', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.workflow.json')).map((f) => join(dir, f));
}

/** Aplica modelos.json em agentes, workflows e chat.modelDefaults. Retorna a lista de alterações. */
export function aplicarModelos(raiz, modelos) {
  const alteracoes = [];
  const porAgente = new Map();
  for (const ag of listarAgentes(raiz)) {
    const papel = papelDoAgente(ag.nome);
    const cfg = papel && modelos.papeis[papel];
    if (!cfg) continue;
    porAgente.set(ag.nome, cfg);
    if (ag.dados.model !== cfg.modelo) {
      alteracoes.push(`${ag.nome}: model ${ag.dados.model} -> ${cfg.modelo}`);
      escreverJson(ag.arquivo, { ...ag.dados, model: cfg.modelo });
    }
  }
  for (const arq of listarWorkflows(raiz)) {
    const w = lerJson(arq);
    let mudou = false;
    const visitar = (nos) => {
      for (const n of nos ?? []) {
        if (n.type === 'step' && porAgente.has(n.agent)) {
          const cfg = porAgente.get(n.agent);
          // Sem campos extras no recipe: o validador do Kiro rejeita chaves desconhecidas.
          const alvo = { modelo: cfg.modelo, esforco: cfg.esforco };
          if (n.modelId !== alvo.modelo || n.effortLevel !== alvo.esforco) {
            n.modelId = alvo.modelo;
            n.effortLevel = alvo.esforco;
            mudou = true;
          }
        }
        visitar(n.steps);
        visitar(n.branches);
      }
    };
    visitar(w.steps);
    if (mudou) {
      escreverJson(arq, w);
      alteracoes.push(`${arq.split(/[/\\]/).pop()}: modelId/effortLevel atualizados`);
    }
  }
  const cli = join(raiz, '.kiro', 'settings', 'cli.json');
  const atual = existsSync(cli) ? lerJson(cli) : {};
  const defaults = {};
  // Esforço base por modelo: o menor esforço entre os papéis que usam o modelo (o
  // workflow eleva por etapa). Economiza tokens em chamadas fora do workflow.
  const ordem = (e) => ESFORCOS.indexOf(e);
  for (const cfg of Object.values(modelos.papeis)) {
    const anterior = defaults[cfg.modelo]?.output_config?.effort ?? defaults[cfg.modelo]?.reasoning?.effort;
    if (anterior && ordem(anterior) <= ordem(cfg.esforco)) continue;
    defaults[cfg.modelo] = cfg.modelo.startsWith('gpt-') ? { reasoning: { effort: cfg.esforco } } : { output_config: { effort: cfg.esforco } };
  }
  if (JSON.stringify(atual['chat.modelDefaults']) !== JSON.stringify(defaults)) {
    escreverJson(cli, { ...atual, 'chat.modelDefaults': defaults });
    alteracoes.push('.kiro/settings/cli.json: chat.modelDefaults atualizado');
  }
  return alteracoes;
}

export function lerTexto(caminho) {
  return readFileSync(caminho, 'utf8');
}
