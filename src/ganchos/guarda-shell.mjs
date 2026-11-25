// Guarda de comandos de shell para o hook PreToolUse.
//
// IMPORTANTE: esta guarda é DEFESA EM PROFUNDIDADE e alerta precoce, não a fronteira de
// segurança. Como o agente de desenvolvimento escreve e executa código (testes), um texto
// de shell nunca pode ser classificado com certeza. A fronteira real é: permissões do Kiro
// em lista positiva (sem --trust-all-tools), sandbox obrigatório (rede bloqueada; regras
// fs_write deny valem também para comandos), estado assinado com chave fora do workspace
// e, no ambiente corporativo, ACL do sistema operacional (ver docs/SEGURANCA.md).

import { resolve, isAbsolute } from 'node:path';
import { estaDentro } from '../core/caminhos.mjs';
import { casaAlgum, globParaRegex } from '../core/glob.mjs';
import { ehArquivoSensivel } from '../core/sensiveis.mjs';
import { analisarArgs } from '../core/args.mjs';

const LIMITE_COMANDO = 32 * 1024;
const MAX_SUBEXPRESSOES = 32;

const REDE = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod', 'start-bitstransfer', 'bitsadmin', 'nc', 'ncat', 'netcat', 'telnet', 'ssh', 'scp', 'sftp', 'ftp', 'tftp', 'rsync', 'socat', 'nslookup', 'dig', 'resolve-dnsname', 'test-netconnection', 'tnc', 'aria2c', 'httpie', 'http', 'xh', 'certutil', 'mshta', 'rundll32', 'regsvr32', 'msbuild', 'installutil', 'cscript', 'wscript', 'send-mailmessage', 'new-pssession', 'enter-pssession', 'invoke-command', 'copy-item-remote']);
const NUVEM = new Set(['aws', 'az', 'gcloud', 'gsutil', 'bq', 'kubectl', 'helm', 'terraform', 'tofu', 'pulumi', 'eksctl', 'oc', 'sam', 'cdk', 'serverless', 'sls', 'vercel', 'firebase', 'heroku', 'flyctl', 'kiro-cli', 'kiro', 'gh', 'glab']);
const SISTEMA = new Set(['reg', 'regedit', 'schtasks', 'sc', 'net', 'net1', 'netsh', 'set-executionpolicy', 'bcdedit', 'diskpart', 'format', 'mkfs', 'dd', 'shutdown', 'restart-computer', 'stop-computer', 'takeown', 'icacls', 'cacls', 'runas', 'sudo', 'su', 'doas', 'chown', 'new-service', 'set-service', 'new-localuser', 'add-localgroupmember', 'set-mppreference', 'add-mppreference', 'wmic', 'vssadmin', 'cipher', 'mount', 'umount', 'systemctl', 'launchctl', 'crontab', 'at', 'set-itemproperty', 'new-itemproperty', 'stop-process', 'kill', 'taskkill', 'pkill', 'killall', 'set-acl', 'mklink', 'new-psdrive', 'subst', 'fsutil', 'attrib']);
const GERENCIADORES_SO = new Set(['choco', 'winget', 'scoop', 'apt', 'apt-get', 'yum', 'dnf', 'brew', 'pacman', 'snap', 'msiexec', 'install-module', 'install-package', 'install-script']);
const INTERPRETADORES = new Set(['node', 'python', 'python3', 'py', 'pwsh', 'powershell', 'ruby', 'perl', 'php', 'deno', 'bun', 'cmd', 'bash', 'sh', 'zsh', 'osascript', 'java', 'jshell', 'dotnet-script', 'csi']);
const SHELLS = new Set(['cmd', 'bash', 'sh', 'zsh', 'pwsh', 'powershell']);
// Prefixos que executam o comando seguinte: o restante é avaliado como comando próprio.
const ENVOLTORIOS = new Set(['env', 'timeout', 'nohup', 'nice', 'time', 'xargs', 'start-process', 'saps', 'start', 'call', 'exec', 'command', 'builtin', 'stdbuf', 'watch', 'invoke-item', 'ii', 'cmd.exe', 'start-job', 'invoke-expression']);
const SOMENTE_LEITURA = new Set(['cat', 'type', 'get-content', 'gc', 'more', 'less', 'head', 'tail', 'ls', 'dir', 'get-childitem', 'gci', 'grep', 'rg', 'findstr', 'select-string', 'sls', 'wc', 'measure-object', 'test-path', 'stat', 'get-item', 'gi', 'resolve-path', 'tree', 'file', 'diff', 'fc', 'compare-object']);
const NOMES_SENSIVEIS = ['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', 'credentials', 'credentials.json', 'chave.pem', 'chave.key', 'cert.pfx', 'cert.p12', 'loja.jks', '.npmrc', '.netrc', '.pypirc', 'secrets.json'];

