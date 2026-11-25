// Gerador dos agentes do Orquestrador BP (fonte única das regras de permissão).
// Uso (no pacote do orquestrador): node ferramentas/gerar-agentes.mjs modelo/.kiro/agents
// O resultado (JSON estático) é versionado e revisado pela Segurança antes de cada release.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const destino = process.argv[2];
mkdirSync(destino, { recursive: true });

const SENSIVEIS = ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.jks', '**/*.keystore', '**/id_rsa*', '**/id_ed25519*', '**/credentials', '**/credentials.json', '**/.npmrc', '**/.pypirc', '**/.netrc'];
// Com o sandbox ativo, estas negações valem também para os comandos de shell (fronteira real).
const PROTEGIDO_ESCRITA = ['.kiro/**', '.kiroignore', '.bp/**', '.git/**', '.gitattributes', '.gitmodules', '.vscode/**', '.idea/**', '.github/**', '.gitlab-ci.yml', 'azure-pipelines*.yml', 'Jenkinsfile', '.husky/**'];
const EXCECAO_ESCRITA = ['.kiro/specs/**', '.bp/estado/entrada/**'];
const SHELL_NEGADO = [
  'git push*', 'git remote*', 'git reset --hard*', 'git clean*', 'git rebase*', 'git filter-branch*', 'git commit --no-verify*', 'git config*', 'git stash*', 'git fetch*', 'git pull*', 'git clone*', 'git submodule*', 'git worktree*',
  'node -e*', 'node --eval*', 'node -p*', 'node --print*', 'node -r*', 'node --require*', 'node --import*', 'python -c*', 'python3 -c*', 'py -c*', 'pwsh -c*', 'pwsh -Command*', 'powershell -c*', 'powershell -Command*', 'powershell -enc*', 'pwsh -enc*', 'cmd /c*', 'bash -c*', 'sh -c*',
  'curl*', 'wget*', 'Invoke-WebRequest*', 'Invoke-RestMethod*', 'iwr *', 'irm *', 'Start-BitsTransfer*', 'bitsadmin*', 'ssh *', 'scp *', 'sftp *', 'ftp *', 'telnet *',
  'npx *', 'pnpx *', 'bunx *', 'uvx *', 'pipx *', 'npm publish*', 'npm install *', 'npm i *', 'npm add *', 'yarn add*', 'pnpm add*', 'pip install*', 'pip3 install*', 'python -m pip*', 'dotnet add*', 'dotnet tool*', 'dotnet nuget*',
  'mvn deploy*', 'mvn release*', 'gradle publish*', './gradlew publish*', 'gradlew publish*', 'choco *', 'winget *', 'scoop *', 'msiexec*',
  'sudo *', 'runas *', 'Start-Process*', 'Set-ExecutionPolicy*', 'reg *', 'schtasks*', 'netsh*', 'icacls*', 'takeown*',
  'aws *', 'az *', 'gcloud *', 'kubectl *', 'helm *', 'terraform *', 'docker push*', 'docker login*', 'docker run*', 'kiro-cli*', 'gh *',
  'node .bp/bp.mjs init*', 'node .bp/bp.mjs instalar*', 'node .bp/bp.mjs iniciar*', 'node .bp/bp.mjs modelos aplicar*',
  'printenv*', 'Get-ChildItem env:*', 'gci env:*', 'dir env:*',
];
const GIT_LEITURA = ['git status*', 'git diff*', 'git log*', 'git show*', 'git blame*', 'git ls-files*', 'git rev-parse*', 'git branch --show-current*'];
const DEV = ['npm test*', 'npm run *', 'npm ci*', 'node --test*', 'mvn *', 'mvnw *', './mvnw *', '.\\mvnw.cmd *', 'gradle *', 'gradlew *', './gradlew *', '.\\gradlew.bat *', 'dotnet build*', 'dotnet test*', 'dotnet restore*', 'dotnet format*', 'python -m pytest*', 'pytest*', 'go test*', 'go build*', 'go vet*', 'git add *', 'git commit -m *', 'git switch -c *', 'git checkout -b *', 'mkdir *', 'New-Item -ItemType Directory*'];

const negacoes = [
  { capability: 'web_fetch', effect: 'deny' },
  { capability: 'web_search', effect: 'deny' },
  { capability: 'mcp', effect: 'deny' },
  { capability: 'power', effect: 'deny' },
  { capability: 'fs_read', match: SENSIVEIS, exclude: ['**/.env.example', '**/.env.sample'], effect: 'deny' },
  { capability: 'fs_write', match: SENSIVEIS, effect: 'deny' },
  { capability: 'fs_write', match: PROTEGIDO_ESCRITA, exclude: EXCECAO_ESCRITA, effect: 'deny' },
  { capability: 'shell', match: SHELL_NEGADO, effect: 'deny' },
];
const leitura = { capability: 'fs_read', match: ['./**'], effect: 'allow' };
const escritaCodigo = { capability: 'fs_write', match: ['./**'], effect: 'allow' };
const shellBp = { capability: 'shell', match: ['node .bp/bp.mjs *', ...GIT_LEITURA], effect: 'allow' };
const shellDev = { capability: 'shell', match: DEV, effect: 'allow' };
const rede = { capability: 'sandbox_network', match: ['localhost', '127.0.0.1'], effect: 'allow' };
const soEscreve = (pastas) => [
  { capability: 'fs_write', match: pastas, effect: 'allow' },
  { capability: 'fs_write', match: ['./**'], exclude: pastas, effect: 'deny' },
];
const soShellBp = { capability: 'shell', match: ['*'], exclude: ['node .bp/bp.mjs *', ...GIT_LEITURA], effect: 'deny' };

