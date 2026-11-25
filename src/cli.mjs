// CLI do Orquestrador BP. Saída enxuta por padrão (economia de tokens); --json para máquinas.

import { readFileSync, existsSync } from 'node:fs';
import { analisarArgs, inteiro } from './core/args.mjs';
import { BpErro, SAIDA, erroUso } from './core/erros.mjs';
import { carregarConfig, encontrarRaiz, pastaEstado } from './core/config.mjs';
import { lerEntradaPadrao, lerJson, escreverAtomico } from './core/json.mjs';
import { resolverConfinado, relativoPosix } from './core/caminhos.mjs';
import { resolverLeituraSegura } from './core/leitura.mjs';
import { indexar, carregarIndice } from './rag/indice.mjs';
import { prepararCorpus, buscar } from './rag/busca.mjs';
import { gerarContexto } from './rag/contexto.mjs';
import { estimarTokens, cortarParaOrcamento } from './rag/texto.mjs';
import { iniciarAplicacao, pararAplicacao, statusAplicacao } from './ciclo/aplicacao.mjs';
import { commitAtual, diffTexto, ehRepositorio } from './portoes/git.mjs';
import { carregarModelos, validarPapeis, custoRelativo } from './modelos/politica.mjs';
import { classificarTarefa, resolverModelo } from './modelos/roteador.mjs';
import { executarPortoes, resumirPortoes } from './portoes/portoes.mjs';
import { executarTestes, resumirTestes } from './ciclo/testes.mjs';
import { iniciarExecucao, importarPlano, proximaTarefa, concluirTarefa, falharTarefa, statusExecucao, definirFase, registrarValidacao } from './estado/execucao.mjs';
import { registrarRevisao, consolidarRevisoes } from './estado/revisao.mjs';
import { verificarAuditoria, registrarEvento } from './estado/auditoria.mjs';
import { relatorioConsumo } from './tokens/razao.mjs';
import { executarGancho } from './ganchos/ganchos.mjs';
import { comandoSessao, fecharSessao, executarServidor } from './navegador/sessao.mjs';
import { carregarRoteiro, executarRoteiro } from './navegador/roteiro.mjs';
import { gerarRelatorio } from './instalacao/relatorio.mjs';
import { diagnosticar } from './instalacao/doutor.mjs';
import { instalar, exigirHumano } from './instalacao/instalar.mjs';
import { aplicarModelos } from './instalacao/kiro.mjs';
import { iniciarHeadless } from './instalacao/iniciar.mjs';

export const VERSAO = '1.0.0';

const AJUDA = `Orquestrador BP ${VERSAO} - orquestração de agentes sobre o Kiro (Brasilprev)
Uso: node .bp/bp.mjs <comando> [opções]

Disparo autônomo (humano ou CI; usa o kiro-cli oficial, headless, com sandbox)
  iniciar --demanda-arquivo F [--regras-arquivo F] [--layout-arquivo F] [--destino-arquivo F]
          [--workflow bp-entrega|bp-correcao|bp-revisao]
Execução (usado pelos agentes)
  exec iniciar --demanda-arquivo F [--regras-arquivo F] [--layout-arquivo F] [--destino-arquivo F]
  exec plano [--arquivo .bp/estado/entrada/plano.json] | exec proxima
  exec concluir <id> --evidencia "..." [--sem-testes "justificativa"] | exec falhar <id> --motivo "..."
  exec diff [--stat] [--arquivo CAMINHO] | exec validar [--arquivo F] | exec fase <fase>
  exec status | exec relatorio
Aplicação local (comando definido em .bp/config.json)
  app iniciar | app status | app parar
Qualidade
  testes                      executa a suíte e devolve só as falhas
  portoes [--base REF] [--tudo]  segredos, PII, padrões inseguros, regras financeiras
  revisao registrar --arquivo F | revisao consolidar
RAG e tokens
  rag indexar | rag buscar "consulta" [--k 8] | rag contexto "consulta" [--orcamento 4000]
  tokens relatorio | tokens estimar <arquivo>
Modelos
  modelos verificar | modelos rota --tarefa "..." [--arquivos a,b] | modelos aplicar (humano)
Navegador (Chrome/Edge local, sem MCP, só hosts permitidos)
  nav abrir [url] | nav estado [--max N] | nav ir <url> | nav clicar <id> [--aceitar-dialogo]
  nav digitar <id> "texto" [--enter] | nav selecionar <id> "opção" | nav tecla <Tecla>
  nav rolar [cima|baixo] [páginas] | nav esperar --texto "..." [--ms N] | nav captura [nome]
  nav console | nav rede | nav abas | nav aba <n> | nav upload <id> <arquivo>
  nav voltar | nav avancar | nav recarregar | nav fechar | nav roteiro <arquivo.json>
Administração
  doutor | auditoria verificar | init --destino DIR [--forcar] (humano) | versao | ajuda`;