/** Componente .kiro ou .bp (exceto .bp/estado/entrada), .kiroignore e .git como caminho. */
const PROTEGIDOS = /(?:^|[\s"'=(,;/\\])(?:\.kiro(?![\w-])|\.kiroignore|\.git(?:[/\\]|\s|$|["')])|\.bp(?![\w-])(?![/\\]estado[/\\]entrada(?:[/\\]|\s|$|["')])))/i;

function normalizarToken(t) {
  // Remove aspas, crase de escape do PowerShell e circunflexo do cmd: 'cu'rl, c^url, c`url viram curl.
  return t.replace(/["'`^]/g, '');
}

function nomesDoPrograma(token) {
  const limpo = normalizarToken(token).replace(/^&/, '');
  const base = (limpo.split(/[/\\]/).pop() ?? limpo).toLowerCase().replace(/\.(exe|cmd|bat|ps1|com)$/i, '');
  // No Bash "c\url" é "curl": também testa o token sem barras invertidas.
  const semBarra = limpo.replace(/\\/g, '').toLowerCase().replace(/\.(exe|cmd|bat|ps1|com)$/i, '');
  return [...new Set([base, semBarra])];
}

/** Divide em segmentos por ; && || | & e quebras de linha, respeitando aspas. Guarda o separador. */
export function segmentar(comando) {
  const segmentos = [];
  let atual = '';
  let aspas = null;
  let separador = null;
  const empurrar = (sep) => {
    segmentos.push({ texto: atual.trim(), aposPipe: separador === '|' });
    atual = '';
    separador = sep;
  };
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i];
    if (aspas) {
      if (c === aspas) aspas = null;
      atual += c;
      continue;
    }
    if (c === '"' || c === "'") {
      aspas = c;
      atual += c;
      continue;
    }
    const dois = comando.slice(i, i + 2);
    if (dois === '&&' || dois === '||') {
      empurrar(dois);
      i++;
      continue;
    }
    if (c === ';' || c === '\n' || c === '\r') {
      empurrar(';');
      continue;
    }
    if (c === '|') {
      empurrar('|');
      continue;
    }
    atual += c;
  }
  empurrar(null);
  return segmentos.filter((s) => s.texto);
}

export function tokens(segmento) {
  // Partes com e sem aspas coladas formam um só argumento ('cu'rl é curl).
  const brutos = segmento.match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) ?? [];
  const saida = [];
  for (const b of brutos) {
    // Redirecionamentos colados (cat<.env, echo x>arq) viram tokens separados.
    for (const parte of b.split(/(?<=[^<>])(?=[<>])|(?<=[<>])(?=[^<>])/)) if (parte) saida.push(parte);
  }
  return saida;
}

function subexpressoes(comando) {
  const saida = [];
  for (let i = comando.indexOf('$('); i !== -1 && saida.length <= MAX_SUBEXPRESSOES; i = comando.indexOf('$(', i + 2)) {
    let nivel = 0;
    for (let j = i + 1; j < comando.length; j++) {
      if (comando[j] === '(') nivel++;
      else if (comando[j] === ')' && --nivel === 0) {
        saida.push(comando.slice(i + 2, j));
        break;
      }
    }
  }
  return saida;
}

