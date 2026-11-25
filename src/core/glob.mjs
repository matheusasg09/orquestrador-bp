// Conversão de globs (estilo gitignore) para expressões regulares, sem dependências.
// Suporta: *, **, ?, [abc], {a,b}, negação com ! em listas de ignorar e âncoras com /.

const cache = new Map();

function escapar(c) {
  return /[.+^${}()|\\]/.test(c) ? `\\${c}` : c;
}

/** Converte um glob para RegExp aplicada a caminhos POSIX relativos. */
export function globParaRegex(glob) {
  if (cache.has(glob)) return cache.get(glob);
  let padrao = glob.trim();
  let ancorado = false;
  if (padrao.startsWith('/')) {
    ancorado = true;
    padrao = padrao.slice(1);
  } else if (padrao.includes('/') && !padrao.startsWith('**/') && !padrao.endsWith('/')) {
    ancorado = true; // padrão com barra no meio é relativo à raiz (semântica gitignore)
  }
  const soDiretorio = padrao.endsWith('/');
  if (soDiretorio) padrao = padrao.slice(0, -1);

  let re = '';
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i];
    if (c === '*') {
      if (padrao[i + 1] === '*') {
        const antesBarra = i === 0 || padrao[i - 1] === '/';
        const depoisBarra = padrao[i + 2] === '/' || i + 2 === padrao.length;
        if (antesBarra && depoisBarra) {
          i += 1;
          if (padrao[i + 1] === '/') {
            i += 1;
            re += '(?:.*/)?';
          } else {
            re += '.*';
          }
          continue;
        }
        i += 1;
        re += '[^/]*';
        continue;
      }
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const fim = padrao.indexOf(']', i + 1);
      if (fim === -1) {
        re += '\\[';
      } else {
        let classe = padrao.slice(i + 1, fim).replace(/\\/g, '\\\\');
        if (classe.startsWith('!')) classe = `^${classe.slice(1)}`;
        re += `[${classe}]`;
        i = fim;
      }
    } else if (c === '{') {
      const fim = padrao.indexOf('}', i + 1);
      if (fim === -1) {
        re += '\\{';
      } else {
        const opcoes = padrao.slice(i + 1, fim).split(',').map((o) => o.split('').map(escapar).join(''));
        re += `(?:${opcoes.join('|')})`;
        i = fim;
      }
    } else {
      re += escapar(c);
    }
  }
  const prefixo = ancorado ? '^' : '^(?:.*/)?';
  // Um padrão casa o próprio caminho ou qualquer coisa dentro dele (diretório).
  const sufixo = '(?:/.*)?$';
  const resultado = { regex: new RegExp(prefixo + re + sufixo, process.platform === 'win32' ? 'i' : ''), soDiretorio };
  cache.set(glob, resultado);
  return resultado;
}

export function casaGlob(caminhoPosix, glob) {
  return globParaRegex(glob).regex.test(caminhoPosix);
}

export function casaAlgum(caminhoPosix, globs) {
  for (const g of globs) if (casaGlob(caminhoPosix, g)) return true;
  return false;
}

/** Avaliador de arquivo de ignorar (linhas com !negação; a última regra que casa vence). */
export function criarIgnorador(linhas) {
  const regras = [];
  for (const bruta of linhas) {
    const linha = bruta.replace(/\r$/, '');
    if (!linha.trim() || linha.trimStart().startsWith('#')) continue;
    const negar = linha.startsWith('!');
    regras.push({ negar, glob: negar ? linha.slice(1) : linha });
  }
  return (caminhoPosix) => {
    let ignorado = false;
    for (const r of regras) if (casaGlob(caminhoPosix, r.glob)) ignorado = !r.negar;
    return ignorado;
  };
}
