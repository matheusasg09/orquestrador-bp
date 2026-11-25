---
name: bp-revisao-codigo-financeiro
description: Checklist e régua de severidade da revisão de código do Orquestrador BP para instituição financeira (regras de negócio, precisão monetária, concorrência, idempotência, transações, erros, desempenho, testes, legibilidade), com formato de registro estruturado. Use ao revisar diffs ou pull requests.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# Revisão de código financeiro

Objetivo: nenhum defeito que cause perda financeira, dado incorreto, violação regulatória ou indisponibilidade chega ao merge, sem burocracia em detalhe cosmético.

## Ordem de leitura

1. Demanda e spec: o que deveria acontecer.
2. Testes do diff: eles provam os critérios? Falhariam sem a implementação?
3. Domínio e cálculos; depois fronteiras (API, banco, mensageria); depois interface.

## Checklist essencial

Veja `references/checklist.md` para a lista completa com exemplos. O mínimo:

- **Regra de negócio:** implementa exatamente cada critério; nenhum caso de borda esquecido; nenhuma regra inventada.
- **Precisão:** decimal exato, escala e arredondamento explícitos e no ponto certo; soma das partes igual ao todo.
- **Datas:** fuso, dia útil, competência, virada de mês e ano.
- **Concorrência e idempotência:** reprocessamento não duplica; disputa não corrompe saldo.
- **Transação e consistência:** atomicidade correta, efeitos externos após commit, compensação quando necessária.
- **Erros:** tratados, sem engolir, sem vazar detalhe técnico ou dado pessoal; falha segura.
- **Contratos:** compatibilidade com consumidores existentes; validação de entrada.
- **Desempenho:** N+1, consulta sem índice, carga integral de tabela, laço com I/O, ausência de paginação.
- **Observabilidade:** logs úteis e sem dados sensíveis; auditoria de ações relevantes.
- **Manutenção:** nomes do domínio, funções pequenas, sem duplicação de regra, sem código morto, consistente com o projeto.

## Régua de severidade

| Severidade | Quando |
| --- | --- |
| bloqueante | perda ou cálculo financeiro errado, dado incorreto persistido, violação de LGPD ou norma, falha de segurança explorável, quebra de contrato em produção |
| alta | defeito provável em produção, teste que não prova o critério, ausência de tratamento de erro em fluxo principal |
| media | risco de manutenção relevante, desempenho que piora com volume, log insuficiente |
| baixa | legibilidade, nomes, pequenas duplicações |
| sugestao | melhoria opcional |

Todo achado bloqueante ou alto precisa de `cenarioFalha` concreto e `recomendacao` acionável. Sem cenário, rebaixe ou descarte.

## Registro

JSON em `.bp/estado/entrada/revisao-codigo.json` com `revisor: "codigo"` e `achados[]` (`severidade`, `categoria`, `titulo`, `arquivo`, `linha`, `descricao`, `cenarioFalha`, `recomendacao`), depois `node .bp/bp.mjs revisao registrar --arquivo ...`. O veredito é calculado pelo BP: qualquer bloqueante ou alto reprova.
