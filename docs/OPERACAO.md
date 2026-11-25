# Operação

## Escrevendo a demanda (o que evita retrabalho)

Uma mensagem, quatro blocos. Quanto mais concreto, menos premissas:

- **Demanda:** o resultado esperado, para quem e por quê.
- **Regras de negócio:** limites, cálculos com exemplo numérico, arredondamento, prazos, perfis de acesso, mensagens de erro exatas.
- **Layout:** campos, rótulos, ordem, textos, estados (vazio, carregando, erro), comportamento em tela pequena. Pode citar um arquivo do repositório com o protótipo.
- **Destino:** módulos, serviços ou pastas.

Modelos em `.bp/exemplos/`.

## Onde ficam as coisas

| Caminho | Conteúdo |
| --- | --- |
| `.kiro/specs/<slug>/` | requisitos EARS, design e tarefas (versionar) |
| `.bp/estado/execucao/DEMANDA.md` | demanda consolidada |
| `.bp/estado/execucao/execucao.json`, `status.json` | estado da execução (só o BP escreve) |
| `.bp/estado/execucao/CORRECOES.md` | pendências da rodada de revisão |
| `.bp/estado/execucao/RELATORIO.md` | relatório final |
| `.bp/estado/execucao/revisoes/` | revisões registradas e veredito |
| `.bp/estado/testes/ultimo.json`, `portoes/ultimo.json` | últimos resultados |
| `.bp/estado/navegador/capturas/` | capturas de tela (não versionar) |
| `.bp/estado/auditoria/eventos.jsonl` | trilha com hash encadeado |
| `.bp/estado/execucao-<id>/` | execuções anteriores arquivadas |

## Comandos do dia a dia

```bash
node .bp/bp.mjs doutor
node .bp/bp.mjs exec status
node .bp/bp.mjs testes
node .bp/bp.mjs portoes
node .bp/bp.mjs exec relatorio
node .bp/bp.mjs tokens relatorio
node .bp/bp.mjs auditoria verificar
node .bp/bp.mjs ajuda
```

## Retomada

O estado vive em arquivos: se a sessão cair, uma nova sessão do `bp-orquestrador` continua de onde parou (`exec proxima` retoma a tarefa em andamento). Workflows do Kiro também fazem checkpoint por etapa e podem ser retomados pelo próprio Kiro.

## Solução de problemas

| Sintoma | Causa provável e ação |
| --- | --- |
| Agentes, hooks ou skills não aparecem | Workspace não confiável: confie no workspace no Kiro. Na CLI, responda "Trust" na primeira execução. |
| Primeiro prompt falha com modelo indisponível | ID não habilitado na conta: `kiro-cli chat --list-models`, ajuste `.bp/modelos.json`, `modelos aplicar`. |
| Subagente parado pedindo aprovação | Regra de permissão ausente no agente pai; não use regras de usuário mais restritivas que as do BP sem ajustar os agentes. |
| `[BP-GUARDA] Bloqueado` | A ação viola a política; a mensagem diz a alternativa. Supressões e exceções são decisão humana. |
| "Nenhuma suíte de testes detectada" | Configure `testes.comandos` em `.bp/config.json`. |
| QA reprova por "aplicação não configurada" | Configure `aplicacao.comando` e `aplicacao.url`. |
| Navegador não inicia | `navegador.executavel` com o caminho do Chrome ou Edge; `doutor` mostra o detectado. |
| Sandbox indisponível no Windows | Modo `DEFAULT_BLOCKED` não exige setup; outros modos exigem `/sandbox setup` como administrador. |
| Trilha de auditoria adulterada | Trate como incidente: preserve a pasta `.bp/estado/` e acione Segurança da Informação. |
| "Estado adulterado ou gravado fora do BP" | Um arquivo de estado perdeu a assinatura válida (edição manual ou tentativa do agente). Trate como incidente; para recomeçar, inicie nova execução (a anterior é arquivada). |
| Troca de máquina | A chave de integridade é local (`%LOCALAPPDATA%\orquestrador-bp\chaves`); o estado de `.bp/estado/` não migra entre máquinas, comece nova execução. |

## Atualizando o orquestrador

Rode `init --destino <repo> --forcar` com a versão nova (o que for substituído vai para `.bp/backup-<data>/`), revise o diff de `.kiro/` e `.bp/` e versione.