function caminhoPerigosoParaApagar(alvo, raiz) {
  const a = normalizarToken(alvo);
  if (!a) return true;
  if (/^(?:\/|~|\*|\.|\.\.|[A-Za-z]:\\?|\$home|\$env:userprofile|%userprofile%|\$\{?home\}?)$/i.test(a)) return true;
  if (a.includes('..') || /[*?[]/.test(a) || /^(?:\$|%)/.test(a)) return true;
  if (PROTEGIDOS.test(` ${a}`)) return true;
  const abs = isAbsolute(a) ? a : resolve(raiz, a);
  if (!estaDentro(raiz, abs)) return true;
  return resolve(abs) === resolve(raiz);
}

/** O caminho (literal ou com curingas) pode designar um arquivo de segredo? */
function caminhoSensivel(token) {
  const c = normalizarToken(token).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!c || c.startsWith('-')) return false;
  if (ehArquivoSensivel(c, casaAlgum)) return true;
  if (/[*?[]/.test(c)) {
    const base = c.split('/').pop();
    const re = globParaRegex(base).regex;
    return NOMES_SENSIVEIS.some((n) => re.test(n));
  }
  return false;
}

const bloqueio = (motivo, alternativa) => ({ motivo, alternativa });

/** Avalia o comando. Retorna null se permitido, ou { motivo, alternativa } se bloqueado. */
export function avaliarComando(comando, raiz, profundidade = 0) {
  if (typeof comando !== 'string' || !comando.trim()) return null;
  if (comando.length > LIMITE_COMANDO) return bloqueio('comando longo demais para verificação', 'Divida o comando ou use um script versionado.');
  const inteiro = comando.toLowerCase();

  const globais = [
    [/\b(?:iex|invoke-expression)\b/, 'execução de texto como código (Invoke-Expression)'],
    [/downloadstring|downloadfile|downloaddata|uploadstring|uploadfile|net\.webclient|system\.net\.|net\.sockets|\[net\.|\[system\.net|httpclient|xmlhttp|msxml2|winhttp/, 'acesso de rede a partir do shell'],
    [/\[(?:system\.)?(?:io\.(?:file|directory|path|stream)|environment|diagnostics\.process|reflection\.|runtime\.interopservices|convert\]::frombase64)/, 'chamada direta de API .NET de arquivo, processo ou ambiente'],
    [/frombase64string|-e(?:nc|ncodedcommand)?\s+[a-z0-9+/=]{16,}/, 'comando codificado ou ofuscado'],
    [/['"][^'"\n]{0,40}['"]\s*\+\s*['"]/, 'concatenação de literais (ofuscação de nome)'],
    [/\|\s*(?:sh|bash|zsh|iex|pwsh|powershell|cmd)\b/, 'execução de conteúdo canalizado para um shell'],
    [/\|\s*(?:remove-item|ri|rm|del|erase|rd|rmdir|clear-content|set-content|out-file|move-item|mv)\b/, 'alteração em massa de arquivos via pipeline'],
    [/-verb\s+runas/, 'elevação de privilégio'],
    [/\$\{?(?:env:)?[a-z0-9_]*(?:key|token|secret|password|passwd|senha|credential|bp_teste)[a-z0-9_]*\}?|%[a-z0-9_]*(?:key|token|secret|password|senha|credential)[a-z0-9_]*%|\$env:[a-z0-9_]*\s*$/, 'leitura de variável de ambiente sensível'],
    [/[`(]\s*(?:curl|wget|iwr|irm|invoke-restmethod|invoke-webrequest|nc|ncat|netcat|ssh|scp|sftp|ftp|telnet|socat)\b/, 'acesso de rede dentro de subexpressão'],
    [/\bgit\b[^\n|;&]*\s-c\s+[a-z.]*(?:fsmonitor|hookspath|sshcommand|askpass|editor|pager|textconv|external|filter|alias|credential)/, 'configuração Git perigosa inline'],
  ];
  for (const [re, motivo] of globais) {
    if (re.test(inteiro)) return bloqueio(motivo, 'Reescreva sem esse recurso. Se for indispensável, registre como pendência para aprovação humana.');
  }

  if (profundidade < 3) {
    const subs = subexpressoes(comando);
    if (subs.length > MAX_SUBEXPRESSOES) return bloqueio('subexpressões demais para verificação', 'Simplifique o comando.');
    for (const interno of subs) {
      const r = avaliarComando(interno, raiz, profundidade + 1);
      if (r) return r;
    }
  } else if (comando.includes('$(')) {
    return bloqueio('subexpressões aninhadas demais para verificação', 'Simplifique o comando.');
  }

  for (const { texto: seg } of segmentar(comando)) {
    const t = tokens(seg);
    let i = 0;
    // Atribuições: VAR=valor cmd (Bash) e $var = cmd (PowerShell).
    while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i])) i++;
    if (i + 1 < t.length && /^\$[\w:]+$/.test(t[i]) && t[i + 1] === '=') i += 2;
    // Operadores de chamada do PowerShell e cmd: "& programa", ". script".
    while (i < t.length && (t[i] === '&' || t[i] === '.')) i++;
    if (i >= t.length) continue;
    const nomes = nomesDoPrograma(t[i]);
    const prog = nomes[0];
    const args = t.slice(i + 1);
    const argsBaixo = args.map((a) => normalizarToken(a).toLowerCase());
    const sub = argsBaixo[0] ?? '';
    const tem = (conjunto) => nomes.some((n) => conjunto.has(n));

    // Comando do próprio BP: só bloqueia subcomandos de governança, mas os caminhos passam pelas checagens abaixo.
    const ehBp = prog === 'node' && /^\.?[/\\]?\.bp[/\\]bp\.mjs$/i.test(normalizarToken(args[0] ?? ''));
    if (ehBp) {
      let pos = [];
      try {
        pos = analisarArgs(args.slice(1).map(normalizarToken), { booleanos: ['json', 'tudo', 'forcar', 'enter', 'aceitar-dialogo', 'pagina-inteira', 'stat', 'sem-sandbox'] }).posicionais.map((p) => p.toLowerCase());
      } catch {
        return bloqueio('argumentos inválidos para o BP', 'Use a forma documentada em "node .bp/bp.mjs ajuda".');
      }
      if (['init', 'instalar', 'iniciar'].includes(pos[0]) || (pos[0] === 'modelos' && pos[1] === 'aplicar')) {
        return bloqueio('comando de governança do orquestrador', 'Instalação, disparo headless e política de modelos são feitos por uma pessoa.');
      }
    }

    if (tem(ENVOLTORIOS)) {
      if (profundidade >= 3) return bloqueio('envoltórios aninhados demais', 'Simplifique o comando.');
      const resto = args.filter((a, k) => !(k === 0 && /^-?\d+$/.test(a)) && !/^-(?:filepath|argumentlist|wait|nonewwindow|passthru|windowstyle)$/i.test(a)).map(normalizarToken).join(' ');
      if (!resto.trim()) continue;
      const r = avaliarComando(resto.replace(/,/g, ' '), raiz, profundidade + 1);
      if (r) return r;
      if (['start-process', 'saps', 'start', 'start-job', 'invoke-item', 'ii'].includes(prog)) return bloqueio(`processo destacado (${prog})`, 'Rode o comando diretamente; para a aplicação local use "node .bp/bp.mjs app iniciar".');
      continue;
    }

    if (tem(REDE)) return bloqueio(`acesso de rede ou remoto (${prog})`, 'O ambiente não permite tráfego de saída pelo agente. Use os testes locais e o navegador do BP (somente hosts permitidos).');
    if (tem(NUVEM)) return bloqueio(`CLI de nuvem, infraestrutura ou plataforma externa (${prog})`, 'Operações remotas exigem humano. Registre como pendência no relatório.');
    if (tem(SISTEMA)) {
      const inofensivo = (prog === 'net' && !['user', 'localgroup', 'share', 'use', 'group', 'accounts'].includes(sub)) || (prog === 'at' && !/^\d/.test(sub));
      if (!inofensivo) return bloqueio(`alteração de sistema operacional, processos, serviços ou privilégios (${prog})`, 'Fora do escopo do agente de desenvolvimento.');
    }
    if (tem(GERENCIADORES_SO)) return bloqueio(`instalação de software no sistema (${prog})`, 'Não instalar ferramentas. Use apenas o que já existe no ambiente.');
    if (prog === 'chmod' && argsBaixo.some((a) => /^0?7[0-7]7$|a\+w|o\+w/.test(a))) return bloqueio('permissão de escrita ampla (chmod)', 'Use permissões mínimas.');

    if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog)) {
      if (['publish', 'unpublish', 'login', 'adduser', 'token', 'owner', 'deprecate', 'dist-tag', 'access', 'config', 'set'].includes(sub)) return bloqueio(`operação de registro ou configuração de pacotes (${prog} ${sub})`, 'Publicação e configuração exigem humano.');
      if (['add', 'i', 'install', 'in', 'isntall', 'update', 'upgrade', 'up'].includes(sub) && args.slice(1).some((a) => !a.startsWith('-'))) return bloqueio(`adição ou troca de dependência (${prog} ${sub})`, 'Dependência nova passa por avaliação de segurança e licença. Registre a necessidade como pendência.');
      if (['exec', 'x', 'dlx', 'create', 'init'].includes(sub)) return bloqueio(`execução de pacote baixado sob demanda (${prog} ${sub})`, 'Use apenas ferramentas já presentes no projeto (scripts do package.json).');
    }
    if (['npx', 'pnpx', 'bunx', 'uvx', 'pipx'].includes(prog)) return bloqueio(`execução de pacote baixado sob demanda (${prog})`, 'Use os scripts do projeto (npm run ...) com dependências já declaradas.');
    if (['pip', 'pip3', 'uv', 'poetry', 'conda', 'gem', 'cargo'].includes(prog) && ['install', 'add', 'get', 'sync'].includes(sub)) return bloqueio(`instalação de dependência (${prog} ${sub})`, 'Dependência nova exige aprovação humana.');
    if (prog === 'go' && ['install', 'get'].includes(sub)) return bloqueio(`instalação de dependência (go ${sub})`, 'Dependência nova exige aprovação humana.');
    if (tem(INTERPRETADORES) && argsBaixo.includes('-m') && argsBaixo.includes('pip')) return bloqueio('instalação via python -m pip', 'Dependência nova exige aprovação humana.');
    if (prog === 'dotnet' && (['add', 'tool', 'nuget', 'new'].includes(sub) || argsBaixo.includes('push'))) return bloqueio(`alteração de pacotes .NET (dotnet ${sub})`, 'Dependência nova exige aprovação humana.');
    if (['mvn', 'mvnw', 'gradle', 'gradlew'].includes(prog) && argsBaixo.some((a) => /^(deploy|publish|release:|install:install-file|dependency:get)/.test(a))) return bloqueio('publicação ou download avulso de artefato', 'Publicação exige humano.');
    if (prog === 'docker' || prog === 'podman') return bloqueio(`containers (${prog})`, 'Containers não são usados pelo agente.');

    // Código inline em interpretador: sempre bloqueado (não verificável). Shell dentro de shell é reavaliado.
    if (tem(INTERPRETADORES)) {
      const k = argsBaixo.findIndex((a) => ['-e', '--eval', '-p', '--print', '-c', '-command', '/c', '/k', '-encodedcommand', '-enc', '-ec', '-r', '--input-type'].includes(a));
      if (k !== -1) {
        if (SHELLS.has(prog) && !['-encodedcommand', '-enc', '-ec'].includes(argsBaixo[k]) && profundidade < 3) {
          const r = avaliarComando(args.slice(k + 1).map((a) => a.replace(/^["']|["']$/g, '')).join(' '), raiz, profundidade + 1);
          if (r) return r;
        } else {
          return bloqueio(`código inline em ${prog}`, 'Escreva o código em um arquivo do projeto (teste ou script versionado), que fica revisável, e execute-o.');
        }
      }
      if (prog === 'node' && argsBaixo.some((a) => /^--(?:require|import|loader|experimental-loader|inspect)/.test(a) || a === '-r')) return bloqueio('node com pré-carregamento ou inspeção', 'Use a forma padrão de execução do projeto.');
    }

    if (prog === 'git') {
      const resto = argsBaixo.join(' ');
      if (['push', 'remote', 'submodule', 'filter-branch', 'filter-repo', 'rebase', 'credential', 'daemon', 'send-email', 'request-pull', 'archive', 'bundle', 'fetch', 'pull', 'clone', 'ls-remote', 'stash', 'worktree', 'update-ref', 'replace', 'notes', 'gc', 'prune', 'reflog'].includes(sub)) {
        if (!(sub === 'remote' && (args.length === 1 || ['-v', 'show', 'get-url'].includes(argsBaixo[1])))) return bloqueio(`operação Git remota, de reescrita ou de ocultação (git ${sub})`, 'O agente trabalha só localmente na árvore de trabalho; essas operações exigem humano.');
      }
      if (sub === 'config' && !/(?:^|\s)(?:--get(?:-all|-regexp)?|--list|-l|--show-origin|--show-scope)(?:\s|$)/.test(resto)) return bloqueio('alteração de configuração Git', 'Configuração Git pode executar comandos (fsmonitor, hooks, filtros) e exige humano.');
      if (sub === 'reset' && resto.includes('--hard')) return bloqueio('git reset --hard descarta trabalho', 'Restaure arquivos específicos.');
      if (sub === 'clean') return bloqueio('git clean apaga arquivos não versionados', 'Remova arquivos específicos.');
      if ((sub === 'checkout' || sub === 'restore' || sub === 'switch') && !/^(?:-b|-c)$/.test(argsBaixo[1] ?? '')) return bloqueio(`git ${sub} pode descartar alterações ou trocar de branch`, 'Mantenha a branch atual; restaure arquivos específicos só com aprovação.');
      if (sub === 'commit' && /(?:^|\s)(?:--no-verify|-[a-z]*n[a-z]*)(?:\s|$)/.test(resto)) return bloqueio('commit sem hooks de verificação', 'Faça o commit com as verificações.');
    }

    // Apagamento ou movimentação recursiva: só dentro do workspace, fora da governança e nunca a raiz.
    const recursivo = (prog === 'rm' && argsBaixo.some((a) => /^-[a-z]*r/i.test(a) || a === '--recursive'))
      || (['remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir', 'rm'].includes(prog) && argsBaixo.some((a) => /^-r(ecurse)?$|^\/s$/.test(a)));
    if (recursivo) {
      const alvos = args.filter((a) => !/^-{1,2}[a-z]/i.test(a) && !/^\/[a-z]$/i.test(a));
      if (!alvos.length || alvos.some((a) => caminhoPerigosoParaApagar(a, raiz))) return bloqueio('apagamento recursivo fora do workspace, de caminho amplo ou de governança', 'Apague somente pastas geradas dentro do projeto, com caminho relativo explícito (ex.: dist).');
    }

    if ((['env', 'printenv', 'set', 'export', 'declare', 'compgen'].includes(prog) && args.length === 0) || (['get-childitem', 'gci', 'dir', 'ls', 'get-item', 'gi', 'get-variable', 'gv'].includes(prog) && argsBaixo.some((a) => a.startsWith('env:') || a.startsWith('variable:')))) {
      return bloqueio('despejo de variáveis de ambiente', 'Consulte apenas a variável necessária e não sensível.');
    }

    if (args.some(caminhoSensivel)) return bloqueio('acesso a arquivo de credenciais ou segredos', 'O agente não lê segredos. Use arquivos de exemplo (.env.example).');

    const navega = ['cd', 'set-location', 'sl', 'pushd', 'chdir'].includes(prog);
    if (PROTEGIDOS.test(` ${seg}`)) {
      const leitura = SOMENTE_LEITURA.has(prog) && !/>/.test(seg) || (prog === 'git' && ['status', 'diff', 'log', 'show', 'blame', 'ls-files'].includes(sub)) || ehBp;
      if (navega || !leitura) return bloqueio('acesso de escrita ou navegação na governança (.kiro, .bp, .git)', 'Agentes, hooks, políticas, prompts e o estado do BP só mudam pelos comandos do BP ou por revisão humana.');
    }
  }
  return null;
}