function escrever(texto) {
  if (texto === undefined || texto === null || texto === '') return;
  process.stdout.write(typeof texto === 'string' ? `${texto}\n` : `${JSON.stringify(texto, null, 2)}\n`);
}

function lerArquivoTexto(raiz, caminho, rotulo) {
  if (!caminho || caminho === true) return null;
  const { absoluto: abs } = resolverLeituraSegura(raiz, String(caminho), rotulo);
  if (!existsSync(abs)) throw erroUso(`${rotulo} não encontrado: ${caminho}`);
  return readFileSync(abs, 'utf8');
}

async function cmdRag(raiz, config, [sub, ...resto], opcoes) {
  if (sub === 'indexar') {
    const est = await indexar(raiz, config);
    registrarEvento(raiz, 'rag.indexado', est);
    return opcoes.json ? est : `Índice RAG: ${est.arquivos} arquivos, ${est.trechos} trechos (${est.reindexados} reindexados, ${est.reaproveitados} sem mudança; ignorados: ${est.ignoradosSensiveis} sensíveis, ${est.ignoradosGrandes} grandes, ${est.ignoradosBinarios} binários)${est.limiteAtingido ? ' ATENÇÃO: limite de arquivos atingido' : ''}`;
  }
  if (sub === 'buscar') {
    const consulta = resto.join(' ').trim();
    if (!consulta) throw erroUso('Informe a consulta');
    const idx = await carregarIndice(raiz);
    if (!idx) throw new BpErro('Índice inexistente. Rode: node .bp/bp.mjs rag indexar', { codigo: SAIDA.FALHA });
    const r = buscar(prepararCorpus(idx.trechos), consulta, { k: inteiro(opcoes.k, { padrao: 8, min: 1, max: 50, nome: '--k' }), prioridade: config.rag.prioridade, filtroCaminho: typeof opcoes.caminho === 'string' ? opcoes.caminho : undefined });
    if (opcoes.json) return r.map(({ texto, ...m }) => ({ ...m, previa: texto.slice(0, 200) }));
    return r.length ? r.map((x) => `${x.caminho}:${x.linhaInicio}-${x.linhaFim}  ${x.titulo ? `(${x.titulo.slice(0, 60)}) ` : ''}score=${x.pontuacao}`).join('\n') : 'Nenhum resultado.';
  }
  if (sub === 'contexto') {
    const consulta = resto.join(' ').trim();
    if (!consulta) throw erroUso('Informe a consulta');
    const p = await gerarContexto(raiz, config, consulta, { orcamento: inteiro(opcoes.orcamento, { padrao: config.tokens.orcamentoContexto, min: 200, max: 60000, nome: '--orcamento' }), filtroCaminho: typeof opcoes.caminho === 'string' ? opcoes.caminho : undefined });
    if (typeof opcoes.saida === 'string') {
      // Só grava na área de trabalho do agente (.bp/estado/entrada), nunca em código ou governança.
      const destino = resolverConfinado(pastaEstado(raiz, 'entrada'), opcoes.saida.replace(/^\.bp[/\\]estado[/\\]entrada[/\\]/, ''), 'saída');
      escreverAtomico(destino, p.markdown);
      return `Contexto (${p.tokens} tokens, ${p.itens.length} trechos) salvo em ${relativoPosix(raiz, destino)}`;
    }
    return opcoes.json ? p : p.markdown;
  }
  if (sub === 'status') {
    const m = lerJson(pastaEstado(raiz, 'rag', 'manifesto.json'), { padrao: null });
    return m ? `Índice de ${m.atualizadoEm}: ${Object.keys(m.arquivos).length} arquivos, ${m.totalTrechos} trechos` : 'Índice inexistente.';
  }
  throw erroUso('Subcomando de rag: indexar | buscar | contexto | status');
}

