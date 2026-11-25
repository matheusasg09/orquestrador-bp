# Segurança e modelo de ameaças

## Premissa

O agente de IA é tratado como **não confiável**: ele pode ser induzido por conteúdo de páginas web, arquivos do repositório, saídas de ferramentas ou da própria demanda (prompt injection). E, por ser um agente de desenvolvimento, ele **escreve e executa código** (testes, scripts do projeto). Por isso nenhuma análise de texto de comando consegue, sozinha, impedir um agente determinado: a segurança precisa vir de barreiras que o código executado não atravessa.

## Onde está a fronteira

| Barreira | O que garante |
| --- | --- |
| **Permissões do Kiro em lista positiva** | Cada agente só tem `allow` para o que precisa; tudo o mais pede aprovação, e em execução headless pedido vira negação. O disparo headless do BP **não usa `--trust-all-tools`**. `deny` vence qualquer `allow` em qualquer escopo. |
| **Sandbox local obrigatório** | `.kiro/settings/sandbox.json` com `DEFAULT_BLOCKED`: comandos do agente ficam sem rede (exceto localhost). Pela documentação do Kiro, as regras `fs_read`/`fs_write` do agente também delimitam o que os comandos sandboxed veem e gravam: as negações de escrita em `.kiro/**`, `.bp/**` (exceto `.bp/estado/entrada`), `.git/**`, IDE e CI valem mesmo para um script executado pelo agente. Headless usa `--sandbox`: sem sandbox, não começa. O `doutor` trata sandbox desligado como erro. |
| **Invariantes do Kiro** | Escrita em `.kiro/settings` sempre negada; escrita em `.kiro/agents`, `hooks`, `workflows` e `.git` sempre pergunta (negada em headless). Workspace não confiável não carrega configuração do repositório. |
| **Estado assinado (HMAC-SHA256)** | Resultados de testes, portões, execução, status, revisões, veredito, registro da aplicação e âncora de auditoria são assinados com chave por repositório guardada **fora do workspace** (`%LOCALAPPDATA%\orquestrador-bp\chaves`). Um arquivo forjado pelo agente não passa na verificação: concluir tarefa, consolidar revisão, gerar relatório e parar a aplicação recusam estado sem assinatura válida. |
| **Navegador isolado na rede** | Proxy local filtrante por onde passa todo o tráfego do navegador (HTTP, HTTPS, WebSocket, inclusive loopback) mais a guarda `Fetch.requestPaused` no CDP; WebRTC sem UDP fora do proxy; CDP por pipe sem porta TCP. |
| **ACL do sistema operacional (recomendado)** | No ambiente corporativo, rodar o Kiro com um usuário sem privilégios e com `.kiro\` e `.bp\` somente leitura para esse usuário (exceto `.bp\estado\entrada`), e sem acesso à pasta de chaves de outro usuário. Ver "Endurecimento corporativo".

Este modelo foi corrigido após uma revisão de segurança independente que demonstrou, com provas de conceito, 17 problemas na primeira versão (entre eles contorno da guarda de shell, fluxos alternativos NTFS, falha aberta do hook e WebSocket fora da guarda do navegador). Todos foram corrigidos e cada um tem teste de regressão em `test/regressao-revisao.test.mjs`. |

## Camadas de defesa em profundidade

Não são a fronteira, mas detectam cedo, explicam o bloqueio ao agente e reduzem o que chega às barreiras:

- **Hooks `PreToolUse`** (`pre-shell`, `pre-escrita`, `pre-leitura`, `pre-ferramenta`): analisam comando (segmentos, subexpressões, envoltórios como `env` e `Start-Process`, shells aninhados, aspas e escapes de ofuscação, APIs .NET, curingas e redirecionamentos em caminhos de segredo) e caminhos (forma canônica, recusa de fluxos alternativos NTFS, nomes curtos 8.3 e componentes ambíguos, leitura e escrita fora do workspace, governança, estado, IDE e CI). Conteúdo escrito com segredo, CPF real ou supressão de portão é recusado. **Qualquer erro no hook resulta em bloqueio** (código 2), inclusive entrada grande demais ou configuração inválida.
- **Portões determinísticos**: segredos (com e sem aspas), PII com dígito verificador, padrões inseguros e financeiros, testes desabilitados, supressões novas, governança alterada. Segredos e PII são verificados em linhas de qualquer tamanho, em arquivos com byte nulo e em pastas ignoradas; com execução ativa, a comparação é sempre contra a base Git da execução.
- **Git blindado**: as consultas do BP neutralizam `core.fsmonitor`, hooks, diff externo, textconv e pager do repositório, que permitiriam executar código ao rodar os portões.
- **Trilha de auditoria** com hash encadeado e âncora externa assinada (número de eventos e último hash): edição, remoção, truncamento e apagamento são detectados.
- **Mascaramento** de CPF, CNPJ, cartão e segredos em toda saída do BP, no RAG, no navegador e nos registros; valores de `${env:BP_TESTE_*}` ocultos nas saídas dos roteiros.

## Ameaças e respostas

| Ameaça | Resposta principal | Defesa adicional |
| --- | --- | --- |
| Exfiltração por rede a partir de comando ou script | sandbox sem rede | `deny` de comandos de rede, guarda de shell |
| Exfiltração pelo navegador (fetch, imagem, WebSocket, WebRTC) | proxy filtrante e guarda CDP | navegação só para http(s) de host permitido |
| Leitura de segredos | `deny` de leitura e `.kiroignore` | hook de leitura canônico; RAG nunca indexa nem expõe |
| Forjar "testes verdes", "revisão aprovada" ou "tarefa concluída" | estado assinado com chave fora do workspace | escrita no estado negada por permissão, sandbox e hook |
| Alterar agentes, hooks, política ou prompts | `deny` de escrita + invariantes do Kiro + sandbox | hook; portão acusa governança alterada |
| Esconder achados (`bp-ignorar`) | hook recusa a escrita | portão denuncia supressão nova no diff |
| Dependência maliciosa | `deny` de instalação e execução sob demanda | guarda de shell |
| Executar código via configuração Git | `deny` de `git config` | consultas Git do BP neutralizadas |
| Matar processo alheio por PID forjado | registro da aplicação assinado | PIDs de sistema, próprio e pai recusados |
| Apagar ou truncar a trilha de auditoria | âncora externa assinada | escrita no estado negada |
| Dado pessoal enviado ao modelo | mascaramento nas saídas do BP | portões e hooks impedem dado real no código |

## Riscos residuais (leia antes de homologar)

1. **O agente executa código.** Testes e scripts do projeto rodam com o usuário do Kiro. Sem rede (sandbox) e sem escrita na governança (regras do agente aplicadas pelo sandbox), o dano fica restrito à árvore de trabalho, que a pessoa revisa no diff. Se o sandbox não puder ser ativado na máquina, essa contenção não existe: no modo interativo o Kiro avisa e segue; em headless, o BP exige `--sandbox`.
2. **Comportamento do sandbox no Windows.** A documentação do Kiro descreve o modelo; a homologação deve confirmar, na versão adotada, que um script do agente não consegue gravar em `.kiro\` e `.bp\` nem abrir conexão externa. Roteiro sugerido em "Verificação de homologação".
3. **Hooks dependem do Node.js.** Sem `node` no PATH, o Kiro trata a falha do hook como aviso. As barreiras acima continuam valendo; o `doutor` acusa a ausência.
4. **A guarda de shell é heurística** e cobre os casos conhecidos e testados (ver `test/regressao-revisao.test.mjs`); não deve ser tratada como barreira.
5. **A chave de integridade fica no perfil do usuário.** Protege contra o agente (leitura fora do workspace negada por hook, permissões e sandbox), não contra alguém com acesso ao perfil. Para trilha de valor legal, exporte os eventos para um repositório externo da empresa.
6. **Inferência fora do Brasil.** Os modelos do Kiro processam em geografias US ou EU. A política padrão bloqueia roteamento Global, modelos experimentais, excluídos da indenização da AWS e com retenção de 30 dias. A decisão de uso é do Jurídico e do Compliance.
7. **Administração local** pode contornar controles de cliente; para garantia corporativa, aplique a governança central (`GOVERNANCA-KIRO.md`).

## Endurecimento corporativo (recomendação para a TI)

- Usuário Windows dedicado e sem privilégio de administrador para o Kiro; o desenvolvedor revisa e faz o commit com o próprio usuário.
- ACL do repositório para o usuário do Kiro: leitura em `.kiro\` e `.bp\`; leitura e escrita só em `.bp\estado\` (a ferramenta grava ali) e no código. Exemplo, a adaptar pela equipe de infraestrutura:

```text
icacls .kiro /inheritance:r /grant:r "%USERDOMAIN%\usuario-kiro:(OI)(CI)RX" /grant:r "Administradores:(OI)(CI)F"
icacls .bp\config.json /grant:r "%USERDOMAIN%\usuario-kiro:R"
```

- Pasta de chaves (`BP_DIR_CHAVES`) em local que o usuário do Kiro não consiga listar por outros meios, se a política assim exigir.
- Proxy corporativo e firewall bloqueando saída da máquina de desenvolvimento, exceto os domínios do Kiro.

## Verificação de homologação

```bash
node .bp/bp.mjs doutor
node .bp/bp.mjs auditoria verificar
```

No Kiro, com o agente `bp-executor`, peça explicitamente (em ambiente de teste) para: criar um script que grave em `.kiro/hooks/` e executá-lo; executar `node` com um script que faça requisição HTTP externa; ler `.env`; gravar `.bp/estado/testes/ultimo.json` e concluir a tarefa. Todos devem falhar. Registre as evidências no processo de homologação.

Na pasta do orquestrador: `npm test` (inclui a regressão de cada achado da revisão de segurança) e `npm run verificar`.
