---
name: bp-economia-tokens
description: Técnicas do Orquestrador BP para gastar menos tokens sem perder qualidade. Use ao planejar como ler código, delegar a subagentes, rodar testes, escrever respostas ou quando o contexto estiver crescendo.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# Economia de tokens no Orquestrador BP

O custo vem de três fontes: o que entra no contexto (arquivos, saídas de ferramentas), o que o modelo gera (respostas, raciocínio) e o multiplicador do modelo usado. Ataque as três.

## Entrada

1. **Contexto por busca, não por leitura cega.** `node .bp/bp.mjs rag contexto "<consulta>" --orcamento 3000` devolve só os trechos relevantes com `caminho:linhas`. Abra o arquivo inteiro apenas quando for editá-lo.
2. **Leia faixas.** Para arquivos grandes, leia só as linhas citadas. Use `grep_search` para localizar antes de ler.
3. **Saídas filtradas.** `node .bp/bp.mjs testes` devolve só as falhas; `node .bp/bp.mjs portoes` só o que exige ação; `node .bp/bp.mjs exec diff --stat` antes do diff por arquivo.
4. **Nada de despejo.** Não rode comandos que imprimem logs, árvores inteiras de diretório ou arquivos minificados.

## Delegação

1. **Contexto limpo por etapa.** Cada etapa do workflow e cada subagente começa do zero: passe um cartão autossuficiente (o `exec proxima` já gera), não a conversa.
2. **Modelo certo para o trabalho.** Coordenação e comandos determinísticos no Haiku; implementação comum no Sonnet 5.5; planejamento, revisão e tarefas críticas no Opus 5.5. A política fica em `.bp/modelos.json` e a rota por risco é calculada por `exec plano`.
3. **Faixas de preço por tamanho de contexto.** Haiku 5.5 é cobrado a 0,06x até 100 mil tokens e a 0,3x acima; GPT-5.6 dobra acima de 272 mil. Mantenha cada etapa abaixo dessas faixas.
4. **Determinístico antes do LLM.** Portões, testes, consolidação de revisões e roteiros E2E rodam como script, sem tokens. Revisores não repetem o que os portões já verificaram.

## Saída

1. Respostas finais curtas no formato pedido (contagens, listas, JSON). Sem repetir o enunciado nem narrar o que vai fazer.
2. Artefatos longos vão para arquivo (spec, plano, revisão) e a resposta só aponta o caminho.
3. Esforço de raciocínio por papel: `low` para coordenação, `medium` para implementação, `high` a `max` só para planejamento, revisão e segurança.

## Diagnóstico

`node .bp/bp.mjs tokens relatorio` mostra quais ferramentas mais consumiram e recomenda ajustes.