async function cmdExec(raiz, config, [sub, ...resto], opcoes) {
  switch (sub) {
    case 'iniciar': {
      const demanda = lerArquivoTexto(raiz, opcoes['demanda-arquivo'], 'arquivo de demanda') ?? (typeof opcoes.demanda === 'string' ? opcoes.demanda : null);
      const { execucao } = iniciarExecucao(raiz, {
        demanda,
        regras: lerArquivoTexto(raiz, opcoes['regras-arquivo'], 'arquivo de regras') ?? (typeof opcoes.regras === 'string' ? opcoes.regras : null),
        layout: lerArquivoTexto(raiz, opcoes['layout-arquivo'], 'arquivo de layout') ?? (typeof opcoes.layout === 'string' ? opcoes.layout : null),
        destino: lerArquivoTexto(raiz, opcoes['destino-arquivo'], 'arquivo de destino') ?? (typeof opcoes.destino === 'string' ? opcoes.destino : null),
      });
      // Base Git da execução: portões e revisores comparam contra ela mesmo se houver commits depois.
      const baseGit = (await ehRepositorio(raiz)) ? await commitAtual(raiz) : null;
      if (baseGit) definirFase(raiz, 'planejamento', { baseGit });
      return `Execução ${execucao.id} iniciada${baseGit ? ` (base Git ${baseGit.slice(0, 12)})` : ''}. Demanda consolidada em .bp/estado/execucao/DEMANDA.md`;
    }
    case 'plano': {
      const { absoluto: abs } = resolverLeituraSegura(raiz, String(opcoes.arquivo ?? '.bp/estado/entrada/plano.json'), 'plano');
      const { execucao } = importarPlano(raiz, carregarModelos(raiz), abs);
      const linhas = execucao.tarefas.map((t) => `- ${t.id} [${t.risco}] ${t.titulo} -> ${t.rota.papel} (${t.rota.modelo}/${t.rota.esforco})${t.depende?.length ? ` depende de ${t.depende.join(',')}` : ''}`);
      return `Plano importado: ${execucao.tarefas.length} tarefa(s).\n${linhas.join('\n')}`;
    }
    case 'proxima': {
      const { tarefa, retomada, status } = proximaTarefa(raiz);
      if (!tarefa) return opcoes.json ? { tarefa: null, status } : `Nenhuma tarefa pendente executável. complete=${status.complete} bloqueadas=${status.bloqueadas}`;
      if (opcoes.json) return { tarefa, retomada, status };
      return [
        `${retomada ? 'Retomando' : 'Próxima'} tarefa ${tarefa.id} (tentativa ${tarefa.tentativas}, risco ${tarefa.risco})`,
        `Delegar ao agente: ${tarefa.rota.agente ?? `bp-${tarefa.rota.papel}`} (${tarefa.rota.modelo}/${tarefa.rota.esforco})`,
        `Título: ${tarefa.titulo}`,
        tarefa.descricao ? `Descrição: ${tarefa.descricao}` : null,
        `Critérios de aceite:\n${tarefa.criterios.map((c) => `  - ${c}`).join('\n')}`,
        tarefa.testes?.length ? `Testes esperados:\n${tarefa.testes.map((c) => `  - ${c}`).join('\n')}` : null,
        tarefa.arquivos?.length ? `Arquivos previstos: ${tarefa.arquivos.join(', ')}` : null,
        tarefa.historicoFalhas?.length ? `Falhas anteriores:\n${tarefa.historicoFalhas.map((f) => `  - ${f}`).join('\n')}` : null,
        `Contexto: node .bp/bp.mjs rag contexto "${tarefa.titulo.replace(/"/g, "'")}" --orcamento 3000`,
        `Ao terminar: node .bp/bp.mjs testes && node .bp/bp.mjs exec concluir ${tarefa.id} --evidencia "..."`,
      ].filter(Boolean).join('\n');
    }
    case 'concluir': {
      const id = resto[0];
      if (!id) throw erroUso('Informe o id da tarefa');
      const { status } = concluirTarefa(raiz, id, { evidencia: opcoes.evidencia, semTestesJustificativa: typeof opcoes['sem-testes'] === 'string' ? opcoes['sem-testes'] : null });
      return `Tarefa ${id} concluída. Pendentes: ${status.pendentes}. complete=${status.complete}`;
    }
    case 'falhar': {
      const id = resto[0];
      if (!id || typeof opcoes.motivo !== 'string') throw erroUso('Uso: exec falhar <id> --motivo "..."');
      const { tarefa } = falharTarefa(raiz, id, opcoes.motivo);
      return `Tarefa ${id} -> ${tarefa.estado}${tarefa.motivoBloqueio ? ` (${tarefa.motivoBloqueio})` : ''}`;
    }
    case 'fase': {
      const fases = ['planejamento', 'implementacao', 'revisao', 'correcao', 'validacao', 'concluida'];
      if (!fases.includes(resto[0])) throw erroUso(`Fase inválida. Use: ${fases.join(', ')}`);
      return definirFase(raiz, resto[0]);
    }
    case 'status': {
      const s = statusExecucao(raiz);
      if (!s) return 'Nenhuma execução ativa.';
      if (opcoes.json) return s.status;
      const ex = s.execucao;
      return [`Execução ${ex.id} | fase ${ex.fase}`, ...ex.tarefas.map((t) => `- ${t.id} [${t.estado}] ${t.titulo}`), `status: ${JSON.stringify(s.status)}`].join('\n');
    }
    case 'diff': {
      const s = statusExecucao(raiz);
      const base = typeof opcoes.base === 'string' ? opcoes.base : s?.execucao.baseGit ?? undefined;
      if (!(await ehRepositorio(raiz))) return 'Sem repositório Git: revise os arquivos listados nas evidências das tarefas.';
      const { texto, novos } = await diffTexto(raiz, base, { arquivo: typeof opcoes.arquivo === 'string' ? opcoes.arquivo : undefined, stat: opcoes.stat === true });
      const extra = novos.length ? `\nArquivos novos (não rastreados), leia-os diretamente:\n${novos.slice(0, 100).map((n) => `- ${n}`).join('\n')}` : '';
      const corpo = cortarParaOrcamento(texto || '(sem diferenças em arquivos rastreados)', config.tokens.orcamentoDiff);
      return `${corpo.texto}${corpo.cortado ? '\nDiff cortado: use --stat para listar e --arquivo <caminho> para revisar arquivo por arquivo.' : ''}${extra}`;
    }
    case 'validar': {
      const { absoluto: abs } = resolverLeituraSegura(raiz, String(opcoes.arquivo ?? '.bp/estado/entrada/validacao.json'), 'validação');
      const { validacao } = registrarValidacao(raiz, abs);
      return `Validação: ${validacao.aprovada ? 'APROVADA' : 'PENDENTE'} (${validacao.criterios.length} critério(s); não atendidos ${validacao.naoAtendidos.length}; sem evidência ${validacao.semEvidencia.length})`;
    }
    case 'relatorio': {
      const r = gerarRelatorio(raiz);
      return opcoes.json ? { pronto: r.pronto } : `${r.pronto ? 'PRONTO' : 'PENDENTE'}: relatório em .bp/estado/execucao/RELATORIO.md`;
    }
    default:
      throw erroUso('Subcomando de exec: iniciar | plano | proxima | concluir | falhar | fase | status | relatorio');
  }
}

