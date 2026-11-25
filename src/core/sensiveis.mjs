// Detecção e mascaramento de segredos e dados pessoais (LGPD).
// Usado pelos portões, pelos hooks, pelo RAG (nunca indexar segredos) e pelo
// registro de auditoria (nunca gravar segredos ou PII em claro).

/** Regras de segredos. `id` estável para relatórios; `regex` com flag g. */
export const REGRAS_SEGREDO = Object.freeze([
  { id: 'chave-privada', descricao: 'Chave privada PEM', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'aws-access-key', descricao: 'AWS Access Key ID', regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { id: 'aws-secret', descricao: 'AWS Secret Access Key', regex: /aws_?secret_?access_?key["'\s]*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/gi },
  { id: 'github-token', descricao: 'Token do GitHub', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{60,255}\b/g },
  { id: 'gitlab-token', descricao: 'Token do GitLab', regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', descricao: 'Token do Slack', regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'google-api-key', descricao: 'Chave de API Google', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'azure-storage', descricao: 'Connection string do Azure Storage', regex: /DefaultEndpointsProtocol=https?;AccountName=[^;\s]+;AccountKey=[A-Za-z0-9+/=]{40,}/g },
  { id: 'jwt', descricao: 'JSON Web Token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: 'kiro-api-key', descricao: 'Chave de API do Kiro em atribuição', regex: /KIRO_API_KEY\s*[:=]\s*["']?[A-Za-z0-9_\-.]{16,}/g },
  // Esquema com tamanho limitado e sem "+" no fim: evita retrocesso quadrático (ReDoS) em textos longos.
  { id: 'url-com-senha', descricao: 'URL com credencial embutida', regex: /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s:@/"']{1,64}:[^\s@/"']{3,128}@/gi, exige: '://' },
  {
    id: 'senha-atribuida',
    descricao: 'Senha ou segredo atribuído em código ou configuração',
    regex: /\b(?:password|passwd|pwd|senha|secret|segredo|client_secret|api_?key|apikey|access_?token|auth_?token|private_?key)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    grupoValor: 1,
  },
  {
    // Formatos .properties, YAML, .env e .ini, sem aspas: password=..., senha: ...
    id: 'senha-atribuida-sem-aspas',
    descricao: 'Senha ou segredo em arquivo de configuração',
    // A chave precisa TERMINAR na palavra sensível (token.url=... não é segredo); "#" só é comentário após espaço.
    regex: /^[ \t]*(?:export[ \t]+)?[\w.-]*?(?:password|passwd|pwd|senha|secret|segredo|apikey|api[_-]?key|token|private[_-]?key|credentials?)[ \t]*[:=][ \t]*([^\s'"{}[\]]{8,})(?:[ \t]+#.*)?[ \t]*$/gim,
    grupoValor: 1,
  },
]);

const VALORES_FICTICIOS = /^(?:\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|ENC\([^)]*\)|\[SEGREDO:[a-z-]+\]|\{\{[^}]+\}\}|<[^>]+>|%[A-Z_]+%|changeme|change-me|example|exemplo|dummy|placeholder|xxx+|\*+|redacted|mascarado|test(?:e)?|senha123|password123?)$/i;

function digitos(texto) {
  return texto.replace(/\D/g, '');
}

export function cpfValido(texto) {
  const d = digitos(texto);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function cnpjValido(texto) {
  const d = digitos(texto);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function luhnValido(texto) {
  const d = digitos(texto);
  if (d.length < 13 || d.length > 19 || /^(\d)\1+$/.test(d)) return false;
  let soma = 0;
  let dobrar = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (dobrar) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

/** Regras de dados pessoais; `validar` reduz falsos positivos com dígito verificador. */
export const REGRAS_PII = Object.freeze([
  { id: 'cpf', descricao: 'CPF válido', regex: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, validar: cpfValido },
  { id: 'cnpj', descricao: 'CNPJ válido', regex: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, validar: cnpjValido },
  { id: 'cartao', descricao: 'Número de cartão (Luhn válido)', regex: /\b(?:\d[ -]?){12,18}\d\b/g, validar: luhnValido },
]);

function numeroLinha(texto, indice) {
  let linha = 1;
  for (let i = 0; i < indice && i < texto.length; i++) if (texto.charCodeAt(i) === 10) linha++;
  return linha;
}

/** Lista ocorrências de segredos. Nunca devolve o valor completo, só uma prévia mascarada. */
export function encontrarSegredos(texto) {
  const achados = [];
  if (typeof texto !== 'string' || texto.length === 0) return achados;
  for (const regra of REGRAS_SEGREDO) {
    if (regra.exige && !texto.includes(regra.exige)) continue;
    regra.regex.lastIndex = 0;
    for (const m of texto.matchAll(regra.regex)) {
      const valor = regra.grupoValor ? m[regra.grupoValor] : m[0];
      if (regra.grupoValor && VALORES_FICTICIOS.test(valor)) continue;
      achados.push({ regra: regra.id, descricao: regra.descricao, linha: numeroLinha(texto, m.index), previa: mascarar(valor) });
    }
  }
  return achados;
}

export function encontrarPii(texto) {
  const achados = [];
  if (typeof texto !== 'string' || texto.length === 0) return achados;
  for (const regra of REGRAS_PII) {
    regra.regex.lastIndex = 0;
    for (const m of texto.matchAll(regra.regex)) {
      if (regra.validar && !regra.validar(m[0])) continue;
      achados.push({ regra: regra.id, descricao: regra.descricao, linha: numeroLinha(texto, m.index), previa: mascarar(m[0]) });
    }
  }
  return achados;
}

export function mascarar(valor) {
  const s = String(valor);
  if (s.length <= 6) return '***';
  return `${s.slice(0, 2)}***${s.slice(-2)} (${s.length} caracteres)`;
}

/** Substitui segredos e PII por marcadores. Usado antes de qualquer gravação em log ou índice. */
export function redigir(texto) {
  if (typeof texto !== 'string' || texto.length === 0) return texto;
  let saida = texto;
  for (const regra of REGRAS_SEGREDO) {
    if (regra.exige && !saida.includes(regra.exige)) continue;
    regra.regex.lastIndex = 0;
    saida = saida.replace(regra.regex, (trecho, ...grupos) => {
      if (regra.grupoValor) {
        const valor = grupos[regra.grupoValor - 1];
        if (typeof valor === 'string' && !VALORES_FICTICIOS.test(valor)) return trecho.replace(valor, `[SEGREDO:${regra.id}]`);
        return trecho;
      }
      return `[SEGREDO:${regra.id}]`;
    });
  }
  for (const regra of REGRAS_PII) {
    regra.regex.lastIndex = 0;
    saida = saida.replace(regra.regex, (trecho) => (regra.validar && !regra.validar(trecho) ? trecho : `[PII:${regra.id}]`));
  }
  return saida;
}

/** Arquivos que nunca devem ser lidos para índice nem exibidos. */
export const PADROES_ARQUIVO_SENSIVEL = Object.freeze([
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/*.jks',
  '**/*.keystore',
  '**/id_rsa*',
  '**/id_ed25519*',
  '**/*.kdbx',
  '**/credentials',
  '**/credentials.json',
  '**/secrets.*',
  '**/.npmrc',
  '**/.pypirc',
  '**/.netrc',
  '**/settings.xml',
]);

/** Modelos sem valores reais, que devem continuar legíveis e versionáveis. */
export const EXCECOES_ARQUIVO_SENSIVEL = Object.freeze(['**/.env.example', '**/.env.sample', '**/.env.template', '**/.env.dist']);

/** Critério único de arquivo sensível usado por RAG, portões, hooks e navegador. */
export function ehArquivoSensivel(caminhoPosix, casaAlgumFn) {
  return casaAlgumFn(caminhoPosix, PADROES_ARQUIVO_SENSIVEL) && !casaAlgumFn(caminhoPosix, EXCECOES_ARQUIVO_SENSIVEL);
}
