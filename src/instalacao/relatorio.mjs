// Relatório final da execução (Markdown), para o time e para auditoria.

import { pastaEstado } from '../core/config.mjs';
import { escreverAtomico } from '../core/json.mjs';
import { lerAssinadoOuNulo, arquivoTestes, arquivoPortoes } from '../estado/assinado.mjs';
import { statusExecucao } from '../estado/execucao.mjs';
import { verificarAuditoria } from '../estado/auditoria.mjs';
import { relatorioConsumo } from '../tokens/razao.mjs';
import { BpErro, SAIDA } from '../core/erros.mjs';

export function gerarRelatorio(raiz) {
  const s = statusExecucao(raiz);
  if (!s) throw new BpErro('Nenhuma execução ativa', { codigo: SAIDA.FALHA });
  const ex = s.execucao;
  const portoes = lerAssinadoOuNulo(raiz, arquivoPortoes(raiz), 'portoes');
  const testes = lerAssinadoOuNulo(raiz, arquivoTestes(raiz), 'testes');
  const veredito = lerAssinadoOuNulo(raiz, pastaEstado(raiz, 'execucao', 'revisoes', 'veredito.json'), 'veredito');
  const trilha = verificarAuditoria(raiz);
  const consumo = relatorioConsumo(raiz);
  const concluidas = ex.tarefas.filter((t) => t.estado === 'concluida');
  const bloqueadas = ex.tarefas.filter((t) => t.estado === 'bloqueada');
  const pendentes = ex.tarefas.filter((t) => t.estado === 'pendente' || t.estado === 'em_andamento');
  const pronto = Boolean(s.status.complete && portoes?.aprovado && testes?.verde && veredito?.aprovado && bloqueadas.length === 0 && ex.validacao?.aprovada);
  const l = [];
  l.push(`# Relatório da execução ${ex.id}`, '');
  l.push(`**Situação:** ${pronto ? 'PRONTA PARA REVISÃO HUMANA E MERGE' : 'NÃO CONCLUÍDA: ver pendências abaixo'}`, '');
  l.push('## Demanda', '', ex.demanda, '');
  if (ex.resumoPlano) l.push('## Plano', '', ex.resumoPlano, '');
  if (ex.premissas?.length) l.push('## Premissas assumidas (validar com o negócio)', '', ...ex.premissas.map((p) => `- ${p}`), '');
  l.push('## Tarefas', '', `Concluídas ${concluidas.length} de ${ex.tarefas.length}; bloqueadas ${bloqueadas.length}; pendentes ${pendentes.length}.`, '');
  for (const t of ex.tarefas) {
    l.push(`- **${t.id}** [${t.estado}] ${t.titulo} (risco ${t.risco}; ${t.rota?.modelo ?? 'modelo padrão'} / ${t.rota?.esforco ?? '-'})`);
    if (t.evidencia) l.push(`  - Evidência: ${t.evidencia}`);
    if (t.semTestes) l.push(`  - Sem testes, justificativa: ${t.semTestes}`);
    if (t.motivoBloqueio) l.push(`  - Bloqueio: ${t.motivoBloqueio}`);
  }
  l.push('');
  l.push('## Verificações', '');
  l.push(`- Portões: ${portoes ? `${portoes.aprovado ? 'aprovados' : 'REPROVADOS'} (bloqueante ${portoes.contagem.bloqueante}, alta ${portoes.contagem.alta}, média ${portoes.contagem.media})` : 'não executados'}`);
  l.push(`- Testes: ${testes ? (testes.semTestes ? 'sem suíte detectada' : testes.verde ? 'verdes' : 'VERMELHOS') : 'não executados'}`);
  l.push(`- Revisões: ${veredito ? `${veredito.veredito} na rodada ${veredito.rodada}` : 'não consolidadas'}`);
  if (veredito?.motivos?.length) l.push(...veredito.motivos.map((m) => `  - ${m}`));
  if (ex.validacao) {
    l.push(`- Validação dos critérios de aceite: ${ex.validacao.aprovada ? 'todos atendidos com evidência' : 'PENDENTE'}`);
    for (const c of ex.validacao.naoAtendidos ?? []) l.push(`  - Não atendido: ${c}`);
    for (const c of ex.validacao.semEvidencia ?? []) l.push(`  - Sem evidência: ${c.tarefa}: ${c.criterio}`);
  } else l.push('- Validação dos critérios de aceite: não executada');
  l.push(`- Trilha de auditoria: ${trilha.integro ? `íntegra (${trilha.eventos} eventos)` : `ADULTERADA na linha ${trilha.primeiraFalha.linha}: ${trilha.primeiraFalha.motivo}`}`);
  l.push('');
  if (ex.riscos?.length) l.push('## Riscos identificados', '', ...ex.riscos.map((r) => `- ${r}`), '');
  l.push('## Consumo estimado de tokens em ferramentas', '', `Total estimado: ${consumo.total} tokens em ${consumo.chamadas ?? 0} chamadas.`);
  for (const p of consumo.porFerramenta.slice(0, 8)) l.push(`- ${p.ferramenta}: ${p.tokens} tokens em ${p.chamadas} chamada(s)`);
  for (const r of consumo.recomendacoes) l.push(`- Recomendação: ${r}`);
  l.push('', '## Próximos passos humanos', '', '- Revisar o diff e este relatório.', '- Validar as premissas com a área de negócio.', '- Abrir o pull request pelo fluxo corporativo (o agente não faz push).', '');
  const md = l.join('\n');
  escreverAtomico(pastaEstado(raiz, 'execucao', 'RELATORIO.md'), md);
  return { pronto, markdown: md };
}