async function cmdNav(raiz, config, [sub, ...resto], opcoes) {
  const fmt = (r) => (typeof r === 'string' ? r : JSON.stringify(r, null, 1));
  switch (sub) {
    case '_servidor':
      await executarServidor(raiz, config, String(opcoes.nonce ?? ''));
      return new Promise(() => {}); // mantém o processo vivo; encerra por ociosidade ou "nav fechar"
    case 'abrir': {
      const r = [await comandoSessao(raiz, 'abas')];
      if (resto[0]) r.push(await comandoSessao(raiz, 'navegar', { url: resto[0] }));
      r.push(await comandoSessao(raiz, 'estado', { max: opcoes.max }));
      return r.map(fmt).join('\n');
    }
    case 'estado':
      return comandoSessao(raiz, 'estado', { max: opcoes.max });
    case 'ir':
      return comandoSessao(raiz, 'navegar', { url: resto[0] });
    case 'clicar':
      return comandoSessao(raiz, 'clicar', { id: resto[0], aceitarDialogo: opcoes['aceitar-dialogo'] === true });
    case 'digitar':
      return comandoSessao(raiz, 'digitar', { id: resto[0], texto: resto.slice(1).join(' '), enter: opcoes.enter === true });
    case 'selecionar':
      return comandoSessao(raiz, 'selecionar', { id: resto[0], opcao: resto.slice(1).join(' ') });
    case 'tecla':
      return comandoSessao(raiz, 'tecla', { tecla: resto[0] });
    case 'rolar':
      return comandoSessao(raiz, 'rolar', { direcao: resto[0], paginas: resto[1] });
    case 'esperar':
      return comandoSessao(raiz, 'esperar', { texto: typeof opcoes.texto === 'string' ? opcoes.texto : undefined, ms: opcoes.ms });
    case 'captura':
      return comandoSessao(raiz, 'captura', { arquivo: resto[0], paginaInteira: opcoes['pagina-inteira'] === true });
    case 'console':
    case 'rede':
    case 'abas':
      return fmt(await comandoSessao(raiz, sub));
    case 'aba':
      return comandoSessao(raiz, 'aba', { indice: resto[0] });
    case 'upload':
      return comandoSessao(raiz, 'upload', { id: resto[0], arquivo: resto[1] });
    case 'voltar':
    case 'avancar':
    case 'recarregar':
      return comandoSessao(raiz, sub);
    case 'fechar':
      return fecharSessao(raiz);
    case 'roteiro': {
      const { absoluto: abs } = resolverLeituraSegura(raiz, String(resto[0] ?? ''), 'roteiro');
      const r = await executarRoteiro(raiz, config, carregarRoteiro(abs));
      registrarEvento(raiz, 'navegador.roteiro', { roteiro: r.roteiro, aprovado: r.aprovado });
      if (opcoes.json) return r;
      const falha = r.passos.find((p) => !p.ok);
      return [`Roteiro ${r.roteiro}: ${r.aprovado ? 'APROVADO' : 'REPROVADO'} (${r.passos.filter((p) => p.ok).length}/${r.passos.length} passos)`,
        falha ? `Falhou no passo ${falha.n} (${falha.acao}): ${falha.erro}` : null,
        falha && r.estadoNaFalha ? r.estadoNaFalha : null,
        r.console.length ? `Console: ${r.console.map((c) => `[${c.nivel}] ${c.texto}`).slice(-3).join(' | ')}` : null,
        `Detalhes: .bp/estado/navegador/roteiros/${r.roteiro}.json`].filter(Boolean).join('\n');
    }
    default:
      throw erroUso('Subcomando de nav inválido. Veja "node .bp/bp.mjs ajuda".');
  }
}

