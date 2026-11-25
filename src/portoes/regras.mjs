// bp-ignorar-arquivo: catálogo de regras, contém de propósito os padrões inseguros que detecta.
// Regras determinísticas de código inseguro ou inadequado para instituição financeira.
// Cada regra: id estável, severidade, linguagens (extensões), regex, mensagem, CWE e correção.
// Severidades: bloqueante (reprova o portão), alta, media, baixa.
// Aplicadas às linhas adicionadas (diff) ou ao arquivo inteiro (modo --tudo).

const JS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte'];
const JAVA = ['.java', '.kt', '.kts', '.scala', '.groovy'];
const CS = ['.cs', '.vb'];
const PY = ['.py'];
const SQL = ['.sql'];
const CODIGO = [...JS, ...JAVA, ...CS, ...PY, '.go', '.rb', '.php', '.rs', '.swift', '.c', '.cpp', '.h'];
const TODOS = [...CODIGO, ...SQL, '.html', '.htm', '.yaml', '.yml', '.json', '.xml', '.properties', '.sh', '.ps1'];

const DINHEIRO = '(?:valor|saldo|preco|preço|price|amount|montante|juros|interest|taxa|rate|premio|prêmio|beneficio|benefício|aporte|contribuic|resgate|rendimento|rentabilidade|tarifa|fee|total|desconto|imposto|tax)';
const SENSIVEL_LOG = '(?:cpf|cnpj|senha|password|passwd|token|secret|segredo|cartao|cartão|card_?number|cvv|pan\\b|rg\\b|conta_?corrente|agencia)';
const SEGURANCA = '(?:token|senha|password|secret|segredo|nonce|otp|salt|iv\\b|chave|key|session|sessao|csrf)';

