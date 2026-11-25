# Fontes consultadas

Documentação oficial do Kiro, índice `https://kiro.dev/llms.txt` com as 305 páginas em Markdown, lidas em 25/11/2026. As decisões do orquestrador se apoiam principalmente nestas:

| Tema | Página |
| --- | --- |
| Arquitetura do agente | https://kiro.dev/docs/how-kiro-works |
| Modelos, multiplicadores, regiões | https://kiro.dev/docs/models e https://kiro.dev/docs/models/available-models |
| Esforço de raciocínio | https://kiro.dev/docs/models/effort |
| Agentes customizados | https://kiro.dev/docs/custom-agents/configuration-reference |
| Subagentes e permissões herdadas | https://kiro.dev/docs/custom-agents/subagents |
| Workflows (grafo, loops, paralelo, modelo por etapa) | https://kiro.dev/docs/workflows e https://kiro.dev/docs/workflows/authoring |
| Hooks (gatilhos, códigos de saída, decisões) | https://kiro.dev/docs/hooks e https://kiro.dev/docs/hooks/types |
| Permissões e confiança do workspace | https://kiro.dev/docs/permissions |
| Sandbox local de comandos | https://kiro.dev/docs/sandbox |
| Steering e AGENTS.md | https://kiro.dev/docs/steering |
| Skills | https://kiro.dev/docs/skills |
| Base de conhecimento local | https://kiro.dev/docs/cli/experimental/knowledge-management |
| Modo headless | https://kiro.dev/docs/cli/headless |
| Comandos e configurações da CLI | https://kiro.dev/docs/reference/cli-commands e https://kiro.dev/docs/reference/settings |
| Specs (EARS, bugfix) | https://kiro.dev/docs/specs |
| Governança corporativa e KGL | https://kiro.dev/docs/enterprise/governance e https://kiro.dev/docs/enterprise/enterprise-management/kgl |
| Proteção de dados e regiões | https://kiro.dev/docs/privacy-and-security/data-protection |
| Termos de uso por automação de terceiros | https://kiro.dev/docs/billing/related-questions |
| Kiro Crew (avaliado e descartado: depende de MCP e downloads) | https://kiro.dev/docs/crew |

Fatos que a documentação não confirmou e ficaram como verificação na instalação: identificador exato do Claude Haiku 5.5 (o `doutor` consulta `kiro-cli chat --list-models`), comportamento do sandbox com processos do navegador e tempo máximo de hooks no IDE.

Browser Use: ver `AUDITORIA-BROWSER-USE.md` e `THIRD_PARTY_NOTICES.md`.
