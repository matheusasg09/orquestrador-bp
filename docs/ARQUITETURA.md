# Arquitetura

## Princípio

O Kiro é o motor: agentes, subagentes, workflows, hooks, steering, skills, permissões e sandbox são recursos nativos dele. O Orquestrador BP é a camada que configura esse motor para a Brasilprev e acrescenta o que o Kiro não tem pronto: RAG local com orçamento, máquina de estados auditável, portões determinísticos, veredito de revisão por regra fixa, roteamento de modelo por risco e controle de navegador sem MCP.

O BP nunca chama modelos diretamente. Toda inferência passa pelas interfaces oficiais do Kiro (IDE, CLI, headless), como exigem os termos de uso do Kiro, que proíbem harnesses de terceiros que levem requisições para fora das interfaces nativas.

## Camadas

```text
┌───────────────────────────── Kiro (IDE ou CLI V3) ─────────────────────────────┐
│ Workflow bp-entrega (grafo nativo: etapas, loops, paralelo, modelo por etapa)  │
│   └─ agentes .kiro/agents/bp-*.json  (prompt em .bp/prompts, skills, regras)   │
│ Hooks .kiro/hooks/bp-guardas.json ──► node .bp/bp.mjs gancho <tipo>            │
│ Permissões por agente (allow/deny) + sandbox local (rede bloqueada)            │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │ shell: node .bp/bp.mjs ...
┌───────────────────────────────────────▼────────────────────────────────────────┐
│ Ferramenta BP (.bp/ferramenta, Node.js puro)                                   │
│  rag/       índice híbrido BM25 + vetores TF-IDF de trigramas, pacotes c/ orçam. │
│  estado/    execução (plano, tarefas, fases), revisões, validação, auditoria   │
│  portoes/   segredos, PII, regras inseguras e financeiras, tamanho, governança │
│  ciclo/     testes (só falhas), aplicação local para QA                         │
│  navegador/ Chrome/Edge por CDP em pipe, guarda de hosts, AX indexada, roteiros │
│  ganchos/   guarda de shell e escrita, contexto no prompt, parada, compactação │
│  modelos/   política de modelos e roteamento por risco                         │
└────────────────────────────────────────────────────────────────────────────────┘
                     Estado em .bp/estado/ (fora do Git, fonte de verdade)
```

## Fluxo do workflow `bp-entrega`

| Etapa | Agente | Modelo padrão | Saída |
| --- | --- | --- | --- |
| preparar | bp-contexto | Haiku 4.5 / low | execução iniciada, índice RAG, `contexto.md` |
| planejar (loop até 3x) | bp-planejador | Opus 5.5 / high | spec Kiro + `plano.json` importado |
| revisar-plano | bp-revisor-plano | Opus 5.5 / high | `VERDICT: APPROVED` ou correções |
| executar-tarefa (loop até completar) | bp-despachante | Haiku 4.5 / low | delega por risco, testes, conclusão |
| ↳ subagente | bp-executor-rapido / bp-executor / bp-executor-critico / bp-testador | Haiku / Sonnet 5.5 / Opus 5.5 / Sonnet 5.5 | código com TDD |
| corrigir (loop de revisão até 3x) | bp-despachante | Haiku 4.5 / low | correções, testes, portões |
| revisões em paralelo | bp-revisor-codigo, bp-revisor-seguranca, bp-qa-navegador | Opus 5.5 xhigh, Opus 5.5 max, Sonnet 5.5 low | revisões JSON registradas |
| consolidar | bp-contexto | Haiku 4.5 / low | veredito determinístico + `CORRECOES.md` |
| validar | bp-validador | Sonnet 5.5 / medium | validação por critério + `RELATORIO.md` |

Os loops param por arquivo (`fileCheck` em `.bp/estado/execucao/status.json`) e têm teto finito (`maxIterations`), com `onMaxIterations: continue`: a execução nunca fica parada esperando alguém; o que não fechou aparece como pendência no relatório.

## Por que despachante + executores

O Kiro fixa o modelo por etapa do workflow e o modelo por agente. Para escolher o modelo conforme o risco de cada tarefa, um despachante barato (Haiku) lê o cartão gerado por `exec proxima` e delega ao executor da rota calculada: mecânico no Haiku, comum no Sonnet 5.5, crítico (dinheiro, cálculo, autenticação, dados pessoais, migração) no Opus 5.5.

## Modo sem workflows

Se a conta não tiver workflows, o `bp-orquestrador` executa a mesma sequência chamando os subagentes diretamente (`subagent/bp-*`), com os mesmos comandos de estado.

## Estado e contratos

- `.bp/estado/execucao/execucao.json` e `status.json`: só os comandos do BP escrevem (os hooks bloqueiam escrita direta do agente).
- `.bp/estado/entrada/`: área onde os agentes gravam artefatos (plano, revisões, validação, contexto). O BP valida o esquema ao importar.
- `.bp/estado/auditoria/eventos.jsonl`: trilha com hash encadeado e âncora externa assinada.
- Estado calculado (execução, status, testes, portões, revisões, veredito, aplicação) é assinado com HMAC-SHA256; a chave por repositório fica fora do workspace, em `%LOCALAPPDATA%\orquestrador-bp\chaves` (ou `BP_DIR_CHAVES`).
- `.kiro/specs/<slug>/`: spec do Kiro (requirements, design, tasks), versionável.

## Decisões técnicas

- **Node.js puro:** o único runtime exigido; sem npm, sem supply chain. Testes com `node:test`.
- **CDP por pipe (`--remote-debugging-pipe`):** nenhuma porta TCP aberta; validado no Chrome 158 e Edge 158 no Windows.
- **Proxy filtrante do navegador:** todo o tráfego, inclusive WebSocket e loopback, passa por um proxy local que só encaminha para hosts permitidos (a interceptação do CDP não cobre WebSocket).
- **RAG local sem modelo de embeddings:** vetores TF-IDF de trigramas (tolerantes a flexão e a identificadores) + BM25, fundidos por RRF. Determinístico, auditável, sem download de modelo. A base `knowledgeBase` semântica nativa do Kiro pode complementar documentação extensa.
- **Veredito por regra fixa:** revisores só produzem achados; quem aprova é o código (`revisao consolidar`).
