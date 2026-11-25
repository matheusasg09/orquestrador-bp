# Governança no Kiro (para administradores)

Os controles do repositório (agentes, hooks, sandbox) valem no cliente. Para garantia corporativa, o administrador do Kiro da Brasilprev deve aplicar também a governança central. Este documento resume o que a documentação oficial oferece (consultada em 25/11/2026); valide cada item no console antes de publicar.

## Recomendações

1. **Conta gerenciada:** acesso por IAM Identity Center ou IdP corporativo (Entra ID ou Okta). Bloqueie login social e AWS Builder ID. Conteúdo de contas gerenciadas não é usado para treinar modelos.
2. **Modelos:** ative a governança de modelos com lista explícita e modelo padrão travado, alinhada com `.bp/modelos.json`. Bloqueie Auto se a política exigir que tudo rode em modelos aprovados.
3. **MCP:** desligue no nível da organização (`mcp_tools.enabled: !locked false` ou o interruptor do console). A documentação registra comportamento inesperado de regras `mcp` do tipo deny; prefira a configuração.
4. **Web tools:** desligue `web_search` e `web_fetch` (aplicado pelo serviço).
5. **Sandbox obrigatório:** `sandbox.required`, `sandbox.network_mode: default_blocked`, `sandbox.fs_mode: block`.
6. **Chaves de API:** negue a criação, salvo a conta de serviço do CI, se houver uso headless.
7. **Cloud sessions e Kiro Web:** desligue, a menos que o repositório esteja autorizado para execução na nuvem da AWS (a Web clona o repositório para um sandbox gerenciado e não aplica `permissions.yaml`).
8. **Atualizações gerenciadas:** fixe a versão homologada do IDE e da CLI.
9. **Auditoria:** prompt logging para bucket S3 próprio, relatório de atividade e eventos OpenTelemetry (consumo de créditos por modelo e por subagente), CloudTrail para chamadas de ferramenta.
10. **Rede:** libere apenas os domínios de serviço do Kiro exigidos na documentação de firewall; em inspeção TLS, use o modo de troca de chaves clássico indicado pela documentação.

## Exemplo de política KGL (ponto de partida)

Atenção às armadilhas documentadas: qualquer regra em `fs_read`, `fs_write`, `shell`, `web_search`, `web_fetch` ou `mcp` liga negação padrão para todo o perfil nessa capacidade, por isso o exemplo parte de `ask` em todas; um campo opcional digitado errado (por exemplo `matches:`) não gera erro e faz a regra cobrir tudo; IDs de modelo não levam prefixo `anthropic.`.

```yaml
rules:
  - { id: piso-fs-read, capability: fs_read, effect: ask }
  - { id: piso-fs-write, capability: fs_write, effect: ask }
  - { id: piso-shell, capability: shell, effect: ask }
  - { id: piso-web-search, capability: web_search, effect: ask }
  - { id: piso-web-fetch, capability: web_fetch, effect: ask }
  - { id: piso-mcp, capability: mcp, effect: ask }
  - id: segredos-leitura
    capability: fs_read
    effect: deny
    match: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.pfx", "**/*.jks", "**/secrets/**"]
  - id: segredos-escrita
    capability: fs_write
    effect: deny
    match: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.pfx", "**/*.jks", "**/secrets/**"]
  - id: shell-proibido
    capability: shell
    effect: deny
    match: ["git push *", "curl *", "wget *", "Invoke-WebRequest *", "npx *", "sudo *", "rm -rf *"]
  - id: modelos-aprovados
    capability: model_use
    effect: allow
    match: ["claude-opus-5.5", "claude-sonnet-5.5", "claude-haiku-4.5"]
  - { id: sem-chave-api, capability: apikey_create, effect: deny }
settings:
  model_governance.enabled: !locked true
  default_model: !locked "claude-sonnet-5.5"
  mcp_tools.enabled: !locked false
  web_tools.enabled: !locked false
  cloud_sessions.enabled: !locked false
  sandbox.required: !locked "required"
  sandbox.network_mode: !locked "default_blocked"
```

As capacidades `subagent`, `skill`, `power` e agentes autônomos não têm controle KGL: o que eles fazem por dentro segue as regras de arquivo, shell, web e MCP acima.

## Permissões de usuário opcionais

O agente padrão do Kiro (fora dos agentes `bp-*`) não tem as regras do BP. Para cobri-lo, cada desenvolvedor pode copiar `.bp/exemplos/permissions.usuario.yaml` para `~/.kiro/settings/permissions.yaml` (escopo do usuário, fora do repositório).
