# Auditoria do Browser Use e decisões do port

Leitura estática (nenhum código do repositório foi executado) de quatro bases, todas MIT:

| Base | Commit | Versão |
| --- | --- | --- |
| browser-use (main) | `94784c1f7ecb6b0a5f565b7f9fba59e395b7e048` | 1.0.8 |
| browser-use (tag 0.13.14) | `2cc71890e65056b67fdb29d98bb407749c15bb08` | 0.13.14 |
| browser-harness | `eec49cec…` | 0.1.14 |
| browser-use-pi | `3583b8a10a2cf393956ad75c32fec302b227aa32` | 0.2.0 |

## Achado principal

A versão 1.0 removeu o serializador de DOM indexado: o modelo passou a escrever Python executado por `exec()` num REPL, incompatível com o requisito. O índice por elemento sobrevive no modo "ultrafast" (`ax.py`, porte do `src/ax.ts` do Pi), baseado só na árvore de acessibilidade. Foi essa a técnica portada, por ser enxuta, estável e já achatar shadow DOM.

## O que foi portado (reescrito em JavaScript)

- Percurso da árvore de acessibilidade: controles indexados por `backendDOMNodeId`, títulos, parágrafos, rótulos deduplicados, resumo de opções de `select`, estados, marcação `*` de elementos novos, corte 80/20 (`src/navegador/serializar.mjs`).
- Ponto de clique com verificação de visibilidade, área visível, oclusão por `elementFromPoint` e deslocamento de iframes de mesma origem (`src/navegador/js-pagina.mjs`).
- Filtro de texto visível com `checkVisibility` para descartar textos ocultos que a árvore mantém.

## O que foi acrescentado

- Transporte CDP por `--remote-debugging-pipe` (sem porta TCP), validado em Chrome e Edge no Windows.
- Guarda de hosts em **todas** as requisições (o 1.0 filtrava só documentos).
- Captura de console, exceções, `Log.entryAdded`, falhas de rede e respostas 4xx/5xx (o 0.x não capturava console).
- Ocultação de valores sensíveis no estado (o 1.0 só mascarava na digitação) e mascaramento de PII.
- Sessão persistente por IPC local com token; roteiros E2E declarativos.

## O que foi rejeitado e por quê

1. Telemetria PostHog ligada por padrão em todas as bases (texto da tarefa, URLs, resultado; identificador de dispositivo por MAC e hostname no 0.x): vazamento para terceiro (LGPD, sigilo).
2. Verificação de atualização, `git pull`, `curl | sh`: tráfego externo e código não revisado.
3. Extensões baixadas sem verificação de assinatura (uBlock Lite, aceite de cookies, Force Background Tab) e `background.js` modificado.
4. Instalação automática do Chromium via Playwright.
5. Integrações de nuvem (navegador remoto, gateway de LLM, busca, captcha).
6. Ação `evaluate` com JavaScript arbitrário e REPL com `exec()`.
7. Flags inseguras: `--no-sandbox`, `--disable-web-security`, `--ignore-certificate-errors`, evasão de detecção de automação, proteção anti-phishing desligada e recursos de privacidade e HTTPS desativados.
8. Aceite automático de diálogos (um `confirm("Confirmar transferência?")` seria aprovado).
9. Permissões de área de transferência e notificações concedidas a todas as origens.
10. Downloads liberados por padrão.
11. Persistência de cookies, storage, HAR e vídeo em texto claro.
12. Uso ou cópia do perfil real do navegador do usuário.
13. Busca em buscadores públicos e heurísticas de formato americano (datas e telefone).

A lista completa de flags aceitas e proibidas está em `src/navegador/navegador.mjs` (`montarFlags` e `FLAGS_PROIBIDAS`).