export async function principal(argv) {
  const { posicionais, opcoes } = analisarArgs(argv, { booleanos: ['json', 'tudo', 'forcar', 'enter', 'aceitar-dialogo', 'pagina-inteira', 'stat', 'sem-sandbox'] });
  const [comando, ...resto] = posicionais;
  if (!comando || comando === 'ajuda' || opcoes.help || opcoes.ajuda) return { saida: AJUDA };
  if (comando === 'versao') return { saida: VERSAO };
  if (comando === 'init' || comando === 'instalar') {
    exigirHumano('init');
    if (typeof opcoes.destino !== 'string') throw erroUso('Informe --destino <pasta do repositório>');
    const r = instalar(opcoes.destino, { forcar: opcoes.forcar === true });
    return { saida: `Instalado: ${r.copiados.length} arquivo(s) de configuração e a ferramenta em .bp/ferramenta.${r.substituidos.length ? ` Substituídos com backup em ${r.backup}: ${r.substituidos.length}.` : ''}${r.gitignore ? ` .gitignore atualizado (${r.gitignore.join(', ')}).` : ''}\nPróximos passos: abra o repositório no Kiro, confie no workspace e rode "node .bp/bp.mjs doutor".` };
  }
  if (comando === 'autoverificacao') {
    // O próprio pacote passa pelos portões que impõe (testes contêm exemplos inseguros de propósito).
    const { PADROES } = await import('./core/config.mjs');
    const pacote = new URL('..', import.meta.url);
    const raizPacote = decodeURIComponent(pacote.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    // Escopo: o que é entregue ao repositório alvo (bin, src, modelo). Os testes ficam fora porque
    // contêm segredos e CPFs fictícios de propósito; documentação e skills só para regras de código.
    const cfg = {
      ...PADROES,
      rag: { ...PADROES.rag, excluir: [...PADROES.rag.excluir, 'test/**'] },
      portoes: { ...PADROES.portoes, ignorar: ['docs/**', 'modelo/.kiro/skills/**', 'modelo/.bp/prompts/**', '*.md'] },
    };
    const r = await executarPortoes(raizPacote, cfg, { tudo: true });
    return { saida: resumirPortoes(r), codigo: r.aprovado && r.contagem.alta === 0 ? 0 : SAIDA.FALHA };
  }
  const raiz = encontrarRaiz();
  if (comando === 'gancho') {
    // PreToolUse: só o código 2 bloqueia no Kiro. Qualquer falha (entrada grande demais,
    // configuração inválida, exceção) precisa terminar em 2 para não liberar a ação.
    const pre = /^pre-(?:ferramenta|shell|escrita|leitura)$/.test(resto[0] ?? '');
    try {
      const config = carregarConfig(raiz);
      const r = await executarGancho(raiz, config, resto[0], await lerEntradaPadrao({ limite: 32 * 1024 * 1024 }));
      return { codigo: r.codigo, saida: r.stdout, erro: r.stderr };
    } catch (e) {
      if (pre) return { codigo: SAIDA.BLOQUEIO, erro: `[BP-GUARDA] Verificação impossível (${String(e.message).slice(0, 120)}); ação bloqueada por segurança.` };
      return { codigo: 0 };
    }
  }
  const config = carregarConfig(raiz);
  if (comando === 'iniciar') {
    const r = await iniciarHeadless(raiz, {
      workflow: typeof opcoes.workflow === 'string' ? opcoes.workflow : undefined,
      demanda: typeof opcoes['demanda-arquivo'] === 'string' ? opcoes['demanda-arquivo'] : undefined,
      regras: typeof opcoes['regras-arquivo'] === 'string' ? opcoes['regras-arquivo'] : undefined,
      layout: typeof opcoes['layout-arquivo'] === 'string' ? opcoes['layout-arquivo'] : undefined,
      destino: typeof opcoes['destino-arquivo'] === 'string' ? opcoes['destino-arquivo'] : undefined,
    });
    return { saida: `Kiro encerrou com código ${r.codigo}. Eventos em ${r.registro}.\n${r.final}`, codigo: r.codigo };
  }
  switch (comando) {
    case 'rag':
      return { saida: await cmdRag(raiz, config, resto, opcoes) };
    case 'exec':
      return { saida: await cmdExec(raiz, config, resto, opcoes) };
    case 'nav':
      return { saida: await cmdNav(raiz, config, resto, opcoes) };
    case 'app': {
      if (resto[0] === 'iniciar') return { saida: await iniciarAplicacao(raiz, config) };
      if (resto[0] === 'parar') return { saida: pararAplicacao(raiz) };
      if (resto[0] === 'status') return { saida: await statusAplicacao(raiz, config) };
      throw erroUso('Subcomando de app: iniciar | parar | status');
    }
    case 'testes': {
      const r = await executarTestes(raiz, config);
      registrarEvento(raiz, 'testes.executados', { verde: r.verde, semTestes: Boolean(r.semTestes) });
      return { saida: opcoes.json ? r : resumirTestes(r), codigo: r.verde || r.semTestes ? 0 : SAIDA.FALHA };
    }
    case 'portoes': {
      // Com execução ativa, a base é sempre a da execução (o agente não escolhe a comparação).
      const baseExecucao = statusExecucao(raiz)?.execucao.baseGit;
      if (baseExecucao && typeof opcoes.base === 'string' && opcoes.base !== baseExecucao) throw erroUso('Com execução ativa, os portões comparam sempre contra a base da execução; não use --base.');
      const base = baseExecucao ?? (typeof opcoes.base === 'string' ? opcoes.base : undefined);
      const r = await executarPortoes(raiz, config, { base, tudo: opcoes.tudo === true });
      registrarEvento(raiz, 'portoes.executados', { aprovado: r.aprovado, contagem: r.contagem });
      return { saida: opcoes.json ? r : resumirPortoes(r), codigo: r.aprovado ? 0 : SAIDA.FALHA };
    }
    case 'revisao': {
      if (resto[0] === 'registrar') {
        const { absoluto: abs } = resolverLeituraSegura(raiz, String(opcoes.arquivo ?? ''), 'revisão');
        const r = registrarRevisao(raiz, abs);
        return { saida: `Revisão "${r.revisor}" registrada (rodada ${r.rodada}): ${r.achados.length} achado(s).` };
      }
      if (resto[0] === 'consolidar') {
        const v = consolidarRevisoes(raiz);
        return { saida: opcoes.json ? v : `VEREDITO: ${v.veredito}${v.motivos.length ? `\n${v.motivos.map((m) => `- ${m}`).join('\n')}\nCorreções em .bp/estado/execucao/CORRECOES.md` : ''}`, codigo: v.aprovado ? 0 : SAIDA.FALHA };
      }
      throw erroUso('Subcomando de revisao: registrar | consolidar');
    }
    case 'modelos': {
      const modelos = carregarModelos(raiz);
      if (resto[0] === 'verificar') {
        const v = validarPapeis(modelos);
        const tabela = Object.entries(modelos.papeis).map(([p, c]) => `- ${p}: ${c.modelo}/${c.esforco} (${custoRelativo(c.modelo, 0)?.multiplicador ?? '?'}x)${c.escalonar ? ` -> risco alto: ${c.escalonar.modelo ?? c.modelo}/${c.escalonar.esforco ?? c.esforco}` : ''}`);
        return { saida: [`Política: perfil ${modelos.politica.perfil}; ${v.ok ? 'OK' : 'PROBLEMAS'}`, ...tabela, ...v.problemas.map((p) => `! ${p.papel} ${p.modelo ?? ''}: ${p.motivos.join('; ')}`)].join('\n'), codigo: v.ok ? 0 : SAIDA.FALHA };
      }
      if (resto[0] === 'rota') {
        const c = classificarTarefa({ descricao: String(opcoes.tarefa ?? ''), arquivos: typeof opcoes.arquivos === 'string' ? opcoes.arquivos.split(',').map((s) => s.trim()) : [] });
        const m = resolverModelo(modelos, c.papel, c.risco);
        return { saida: opcoes.json ? { ...c, ...m } : `${c.papel} -> ${m.modelo}/${m.esforco} (risco ${c.risco}, ${c.natureza})${c.motivos.length ? `; ${c.motivos.join('; ')}` : ''}` };
      }
      if (resto[0] === 'aplicar') {
        exigirHumano('modelos aplicar');
        const v = validarPapeis(modelos);
        if (!v.ok) throw new BpErro(`Política inválida: ${v.problemas.map((p) => `${p.papel}: ${p.motivos.join('; ')}`).join(' | ')}`, { codigo: SAIDA.CONFIG });
        const alt = aplicarModelos(raiz, modelos);
        registrarEvento(raiz, 'modelos.aplicados', { alteracoes: alt });
        return { saida: alt.length ? alt.join('\n') : 'Nada a alterar.' };
      }
      throw erroUso('Subcomando de modelos: verificar | rota | aplicar');
    }
    case 'tokens': {
      if (resto[0] === 'relatorio') {
        const r = relatorioConsumo(raiz);
        return { saida: opcoes.json ? r : [`Total estimado: ${r.total} tokens`, ...r.porFerramenta.slice(0, 10).map((p) => `- ${p.ferramenta}: ${p.tokens} (${p.chamadas}x)`), ...r.recomendacoes.map((x) => `> ${x}`)].join('\n') };
      }
      if (resto[0] === 'estimar') {
        const { absoluto: abs } = resolverLeituraSegura(raiz, String(resto[1] ?? ''), 'arquivo');
        const t = estimarTokens(readFileSync(abs, 'utf8'));
        return { saida: `${relativoPosix(raiz, abs)}: ~${t} tokens` };
      }
      throw erroUso('Subcomando de tokens: relatorio | estimar <arquivo>');
    }
    case 'auditoria': {
      const r = verificarAuditoria(raiz);
      return { saida: r.integro ? `Trilha íntegra: ${r.eventos} evento(s).` : `TRILHA ADULTERADA na linha ${r.primeiraFalha.linha}: ${r.primeiraFalha.motivo}`, codigo: r.integro ? 0 : SAIDA.FALHA };
    }
    case 'doutor': {
      const r = await diagnosticar(raiz);
      const simbolo = { ok: 'OK ', aviso: 'AVISO', erro: 'ERRO' };
      return { saida: opcoes.json ? r : r.itens.map((i) => `[${simbolo[i.nivel]}] ${i.titulo}: ${i.detalhe}`).join('\n'), codigo: r.ok ? 0 : SAIDA.FALHA };
    }
    default:
      throw erroUso(`Comando desconhecido: ${comando}. Veja "node .bp/bp.mjs ajuda".`);
  }
}

export async function executarCli(argv) {
  try {
    const r = await principal(argv);
    escrever(r.saida);
    if (r.erro) process.stderr.write(`${r.erro}\n`);
    process.exitCode = r.codigo ?? 0;
  } catch (e) {
    // Hook de PreToolUse nunca falha aberto, nem por erro antes do despacho.
    const preGancho = argv[0] === 'gancho' && /^pre-/.test(argv[1] ?? '');
    const codigo = preGancho ? SAIDA.BLOQUEIO : e instanceof BpErro ? e.codigo : SAIDA.INTERNO;
    process.stderr.write(`Erro: ${e.message}${e.detalhes ? `\n${[].concat(e.detalhes).map((d) => `  - ${d}`).join('\n')}` : ''}\n`);
    if (!(e instanceof BpErro) && process.env.BP_DEPURAR === '1') process.stderr.write(`${e.stack}\n`);
    process.exitCode = codigo;
  }
}
