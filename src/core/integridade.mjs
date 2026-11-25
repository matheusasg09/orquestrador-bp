// Integridade do estado calculado pelo BP: HMAC-SHA256 com chave por repositório guardada
// FORA do workspace (perfil do usuário), onde o agente não lê nem escreve (hook de leitura,
// permissões do Kiro e sandbox com fs bloqueado fora do workspace). Um resultado de teste,
// portão, execução ou âncora de auditoria forjado pelo agente não passa na verificação.

import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const CAMPO = '_assinatura';

export function pastaChaves() {
  if (process.env.BP_DIR_CHAVES) return resolve(process.env.BP_DIR_CHAVES);
  const base = process.env.LOCALAPPDATA || (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'));
  return join(base, 'orquestrador-bp', 'chaves');
}

function idRepositorio(raiz) {
  return createHash('sha256').update(resolve(raiz).toLowerCase()).digest('hex').slice(0, 24);
}

export function arquivoChave(raiz) {
  return join(pastaChaves(), `${idRepositorio(raiz)}.chave`);
}

const cacheChaves = new Map();

/** Obtém (ou cria na primeira vez) a chave do repositório. */
export function chave(raiz) {
  const arq = arquivoChave(raiz);
  if (cacheChaves.has(arq)) return cacheChaves.get(arq);
  if (!existsSync(arq)) {
    mkdirSync(pastaChaves(), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(arq, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch {
      // criada por outro processo ao mesmo tempo
    }
    try {
      chmodSync(arq, 0o600);
    } catch {
      // Windows: herda a ACL do perfil do usuário
    }
  }
  const k = Buffer.from(readFileSync(arq, 'utf8').trim(), 'hex');
  if (k.length !== 32) throw new Error('Chave de integridade corrompida');
  cacheChaves.set(arq, k);
  return k;
}

/** JSON canônico (chaves ordenadas) para que a assinatura não dependa da formatação. */
export function canonicoJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicoJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => k !== CAMPO && v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicoJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export function hmac(raiz, texto) {
  return createHmac('sha256', chave(raiz)).update(texto).digest('hex');
}

export function assinar(raiz, dados, contexto) {
  return { ...dados, [CAMPO]: hmac(raiz, `${contexto}|${canonicoJson(dados)}`) };
}

/** true se a assinatura confere para o contexto informado. */
export function assinaturaValida(raiz, dados, contexto) {
  if (!dados || typeof dados !== 'object' || typeof dados[CAMPO] !== 'string') return false;
  const esperado = Buffer.from(hmac(raiz, `${contexto}|${canonicoJson(dados)}`), 'hex');
  const recebido = Buffer.from(dados[CAMPO], 'hex');
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
