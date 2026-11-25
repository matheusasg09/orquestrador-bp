// Guarda de destinos do navegador: só hosts permitidos e esquemas seguros.
// Aplicado a TODAS as requisições (documentos, scripts, fetch, imagens, iframes)
// via Fetch.requestPaused, e também antes de cada navegação explícita.

const ESQUEMAS_LIVRES = new Set(['data:', 'blob:', 'about:']);
const ESQUEMAS_REDE = new Set(['http:', 'https:', 'ws:', 'wss:']);

function casaHost(host, porta, padrao) {
  const p = padrao.toLowerCase();
  const [hostPadrao, portaPadrao] = p.startsWith('[') ? [p.slice(0, p.indexOf(']') + 1), p.slice(p.indexOf(']') + 2) || null] : p.split(':');
  if (portaPadrao && portaPadrao !== porta) return false;
  if (hostPadrao.startsWith('*.')) {
    const sufixo = hostPadrao.slice(1);
    return host.endsWith(sufixo) && host.length > sufixo.length;
  }
  return host === hostPadrao;
}

/**
 * Decide se `url` pode ser acessada. Retorna { permitido, motivo }.
 * `hosts`: lista como ["localhost", "127.0.0.1:8080", "*.intranet.exemplo"].
 */
export function avaliarUrl(url, hosts) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { permitido: false, motivo: 'URL inválida' };
  }
  if (u.protocol === 'about:') return { permitido: u.href === 'about:blank' || u.href.startsWith('about:srcdoc'), motivo: 'about: restrito a about:blank' };
  if (ESQUEMAS_LIVRES.has(u.protocol)) return { permitido: true, motivo: 'esquema local' };
  if (!ESQUEMAS_REDE.has(u.protocol)) return { permitido: false, motivo: `esquema bloqueado: ${u.protocol}` };
  if (u.username || u.password) return { permitido: false, motivo: 'URL com credencial embutida' };
  const host = u.hostname.toLowerCase();
  const porta = u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? '443' : '80');
  for (const h of hosts) if (casaHost(host, porta, h)) return { permitido: true, motivo: 'host permitido' };
  return { permitido: false, motivo: `host fora da lista permitida: ${host}` };
}

/** Remove query string e fragmento (podem conter tokens) para registro. */
export function urlParaRegistro(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:') return 'data:[...]';
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return String(url).slice(0, 120);
  }
}