export const REGRAS = Object.freeze([
  // ---------- Injeção ----------
  { id: 'js-eval', severidade: 'bloqueante', linguagens: JS, regex: /(?<![.\w])eval\s*\(/, cwe: 'CWE-95', mensagem: 'eval() executa código arbitrário.', correcao: 'Remova eval; use JSON.parse ou um mapa de funções permitidas.' },
  { id: 'js-new-function', severidade: 'alta', linguagens: JS, regex: /\bnew\s+Function\s*\(/, cwe: 'CWE-95', mensagem: 'new Function() equivale a eval.', correcao: 'Use funções declaradas explicitamente.' },
  { id: 'js-exec-interpolado', severidade: 'bloqueante', linguagens: JS, regex: /\bexec(?:Sync)?\s*\(\s*(?:`[^`]*\$\{|[^)]*\+\s*\w)/, cwe: 'CWE-78', mensagem: 'Comando de shell montado com entrada dinâmica.', correcao: 'Use execFile/spawn com array de argumentos e shell:false.' },
  { id: 'js-shell-true', severidade: 'alta', linguagens: JS, regex: /\bshell\s*:\s*true\b/, cwe: 'CWE-78', mensagem: 'Processo filho com shell habilitado.', correcao: 'Use shell:false e argumentos em array.' },
  { id: 'sql-concatenado', severidade: 'bloqueante', linguagens: [...JS, ...JAVA, ...CS, ...PY, '.go', '.php', '.rb'], regex: /["'`]\s*(?:SELECT|INSERT|UPDATE|DELETE|MERGE)\b[^"'`]*["'`]\s*\+\s*[\w(]|(?:SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*(?:\$\{[^}]+\}|\{[A-Za-z_][\w.]*\}|%s|"\s*\+)|\bf["'](?:SELECT|INSERT|UPDATE|DELETE)\b/i, cwe: 'CWE-89', mensagem: 'SQL montado por concatenação ou interpolação.', correcao: 'Use consultas parametrizadas (PreparedStatement, parâmetros nomeados, ORM).' },
  { id: 'java-runtime-exec', severidade: 'alta', linguagens: JAVA, regex: /Runtime\.getRuntime\(\)\.exec\s*\(|new\s+ProcessBuilder\s*\(\s*"(?:sh|bash|cmd(?:\.exe)?)"/, cwe: 'CWE-78', mensagem: 'Execução de processo do sistema.', correcao: 'Evite; se indispensável, use ProcessBuilder com argumentos fixos e validados.' },
  { id: 'cs-process-start', severidade: 'media', linguagens: CS, regex: /\bProcess\.Start\s*\(/, cwe: 'CWE-78', mensagem: 'Execução de processo do sistema.', correcao: 'Use argumentos fixos via ProcessStartInfo.ArgumentList e UseShellExecute=false.' },
  { id: 'py-eval', severidade: 'bloqueante', linguagens: PY, regex: /(?<![.\w])(?:eval|exec)\s*\(/, cwe: 'CWE-95', mensagem: 'eval/exec executa código arbitrário.', correcao: 'Use ast.literal_eval ou um despacho explícito.' },
  { id: 'py-shell-true', severidade: 'alta', linguagens: PY, regex: /\bshell\s*=\s*True\b|os\.system\s*\(/, cwe: 'CWE-78', mensagem: 'Comando executado via shell.', correcao: 'Use subprocess.run([...], shell=False).' },

  // ---------- XSS e front-end ----------
  { id: 'js-innerhtml', severidade: 'alta', linguagens: JS, regex: /\.(?:inner|outer)HTML\s*\+?=(?!=)|insertAdjacentHTML\s*\(/, cwe: 'CWE-79', mensagem: 'Inserção de HTML sem sanitização.', correcao: 'Use textContent ou criação de nós; se HTML for indispensável, sanitize com política explícita.' },
  { id: 'js-dangerously', severidade: 'alta', linguagens: JS, regex: /dangerouslySetInnerHTML|v-html\s*=|\[innerHTML\]\s*=|bypassSecurityTrust\w*\s*\(/, cwe: 'CWE-79', mensagem: 'Desliga a proteção contra XSS do framework.', correcao: 'Renderize texto; sanitize no servidor quando HTML for requisito.' },
  { id: 'js-document-write', severidade: 'media', linguagens: JS, regex: /document\.write(?:ln)?\s*\(/, cwe: 'CWE-79', mensagem: 'document.write permite injeção.', correcao: 'Manipule o DOM com APIs seguras.' },
  { id: 'js-token-localstorage', severidade: 'alta', linguagens: JS, regex: new RegExp(`(?:local|session)Storage\\.setItem\\s*\\(\\s*["'\`][^"'\`]*${SEGURANCA}`, 'i'), cwe: 'CWE-922', mensagem: 'Credencial ou token gravado em Web Storage (acessível por XSS).', correcao: 'Use cookie HttpOnly, Secure, SameSite=Strict gerido pelo servidor.' },
  { id: 'js-postmessage-curinga', severidade: 'alta', linguagens: JS, regex: /postMessage\s*\([^)]*,\s*["']\*["']\s*\)/, cwe: 'CWE-345', mensagem: 'postMessage com origem curinga.', correcao: 'Informe a origem exata e valide event.origin no receptor.' },

  // ---------- TLS, criptografia e aleatoriedade ----------
  { id: 'tls-desligado', severidade: 'bloqueante', linguagens: TODOS, regex: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|ServerCertificateValidationCallback\s*[+]?=.*=>\s*true|ALLOW_ALL_HOSTNAME_VERIFIER|NoopHostnameVerifier|setHostnameVerifier\s*\(\s*\([^)]*\)\s*->\s*true|TrustAllCerts|trustAllCerts|curl\s+[^\n]*(?:-k\b|--insecure)/, cwe: 'CWE-295', mensagem: 'Validação de certificado TLS desligada.', correcao: 'Mantenha a validação; configure a cadeia de confiança corporativa.' },
  { id: 'cripto-hash-fraco', severidade: 'alta', linguagens: CODIGO, regex: /createHash\s*\(\s*["'](?:md5|sha1|md4)["']|MessageDigest\.getInstance\s*\(\s*"(?:MD5|SHA-?1|MD2)"|\b(?:MD5|SHA1)\.Create\s*\(|hashlib\.(?:md5|sha1)\s*\(|DigestUtils\.(?:md5|sha1)/i, cwe: 'CWE-327', mensagem: 'Hash criptográfico fraco (MD5/SHA-1).', correcao: 'Use SHA-256 ou superior; para senhas, Argon2id, scrypt ou PBKDF2 com sal.' },
  { id: 'cripto-cifra-fraca', severidade: 'bloqueante', linguagens: CODIGO, regex: /createCipher\s*\(|Cipher\.getInstance\s*\(\s*"(?:AES|DES|DESede|RC4|Blowfish)(?:"|\/ECB)|["']aes-\d+-ecb["']|\bDESCryptoServiceProvider\b|\bRC2CryptoServiceProvider\b|CipherMode\.ECB|\bAES\.MODE_ECB\b|\bDES\.new\b/i, cwe: 'CWE-327', mensagem: 'Cifra ou modo inseguro (ECB, DES, RC4, sem IV).', correcao: 'Use AES-256-GCM com IV aleatório de 12 bytes e chave do cofre corporativo.' },
  { id: 'aleatorio-inseguro', severidade: 'bloqueante', linguagens: CODIGO, regex: new RegExp(`(?:Math\\.random\\s*\\(|new\\s+Random\\s*\\(|\\brandom\\.(?:random|randint|choice|choices)\\s*\\(|\\brand\\s*\\(\\s*\\)).*${SEGURANCA}|${SEGURANCA}\\w*\\s*[:=].*(?:Math\\.random\\s*\\(|new\\s+Random\\s*\\(|\\brandom\\.(?:random|randint|choice)\\s*\\()`, 'i'), cwe: 'CWE-338', mensagem: 'Gerador aleatório não criptográfico em contexto de segurança.', correcao: 'Use crypto.randomBytes/randomUUID, SecureRandom, RandomNumberGenerator ou secrets.' },
  { id: 'jwt-inseguro', severidade: 'bloqueante', linguagens: CODIGO, regex: /algorithms?\s*[:=]\s*\[?\s*["']none["']|ignoreExpiration\s*:\s*true|verify_signature["']?\s*:\s*False|ValidateLifetime\s*=\s*false|ValidateIssuerSigningKey\s*=\s*false|RequireSignedTokens\s*=\s*false/i, cwe: 'CWE-347', mensagem: 'Validação de JWT enfraquecida.', correcao: 'Exija assinatura, algoritmo fixo, expiração, emissor e audiência.' },

  // ---------- Desserialização ----------
  { id: 'desserializacao-insegura', severidade: 'bloqueante', linguagens: CODIGO, regex: /\bBinaryFormatter\b|\bNetDataContractSerializer\b|\bLosFormatter\b|TypeNameHandling\s*=\s*TypeNameHandling\.(?:All|Auto|Objects)|\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*SafeLoader)|\bnew\s+ObjectInputStream\s*\(|enableDefaultTyping\s*\(|\bXMLDecoder\b|\bunserialize\s*\(/, cwe: 'CWE-502', mensagem: 'Desserialização de dados não confiáveis pode executar código.', correcao: 'Use formatos de dados (JSON) com tipos explícitos e listas de classes permitidas.' },

  // ---------- Configuração web ----------
  { id: 'cors-curinga', severidade: 'alta', linguagens: TODOS, regex: /Access-Control-Allow-Origin["']?\s*[,:]\s*["']\*["']|origins?\s*[:=]\s*["']\*["']|@CrossOrigin\s*\(\s*(?:origins\s*=\s*)?"\*"|AllowAnyOrigin\s*\(\s*\)/, cwe: 'CWE-942', mensagem: 'CORS aberto para qualquer origem.', correcao: 'Liste explicitamente as origens permitidas.' },
  { id: 'csrf-desligado', severidade: 'alta', linguagens: CODIGO, regex: /csrf\s*\(\s*\)\s*\.disable\s*\(|csrf\s*\(\s*(?:AbstractHttpConfigurer::disable|c\s*->\s*c\.disable\(\))|@csrf_exempt|IgnoreAntiforgeryToken/, cwe: 'CWE-352', mensagem: 'Proteção CSRF desligada.', correcao: 'Mantenha CSRF para sessões baseadas em cookie.' },
  { id: 'http-sem-tls', severidade: 'media', linguagens: TODOS, regex: /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|www\.w3\.org|schemas\.|xmlns|example\.)[^"'`\s]+/i, cwe: 'CWE-319', mensagem: 'URL sem TLS.', correcao: 'Use https://.' },

  // ---------- Logs e dados pessoais (LGPD) ----------
  { id: 'log-dado-sensivel', severidade: 'alta', linguagens: CODIGO, regex: new RegExp(`(?:console\\.(?:log|info|warn|error|debug)|\\blog(?:ger)?\\.(?:info|debug|warn|warning|error|trace|fatal)|\\bLog\\.\\w+|System\\.out\\.print|print\\s*\\(|_logger\\.Log\\w*)\\s*\\([^)]*${SENSIVEL_LOG}`, 'i'), cwe: 'CWE-532', mensagem: 'Possível dado pessoal ou credencial em log (LGPD).', correcao: 'Não registre o dado; se indispensável, mascare (ex.: ***.***.***-12).' },
  { id: 'excecao-exposta', severidade: 'media', linguagens: CODIGO, regex: /\.printStackTrace\s*\(\s*\)|res\.(?:send|json)\s*\(\s*(?:err|error|e)(?:\.stack)?\s*\)|traceback\.print_exc\s*\(/, cwe: 'CWE-209', mensagem: 'Detalhe de exceção exposto ou registrado sem tratamento.', correcao: 'Registre com logger estruturado e retorne mensagem genérica com ID de correlação.' },

  // ---------- Regras financeiras ----------
  { id: 'dinheiro-ponto-flutuante', severidade: 'alta', linguagens: [...JAVA, ...CS, '.go', '.rs', '.swift', '.c', '.cpp'], regex: new RegExp(`\\b(?:double|float|Double|Float|float32|float64|f32|f64)\\s+\\w*${DINHEIRO}\\w*`, 'i'), cwe: 'CWE-681', mensagem: 'Valor monetário em ponto flutuante perde precisão.', correcao: 'Use BigDecimal (Java), decimal (C#) ou inteiro em centavos com escala definida.' },
  { id: 'dinheiro-float-js-py', severidade: 'alta', linguagens: [...JS, ...PY], regex: new RegExp(`(?:parseFloat|Number|float)\\s*\\([^)]*${DINHEIRO}|\\b\\w*${DINHEIRO}\\w*\\s*=\\s*(?:parseFloat|float)\\s*\\(|\\b\\w*${DINHEIRO}\\w*\\.toFixed\\s*\\(`, 'i'), cwe: 'CWE-681', mensagem: 'Cálculo monetário com número de ponto flutuante.', correcao: 'Use inteiros em centavos (BigInt) ou Decimal (Python) com arredondamento explícito.' },
  { id: 'bigdecimal-double', severidade: 'alta', linguagens: JAVA, regex: /new\s+BigDecimal\s*\(\s*-?\d+\.\d+\s*\)|BigDecimal\.valueOf\s*\(\s*\w+\s*\*\s*\w+\s*\)/, cwe: 'CWE-681', mensagem: 'BigDecimal construído a partir de double carrega o erro binário.', correcao: 'Use new BigDecimal("0.1") ou BigDecimal.valueOf de valor exato.' },
  { id: 'divisao-sem-arredondamento', severidade: 'media', linguagens: JAVA, regex: /\.divide\s*\(\s*[^,()]+\s*\)|\.setScale\s*\(\s*\d+\s*\)/, cwe: 'CWE-682', mensagem: 'Divisão ou escala de BigDecimal sem RoundingMode explícito.', correcao: 'Informe escala e RoundingMode (ex.: HALF_EVEN) conforme a regra de negócio.' },
  { id: 'cs-math-round-padrao', severidade: 'baixa', linguagens: CS, regex: new RegExp(`Math\\.Round\\s*\\([^,)]*${DINHEIRO}[^,)]*\\)`, 'i'), cwe: 'CWE-682', mensagem: 'Math.Round sem MidpointRounding explícito em valor monetário.', correcao: 'Informe MidpointRounding conforme a regra (ToEven ou AwayFromZero).' },

  // ---------- SQL e dados ----------
  { id: 'sql-delete-sem-where', severidade: 'alta', linguagens: SQL, regex: /^\s*(?:DELETE\s+FROM\s+[\w."[\]]+|UPDATE\s+[\w."[\]]+\s+SET\s+[^;]*?)\s*;\s*$/i, cwe: 'CWE-1057', mensagem: 'DELETE/UPDATE sem WHERE.', correcao: 'Restrinja com WHERE e valide o volume afetado.' },
  { id: 'sql-privilegio-amplo', severidade: 'alta', linguagens: SQL, regex: /\bGRANT\s+ALL\b|\bTO\s+PUBLIC\b|\bWITH\s+GRANT\s+OPTION\b/i, cwe: 'CWE-250', mensagem: 'Privilégio de banco excessivo.', correcao: 'Conceda o mínimo necessário a papéis específicos.' },
  { id: 'sql-destrutivo', severidade: 'alta', linguagens: SQL, regex: /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA|COLUMN)|TRUNCATE\s+TABLE)\b/i, cwe: 'CWE-1057', mensagem: 'Operação destrutiva de esquema/dados.', correcao: 'Exige migração reversível, backup e aprovação explícita.' },

  // ---------- Qualidade e anti-retrabalho ----------
  { id: 'teste-desabilitado', severidade: 'alta', linguagens: TODOS, regex: /\b(?:it|test|describe|context)\.skip\s*\(|\bx(?:it|describe|test)\s*\(|@Disabled\b|@Ignore\b|\[Ignore\]|\[Fact\s*\(\s*Skip|\[Theory\s*\(\s*Skip|@pytest\.mark\.skip|@unittest\.skip|\bt\.Skip\s*\(/, cwe: null, mensagem: 'Teste desabilitado.', correcao: 'Corrija o teste ou remova-o com justificativa aprovada.' },
  { id: 'teste-exclusivo', severidade: 'alta', linguagens: JS, regex: /\b(?:it|test|describe)\.only\s*\(|\bf(?:it|describe)\s*\(/, cwe: null, mensagem: 'Teste exclusivo (.only) deixa o restante da suíte sem rodar.', correcao: 'Remova o .only.' },
  { id: 'supressao-analise', severidade: 'media', linguagens: TODOS, regex: /eslint-disable(?!-next-line\s+[\w/-]+\s+--)|@SuppressWarnings\s*\(\s*"all"\s*\)|#\s*nosec\b|\/\/\s*NOSONAR|#\s*type:\s*ignore(?!\[)|@ts-ignore|#pragma\s+warning\s+disable(?!\s+\w)/, cwe: null, mensagem: 'Supressão ampla de análise estática.', correcao: 'Suprima só a regra específica, com justificativa no comentário.' },
  { id: 'pendencia', severidade: 'baixa', linguagens: TODOS, regex: /\b(?:TODO|FIXME|XXX|HACK)\b/, cwe: null, mensagem: 'Pendência deixada no código.', correcao: 'Conclua ou registre como tarefa rastreável.' },
  { id: 'catch-vazio', severidade: 'media', linguagens: [...JS, ...JAVA, ...CS], regex: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, cwe: 'CWE-390', mensagem: 'Exceção engolida silenciosamente.', correcao: 'Trate, registre com contexto ou propague.' },
  { id: 'py-except-vazio', severidade: 'media', linguagens: PY, regex: /except(?:\s+\w+)?\s*:\s*pass\b/, cwe: 'CWE-390', mensagem: 'Exceção engolida silenciosamente.', correcao: 'Trate, registre com contexto ou propague.' },
]);

/** Caminhos de governança: mudanças exigem revisão humana (o agente não deve afrouxar os próprios controles). */
export const CAMINHOS_GOVERNANCA = Object.freeze([
  '.kiro/settings/**', '.kiro/hooks/**', '.kiro/agents/**', '.kiro/workflows/**', '.kiroignore',
  '.bp/config.json', '.bp/modelos.json', '.bp/bp.mjs', '.bp/ferramenta/**',
]);

export const SEVERIDADES = Object.freeze(['bloqueante', 'alta', 'media', 'baixa']);

const SUPRESSAO = /bp-ignorar:\s*([a-z0-9-]+)\s+(.{10,})$/i;

/** Aplica as regras a uma linha; retorna achados e supressões justificadas. */
export function avaliarLinha(linha, extensao) {
  const achados = [];
  if (linha.length > 4000) return achados; // linhas minificadas: ignora para evitar ReDoS e ruído
  const sup = linha.match(SUPRESSAO);
  for (const r of REGRAS) {
    if (!r.linguagens.includes(extensao)) continue;
    if (!r.regex.test(linha)) continue;
    if (sup && sup[1] === r.id) {
      achados.push({ regra: r.id, severidade: 'suprimida', mensagem: r.mensagem, justificativa: sup[2].trim() });
      continue;
    }
    achados.push({ regra: r.id, severidade: r.severidade, mensagem: r.mensagem, cwe: r.cwe, correcao: r.correcao });
  }
  return achados;
}
