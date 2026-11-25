// Diagnóstico do ambiente e da configuração. Somente leitura.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { executar, localizarExecutavel } from '../core/processo.mjs';
import { carregarConfig } from '../core/config.mjs';
import { lerJson } from '../core/json.mjs';
import { carregarModelos, validarPapeis } from '../modelos/politica.mjs';
import { localizarNavegador } from '../navegador/localizar.mjs';
import { listarAgentes, validarAgente, validarHooks, listarWorkflows, validarWorkflow } from './kiro.mjs';
import { caminhosIndice } from '../rag/indice.mjs';
import { verificarAuditoria } from '../estado/auditoria.mjs';
import { arquivoChave } from '../core/integridade.mjs';
import { estaDentro } from '../core/caminhos.mjs';

function item(ok, titulo, detalhe, nivel = ok ? 'ok' : 'erro') {
  return { ok, nivel, titulo, detalhe };
}

/** Lista de IDs de modelos que o Kiro CLI informa (se instalado e autenticado). */
export async function modelosDoKiro(raiz) {
  if (!localizarExecutavel('kiro-cli')) return null;
  const r = await executar(['kiro-cli', 'chat', '--list-models', '--format', 'json'], { cwd: raiz, tempoLimiteMs: 30000 }).catch(() => null);
  if (!r || r.codigo !== 0) return null;
  const ids = new Set();
  try {
    const visitar = (v) => {
      if (Array.isArray(v)) v.forEach(visitar);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (/^(id|model_?id|modelId|name)$/i.test(k) && typeof x === 'string' && /^[a-z0-9.-]+$/.test(x)) ids.add(x);
          else visitar(x);
        }
      }
    };
    visitar(JSON.parse(r.stdout));
  } catch {
    return null;
  }
  return [...ids];
}

