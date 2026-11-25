# Modelos e economia de tokens

Fonte: https://kiro.dev/docs/models e https://kiro.dev/docs/models/available-models, consultadas em 25/11/2026. Multiplicadores relativos ao Auto (1,0x).

## Papéis e modelos padrão

| Papel (agente) | Modelo | Esforço | Multiplicador | Por quê |
| --- | --- | --- | --- | --- |
| orquestrador | claude-sonnet-5.5 | medium | 1,3x | coordena e acompanha; pouco texto |
| despachante | claude-haiku-4.5 | low | 0,4x | só roda comandos e delega |
| contexto | claude-haiku-4.5 | low | 0,4x | tarefas mecânicas e determinísticas |
| planejador | claude-opus-5.5 | high | 2,0x | o erro aqui multiplica retrabalho |
| revisor-plano | claude-opus-5.5 | high | 2,0x | barra o retrabalho antes do código |
| executor | claude-sonnet-5.5 | medium | 1,3x | implementação comum, rápida |
| executor-critico | claude-opus-5.5 | high | 2,0x | dinheiro, cálculo, segurança, dados pessoais |
| executor-rapido | claude-haiku-4.5 | low | 0,4x | mudanças mecânicas |
| testador | claude-sonnet-5.5 | medium | 1,3x | testes a partir de critérios |
| revisor-codigo | claude-opus-5.5 | xhigh | 2,0x | revisão financeira detalhada |
| revisor-seguranca | claude-opus-5.5 | max | 2,0x | a documentação do Kiro recomenda `max` para segurança |
| qa-navegador | claude-sonnet-5.5 | low | 1,3x | interação guiada por ferramenta |
| validador | claude-sonnet-5.5 | medium | 1,3x | conferência de evidências |

O Opus 5.5 aparece onde a qualidade evita retrabalho (planejar, revisar, tarefas críticas). Ele tem multiplicador menor que o Opus 5 (2,0x contra 2,2x) e desempenho próximo ao Fable 5.1 segundo a documentação do Kiro.

## Haiku 5.5: maior economia, ID a confirmar

O Haiku 5.5 custa 0,06x até 100 mil tokens (0,3x acima), contra 0,4x do Haiku 4.5. O identificador exato não aparece na documentação consultada, e um ID errado só falha na primeira chamada, sem fallback. Para ativar:

1. `kiro-cli chat --list-models --format json` e confirme o ID (provavelmente `claude-haiku-5.5`).
2. Em `.bp/modelos.json`, acrescente o ID em `politica.modelosConfirmados` e troque os papéis `despachante`, `contexto` e `executor-rapido`.
3. `node .bp/bp.mjs modelos aplicar` (humano) e `node .bp/bp.mjs doutor`.

## Política de modelos (`.bp/modelos.json`)

- `perfil`: `US` ou `EU` (região do perfil Kiro da empresa).
- `permitirRoteamentoGlobal: false`: no perfil EU, GPT-5.6 e Auto usam roteamento Global (processamento fora da geografia).
- `permitirExcluidos: false`: Kimi K3 e modelos em preview são "Kiro Excluded Models", sem a indenização de saída dos AWS Service Terms (seção 50.10).
- `permitirExperimentais: false`, `permitirAuto: false` (o Auto pode rotear para modelos fora da lista aprovada), `permitirRetencao30Dias: false` (Fable 5.1 e 5.2 retêm todo o tráfego por até 30 dias).
- `fornecedoresPermitidos`: por padrão só Anthropic. Para diversidade de revisão com GPT-5.6, libere `openai` com perfil US.

`node .bp/bp.mjs modelos verificar` mostra a tabela e bloqueios; `modelos aplicar` propaga a política para os agentes, as etapas dos workflows e o `chat.modelDefaults`.

## Técnicas de economia aplicadas

1. **Contexto limpo por etapa:** cada etapa do workflow e cada subagente começa sem o histórico; recebe um cartão autossuficiente.
2. **Sem herança de contexto padrão:** `chat.disableInheritingDefaultResources: true`; cada agente declara só o steering mínimo e as skills relevantes.
3. **Skills com divulgação progressiva:** só nome e descrição entram no contexto; o conteúdo carrega quando necessário.
4. **RAG com orçamento:** `rag contexto` entrega só trechos relevantes, mesclados, com citação, dentro do orçamento.
5. **Saídas resumidas:** testes devolvem só falhas (com orçamento), portões só o acionável, diff por arquivo com teto.
6. **Determinístico antes do LLM:** portões, testes, consolidação de revisões e roteiros E2E não gastam tokens.
7. **Modelo e esforço por papel:** o caro só onde compensa; esforço `low` para coordenação.
8. **Hooks enxutos:** sem saída quando não há nada a dizer; hooks do tipo `command` não consomem créditos.
9. **Razão de tokens:** `node .bp/bp.mjs tokens relatorio` aponta onde o contexto está sendo gasto.
10. **Faixas de preço:** o relatório e as skills orientam a manter etapas abaixo de 100 mil tokens (Haiku 5.5) e 272 mil (GPT-5.6).

As contagens do BP são estimativas (os modelos usam tokenizadores diferentes). O consumo real de créditos está no painel do Kiro e nos eventos OpenTelemetry da conta corporativa.