const ESSENCIAL = 'file://.kiro/steering/bp-essencial.md';
const sk = (n) => `skill://.kiro/skills/${n}/SKILL.md`;
const EXECUTORES = ['bp-executor', 'bp-executor-critico', 'bp-executor-rapido', 'bp-testador'];
const TODOS = ['bp-contexto', 'bp-planejador', 'bp-revisor-plano', 'bp-despachante', ...EXECUTORES, 'bp-revisor-codigo', 'bp-revisor-seguranca', 'bp-qa-navegador', 'bp-validador'];

const agentes = [
  {
    name: 'bp-orquestrador', model: 'claude-sonnet-5.5',
    description: 'Orquestrador BP (Brasilprev). Recebe a demanda inicial e conduz sozinho todo o ciclo: contexto, especificação, plano, implementação por subagentes, testes, revisões financeira e de segurança, QA no navegador e relatório final. Use para qualquer entrega completa.',
    tools: ['read', 'write', 'shell', ...TODOS.map((n) => `subagent/${n}`)],
    permissions: [leitura, escritaCodigo, shellBp, shellDev, rede, { capability: 'subagent', match: TODOS, effect: 'allow' }, ...negacoes],
    resources: [ESSENCIAL, sk('bp-economia-tokens'), sk('bp-especificacao')],
    welcomeMessage: 'Orquestrador BP pronto. Informe a demanda, as regras de negócio, o layout e onde implementar; o restante é autônomo.',
  },
  {
    name: 'bp-despachante', model: 'claude-haiku-4.5',
    description: 'Despachante de tarefas do BP: pega a próxima tarefa do plano, delega ao executor indicado pela rota de risco (rápido, padrão ou crítico), confere testes e registra conclusão ou falha. Não escreve código.',
    tools: ['read', 'shell', ...EXECUTORES.map((n) => `subagent/${n}`)],
    permissions: [leitura, shellBp, shellDev, rede, { capability: 'subagent', match: EXECUTORES, effect: 'allow' }, escritaCodigo, ...negacoes],
    resources: [ESSENCIAL],
  },
  {
    name: 'bp-contexto', model: 'claude-haiku-4.5',
    description: 'Prepara a execução do BP: registra a demanda, indexa o repositório no RAG local e gera o pacote de contexto com orçamento de tokens. Também executa comandos determinísticos do BP (consolidação de revisões).',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, ...soEscreve(['.bp/estado/entrada/**']), soShellBp, shellBp, ...negacoes],
    resources: [ESSENCIAL, sk('bp-rag-contexto')],
  },
  {
    name: 'bp-planejador', model: 'claude-opus-5.5',
    description: 'Planejador do BP: transforma demanda, regras de negócio e layout em spec Kiro (requisitos EARS, design, tarefas) e em plano.json com critérios de aceite testáveis, premissas explícitas e tarefas pequenas. Não escreve código de produção.',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, ...soEscreve(['.bp/estado/entrada/**', '.kiro/specs/**']), soShellBp, shellBp, ...negacoes],
    resources: [ESSENCIAL, sk('bp-especificacao'), sk('bp-paradigmas-arquitetura'), sk('bp-dominio-previdencia'), sk('bp-lgpd-regulatorio'), sk('bp-rag-contexto')],
  },
  {
    name: 'bp-revisor-plano', model: 'claude-opus-5.5',
    description: 'Revisor de plano do BP: valida requisitos e design antes do código (ambiguidade, testabilidade, segurança, LGPD, regras financeiras, desempenho) para evitar retrabalho. Emite VERDICT: APPROVED ou VERDICT: NEEDS_CHANGES.',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, ...soEscreve(['.bp/estado/entrada/**']), soShellBp, shellBp, ...negacoes],
    resources: [ESSENCIAL, sk('bp-especificacao'), sk('bp-seguranca-appsec'), sk('bp-lgpd-regulatorio'), sk('bp-dominio-previdencia')],
  },
  {
    name: 'bp-executor', model: 'claude-sonnet-5.5',
    description: 'Executor padrão do BP: implementa uma tarefa do plano com TDD (teste primeiro, código mínimo, refatoração), seguindo os padrões de back-end e front-end, e deixa os testes verdes.',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, escritaCodigo, shellBp, shellDev, rede, ...negacoes],
    resources: [ESSENCIAL, sk('bp-backend'), sk('bp-frontend'), sk('bp-qualidade-testes'), sk('bp-paradigmas-arquitetura'), sk('bp-seguranca-appsec'), sk('bp-dominio-previdencia'), sk('bp-rag-contexto')],
  },
  {
    name: 'bp-executor-critico', model: 'claude-opus-5.5',
    description: 'Executor do BP para tarefas de risco alto (dinheiro, cálculo previdenciário, autenticação, autorização, dados pessoais, migrações, concorrência). Implementa com TDD, testes de propriedade e cuidado redobrado com precisão e segurança.',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, escritaCodigo, shellBp, shellDev, rede, ...negacoes],
    resources: [ESSENCIAL, sk('bp-backend'), sk('bp-frontend'), sk('bp-qualidade-testes'), sk('bp-paradigmas-arquitetura'), sk('bp-seguranca-appsec'), sk('bp-lgpd-regulatorio'), sk('bp-dominio-previdencia'), sk('bp-rag-contexto')],
  },
  {
    name: 'bp-executor-rapido', model: 'claude-haiku-4.5',
    description: 'Executor rápido e barato do BP para tarefas mecânicas de baixo risco: renomear, mover, ajustar textos, documentação, boilerplate e formatação, sempre com testes verdes.',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, escritaCodigo, shellBp, shellDev, ...negacoes],
    resources: [ESSENCIAL, sk('bp-qualidade-testes')],
  },
  {
    name: 'bp-testador', model: 'claude-sonnet-5.5',
    description: 'Testador do BP: escreve e corrige testes automatizados (unidade, integração, contrato, propriedade, E2E por roteiro do navegador) a partir dos critérios de aceite, e mantém o loop de testes verde.',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, escritaCodigo, shellBp, shellDev, rede, ...negacoes],
    resources: [ESSENCIAL, sk('bp-qualidade-testes'), sk('bp-navegador-qa'), sk('bp-dominio-previdencia')],
  },
  {
    name: 'bp-revisor-codigo', model: 'claude-opus-5.5',
    description: 'Revisor de código do BP com foco em instituição financeira: correção, precisão monetária, regras de negócio, concorrência, idempotência, tratamento de erros, observabilidade, legibilidade e testes. Registra achados estruturados; não altera código.',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, ...soEscreve(['.bp/estado/entrada/**']), soShellBp, shellBp, ...negacoes],
    resources: [ESSENCIAL, sk('bp-revisao-codigo-financeiro'), sk('bp-paradigmas-arquitetura'), sk('bp-dominio-previdencia'), sk('bp-qualidade-testes')],
  },
  {
    name: 'bp-revisor-seguranca', model: 'claude-opus-5.5',
    description: 'Revisor de segurança do BP: OWASP ASVS, Top 10, CWE Top 25, autenticação, autorização, criptografia, injeção, segredos, LGPD e requisitos regulatórios, com modelagem de ameaças do diff. Registra achados estruturados; não altera código.',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, ...soEscreve(['.bp/estado/entrada/**']), soShellBp, shellBp, ...negacoes],
    resources: [ESSENCIAL, sk('bp-seguranca-appsec'), sk('bp-lgpd-regulatorio')],
  },
  {
    name: 'bp-qa-navegador', model: 'claude-sonnet-5.5',
    description: 'QA de interface do BP: sobe a aplicação local, navega no Chrome/Edge pelo controle de navegador do BP (sem MCP), valida layout, fluxos, acessibilidade, console e rede contra os critérios de aceite e grava roteiros E2E reutilizáveis.',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, ...soEscreve(['.bp/estado/entrada/**', 'e2e/**', 'tests/e2e/**', 'test/e2e/**']), shellBp, shellDev, rede, ...negacoes],
    resources: [ESSENCIAL, sk('bp-navegador-qa'), sk('bp-frontend')],
  },
  {
    name: 'bp-validador', model: 'claude-sonnet-5.5',
    description: 'Validador final do BP: confere cada critério de aceite (EARS) contra evidências reais (testes, portões, revisões, roteiros do navegador) e gera o relatório final da execução.',
    tools: ['read', 'write', 'shell'],
    permissions: [leitura, ...soEscreve(['.bp/estado/entrada/**']), shellBp, shellDev, rede, ...negacoes],
    resources: [ESSENCIAL, sk('bp-especificacao'), sk('bp-navegador-qa')],
  },
];

for (const a of agentes) {
  const json = {
    name: a.name,
    description: a.description,
    prompt: `file://../../.bp/prompts/${a.name}.md`,
    model: a.model,
    tools: a.tools,
    excludedTools: ['web'],
    includeMcpJson: false,
    includePowers: false,
    resources: a.resources,
    permissions: { rules: a.permissions },
    ...(a.welcomeMessage ? { welcomeMessage: a.welcomeMessage } : {}),
  };
  writeFileSync(join(destino, `${a.name}.json`), `${JSON.stringify(json, null, 2)}\n`);
}
console.log(`${agentes.length} agentes gerados`);