export async function diagnosticar(raiz, { consultarKiro = true } = {}) {
  const itens = [];
  const [maior, menor] = process.versions.node.split('.').map(Number);
  itens.push(item(maior > 20 || (maior === 20 && menor >= 11), `Node.js ${process.versions.node}`, 'Requer Node 20.11 ou superior (sem dependências npm).'));
  const kiro = localizarExecutavel('kiro-cli');
  let versaoKiro = null;
  if (kiro) {
    const r = await executar(['kiro-cli', '--version'], { tempoLimiteMs: 15000 }).catch(() => null);
    versaoKiro = r?.stdout.trim() || null;
  }
  itens.push(item(Boolean(kiro), `Kiro CLI ${versaoKiro ?? 'não encontrado'}`, kiro ? 'Use sempre --v3 em execuções headless.' : 'Opcional para o IDE; necessário para o modo headless (bp-iniciar).', kiro ? 'ok' : 'aviso'));
  itens.push(item(Boolean(localizarExecutavel('git')), 'Git', 'Necessário para portões por diferença; sem Git os portões varrem tudo.', localizarExecutavel('git') ? 'ok' : 'aviso'));
  let config;
  try {
    config = carregarConfig(raiz);
    itens.push(item(true, 'Configuração .bp/config.json', 'válida'));
  } catch (e) {
    itens.push(item(false, 'Configuração .bp/config.json', `${e.message}${e.detalhes ? `: ${e.detalhes.join('; ')}` : ''}`));
  }
  const nav = localizarNavegador(config?.navegador.executavel);
  itens.push(item(Boolean(nav), `Navegador ${nav ?? 'não encontrado'}`, 'Chrome ou Edge já instalados; o BP nunca baixa navegador.', nav ? 'ok' : 'aviso'));
  let modelos = null;
  try {
    modelos = carregarModelos(raiz);
    const v = validarPapeis(modelos);
    itens.push(item(v.ok, 'Política de modelos .bp/modelos.json', v.ok ? 'todos os papéis com modelo permitido' : v.problemas.map((p) => `${p.papel}/${p.modelo}: ${p.motivos.join('; ')}`).join(' | ')));
  } catch (e) {
    itens.push(item(false, 'Política de modelos .bp/modelos.json', e.message));
  }
  if (modelos && consultarKiro) {
    const disponiveis = await modelosDoKiro(raiz);
    if (disponiveis?.length) {
      const usados = [...new Set(Object.values(modelos.papeis).flatMap((p) => [p.modelo, p.escalonar?.modelo, p.rebaixar?.modelo]).filter(Boolean))];
      const faltando = usados.filter((m) => !disponiveis.includes(m));
      itens.push(item(!faltando.length, 'Modelos disponíveis na conta Kiro', faltando.length ? `não disponíveis: ${faltando.join(', ')} (o primeiro prompt falharia)` : `${usados.length} modelo(s) confirmados`));
    } else {
      itens.push(item(true, 'Modelos disponíveis na conta Kiro', 'não foi possível consultar (kiro-cli ausente ou sem login); confirme com "kiro-cli chat --list-models"', 'aviso'));
    }
  }
  const agentes = listarAgentes(raiz);
  itens.push(item(agentes.length > 0, `Agentes Kiro (${agentes.length})`, agentes.length ? 'em .kiro/agents' : 'nenhum agente; rode a instalação'));
  for (const a of agentes) {
    const p = validarAgente(raiz, a, modelos);
    if (p.length) itens.push(item(false, `Agente ${a.nome}`, p.join('; ')));
  }
  const h = validarHooks(raiz);
  itens.push(item(h.length === 0, 'Hooks .kiro/hooks', h.length ? h.join('; ') : 'válidos'));
  const nomes = new Set(agentes.map((a) => a.nome));
  for (const w of listarWorkflows(raiz)) {
    const r = validarWorkflow(raiz, w, nomes);
    itens.push(item(r.problemas.length === 0, `Workflow ${r.nome} (${r.passos} steps)`, r.problemas.length ? r.problemas.join('; ') : 'estrutura válida (confirme com validate_workflow no Kiro)'));
  }
  const mcp = join(raiz, '.kiro', 'settings', 'mcp.json');
  if (existsSync(mcp)) {
    const m = lerJson(mcp, { padrao: {} });
    const n = Object.keys(m.mcpServers ?? {}).length;
    itens.push(item(n === 0, 'MCP', n ? `${n} servidor(es) em .kiro/settings/mcp.json: proibido neste ambiente` : 'nenhum servidor'));
  } else itens.push(item(true, 'MCP', 'nenhum servidor configurado no workspace'));
  const sandbox = lerJson(join(raiz, '.kiro', 'settings', 'sandbox.json'), { padrao: null });
  // O sandbox é parte da fronteira de segurança: aplica as regras fs_write deny também aos comandos.
  itens.push(item(sandbox?.enabled === true && (sandbox.networkAccess ?? 'DEFAULT_BLOCKED') === 'DEFAULT_BLOCKED', 'Sandbox local de comandos', sandbox?.enabled ? `ativo (${sandbox.networkAccess ?? 'DEFAULT_BLOCKED'})${(sandbox.networkAccess ?? 'DEFAULT_BLOCKED') !== 'DEFAULT_BLOCKED' ? ': use DEFAULT_BLOCKED' : ''}` : 'DESLIGADO: obrigatório; ative .kiro/settings/sandbox.json'));
  const chave = arquivoChave(raiz);
  const chaveFora = !estaDentro(raiz, chave);
  itens.push(item(chaveFora, 'Chave de integridade do estado', chaveFora ? `fora do workspace (${existsSync(chave) ? 'criada' : 'será criada no primeiro uso'})` : `DENTRO do workspace (${chave}): defina BP_DIR_CHAVES fora do projeto`));
  const cli = lerJson(join(raiz, '.kiro', 'settings', 'cli.json'), { padrao: {} });
  const esperado = { 'chat.disableInheritingDefaultResources': true, 'chat.enableAutoAgentUpgrade': false, 'telemetry.enabled': false };
  const divergentes = Object.entries(esperado).filter(([k, v]) => cli[k] !== v).map(([k, v]) => `${k}=${v}`);
  itens.push(item(!divergentes.length, 'Settings do workspace (.kiro/settings/cli.json)', divergentes.length ? `ajuste: ${divergentes.join(', ')}` : 'economia de contexto e telemetria conforme política', divergentes.length ? 'aviso' : 'ok'));
  const gi = existsSync(join(raiz, '.gitignore')) ? readFileSync(join(raiz, '.gitignore'), 'utf8') : '';
  itens.push(item(gi.includes('.bp/estado'), '.gitignore', gi.includes('.bp/estado') ? '.bp/estado ignorado' : 'adicione .bp/estado/ (contém capturas e estado local)'));
  itens.push(item(existsSync(caminhosIndice(raiz).manifesto), 'Índice RAG', existsSync(caminhosIndice(raiz).manifesto) ? 'presente' : 'ausente: rode "node .bp/bp.mjs rag indexar"', existsSync(caminhosIndice(raiz).manifesto) ? 'ok' : 'aviso'));
  const trilha = verificarAuditoria(raiz);
  itens.push(item(trilha.integro, 'Trilha de auditoria', trilha.integro ? `íntegra (${trilha.eventos} eventos)` : `adulterada: linha ${trilha.primeiraFalha.linha} (${trilha.primeiraFalha.motivo})`));
  return { ok: itens.every((i) => i.nivel !== 'erro'), itens };
}
