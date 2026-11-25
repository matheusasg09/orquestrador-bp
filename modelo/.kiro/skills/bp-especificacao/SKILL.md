---
name: bp-especificacao
description: Como escrever a spec do Kiro (requisitos EARS, design, tarefas) e o plano.json do Orquestrador BP com critérios de aceite testáveis, premissas e tarefas pequenas, para entregar certo na primeira vez. Use ao planejar, revisar plano ou validar entrega.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# Especificação sem retrabalho

Retrabalho nasce de requisito ambíguo, regra de negócio não escrita e layout interpretado. A spec elimina os três antes do código.

## requirements.md (EARS)

Cada requisito numerado (`R1`, `R2`...) com uma história curta e critérios no formato EARS:

- Ubíquo: `O sistema DEVE <resposta>.`
- Evento: `QUANDO <gatilho>, o sistema DEVE <resposta>.`
- Estado: `ENQUANTO <estado>, o sistema DEVE <resposta>.`
- Indesejado: `SE <condição de erro>, ENTÃO o sistema DEVE <resposta>.`
- Opcional: `ONDE <recurso existe>, o sistema DEVE <resposta>.`

Bons critérios têm valores concretos (limites, formatos, mensagens exatas, arredondamento, perfis de acesso). Para cada regra de negócio, inclua o caso feliz, os limites (zero, máximo, igualdade), os erros e as permissões negadas.

## design.md

Contexto e decisões; componentes e responsabilidades; contratos (rotas, payloads, códigos de erro); modelo de dados e migrações; regras de cálculo com exemplos numéricos; segurança (autenticação, autorização por recurso, validação, segredos, trilha de auditoria); LGPD (dados pessoais tratados, finalidade, mascaramento, retenção); observabilidade (logs estruturados sem dados sensíveis, métricas, correlação); desempenho; alternativas descartadas.

## tasks.md

Checklist com as mesmas tarefas do plano.json, na mesma ordem e com os mesmos ids.

## plano.json (formato exigido por `node .bp/bp.mjs exec plano`)

```json
{
  "resumo": "Uma frase sobre o que será entregue",
  "premissas": ["Premissa conservadora explícita, a validar com o negócio"],
  "riscos": ["Risco e mitigação"],
  "temInterface": true,
  "urlAplicacao": "http://localhost:3000/rota",
  "tarefas": [
    {
      "id": "T1",
      "titulo": "Regra de cálculo do valor líquido do resgate",
      "descricao": "O que fazer e onde, citando caminho:linhas do contexto",
      "tipo": "backend",
      "arquivos": ["src/resgate/calculo.ts", "test/resgate/calculo.test.ts"],
      "criterios": ["QUANDO o resgate for solicitado, o sistema DEVE descontar o IR conforme o regime do participante, arredondando para centavos com HALF_EVEN."],
      "testes": ["deve_aplicar_aliquota_regressiva_de_10_por_cento_apos_10_anos"],
      "requisitos": ["R2"],
      "depende": []
    }
  ]
}
```

`tipo`: `backend`, `frontend`, `teste`, `dados`, `infra`, `documentacao` ou `mecanica` (só mudanças sem lógica). Ids: letras, números, ponto, hífen ou sublinhado. O BP calcula o risco e escolhe o executor (rápido, padrão ou crítico); classificar errado como `mecanica` uma tarefa com lógica é erro de plano.

## Regras de ouro

1. Nenhuma regra de negócio inventada: lacuna vira premissa conservadora, declarada.
2. Tarefas pequenas, fatiadas verticalmente, cada uma entregando valor testável.
3. Testes de regra de negócio antes da interface; contratos antes da implementação.
4. Critério que não dá para testar não é critério.
