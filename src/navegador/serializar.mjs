// Serialização da árvore de acessibilidade em texto compacto com elementos indexados.
// Algoritmo adaptado do Browser Use 1.0 "ultrafast" / browser-use-pi (MIT,
// (c) 2024 Gregor Zunic / (c) 2026 Browser Use), ax.py:526-618. Ver THIRD_PARTY_NOTICES.md.
// Formato de linha: [id] papel "nome" = "valor" estados   (id = backendDOMNodeId; * = elemento novo)

const CONTROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);
const BLOCOS = new Set(['paragraph', 'listitem', 'row', 'LabelText', 'cell', 'gridcell', 'columnheader', 'rowheader', 'caption']);
const SEM_DESCER = new Set(['DateTime', 'Date', 'InputTime']);

const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const dobrar = (s) => limpar(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cortar = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const prop = (n, k) => n.properties?.find((p) => p.name === k)?.value?.value;

function estados(n) {
  const e = [];
  const marcado = prop(n, 'checked');
  if (marcado === 'true' || marcado === true) e.push('marcado');
  else if (marcado === 'false' || marcado === false) e.push('desmarcado');
  else if (marcado === 'mixed') e.push('misto');
  const expandido = prop(n, 'expanded');
  if (expandido === true) e.push('expandido');
  else if (expandido === false) e.push('recolhido');
  if (prop(n, 'selected') === true) e.push('selecionado');
  if (prop(n, 'disabled') === true) e.push('desabilitado');
  if (prop(n, 'focused') === true) e.push('focado');
  if (prop(n, 'required') === true) e.push('obrigatorio');
  const invalido = prop(n, 'invalid');
  if (invalido && invalido !== 'false') e.push('invalido');
  if (prop(n, 'readonly') === true) e.push('somente-leitura');
  return e.length ? ` ${e.join(' ')}` : '';
}

/**
 * @param {Array<{url:string, nodes:any[]}>} arvores  uma por frame (a primeira é a principal)
 * @param {{visivel?:string, sensiveis?:Set<number>, anteriores?:Set<number>}} opcoes
 * @returns {{linhas:string[], ids:Map<number,{papel:string,nome:string}>}}
 */
export function serializarArvores(arvores, { visivel, sensiveis = new Set(), anteriores } = {}) {
  const linhas = [];
  const ids = new Map();
  arvores.forEach((arvore, indice) => {
    if (!arvore.nodes?.length) return;
    const porId = new Map(arvore.nodes.map((n) => [n.nodeId, n]));
    const locais = [];
    let paragrafo = [];
    const fechar = () => {
      if (paragrafo.length) locais.push(cortar(paragrafo.join(' '), 400));
      paragrafo = [];
    };
    const resumoOpcoes = (n) => {
      const opcoes = [];
      const visitar = (no) => {
        for (const c of no.childIds ?? []) {
          const f = porId.get(c);
          if (!f) continue;
          const papel = String(f.role?.value ?? '');
          if ((papel === 'menuitem' || papel === 'option' || papel === 'MenuListOption') && limpar(f.name?.value)) opcoes.push(limpar(f.name.value));
          else visitar(f);
        }
      };
      visitar(n);
      if (!opcoes.length) return '';
      const mostradas = opcoes.slice(0, 6).map((o) => cortar(o, 40));
      return `  opções: ${mostradas.join(' | ')}${opcoes.length > 6 ? ` | … +${opcoes.length - 6}` : ''}`;
    };
    const percorrer = (n, dentro, profundidade) => {
      if (!n || profundidade > 400) return;
      const papel = String(n.role?.value ?? '');
      const nome = limpar(n.name?.value);
      const filhos = n.childIds ?? [];
      const descer = (texto) => filhos.forEach((c) => percorrer(porId.get(c), texto, profundidade + 1));
      if (n.ignored) return descer(dentro);
      if (papel === 'StaticText' || papel === 'InlineTextBox') {
        const t = dobrar(nome);
        if (t && !dentro.includes(t) && (visivel == null || visivel.includes(t))) paragrafo.push(nome);
        return undefined;
      }
      if (papel === 'heading' && nome) {
        fechar();
        locais.push(`## ${cortar(nome, 150)}`);
        return descer(dobrar(nome));
      }
      const id = n.backendDOMNodeId;
      const focavel = prop(n, 'focusable') && papel !== 'RootWebArea' && (nome || n.value?.value || prop(n, 'editable'));
      if (!id || !(CONTROLES.has(papel) || focavel)) {
        if (!BLOCOS.has(papel)) return descer(dentro);
        fechar();
        descer(dentro);
        return fechar();
      }
      fechar();
      if (locais.at(-1)?.toLowerCase() === nome.toLowerCase()) locais.pop(); // rótulo repetido do <label>
      const temPopup = filhos.some((c) => String(porId.get(c)?.role?.value) === 'MenuListPopup');
      let papelExibido = papel;
      if (temPopup) papelExibido = 'select';
      else if (prop(n, 'editable') && !CONTROLES.has(papel)) papelExibido = 'textbox';
      const secreto = sensiveis.has(id);
      const valorBruto = limpar(n.value?.value);
      const valor = secreto ? (valorBruto ? '<oculto>' : '') : valorBruto;
      const novo = anteriores && !anteriores.has(id) ? '*' : '';
      let linha = `${novo}[${id}] ${papelExibido}`;
      if (nome) linha += ` "${cortar(nome, 150)}"`;
      if (valor) linha += ` = ${secreto ? valor : JSON.stringify(cortar(valor, 100))}`;
      linha += estados(n);
      if (temPopup) linha += resumoOpcoes(n);
      locais.push(linha);
      ids.set(id, { papel: papelExibido, nome: cortar(nome, 80) });
      if (temPopup || SEM_DESCER.has(papel)) return undefined;
      descer(dobrar(`${dentro} ${nome} ${valor}`));
      return fechar();
    };
    percorrer(arvore.nodes[0], '', 0);
    fechar();
    if (!locais.length) return;
    if (indice > 0) linhas.push(`--- frame ${arvore.url} ---`);
    linhas.push(...locais);
  });
  return { linhas, ids };
}

/** Limita o texto mantendo 80% do início e 20% do fim (botões de confirmação costumam estar no fim). */
export function limitarTexto(linhas, maxCaracteres) {
  const total = linhas.reduce((s, l) => s + l.length + 1, 0);
  if (total <= maxCaracteres) return linhas;
  const inicio = [];
  let usado = 0;
  const orcInicio = Math.floor(maxCaracteres * 0.8);
  for (const l of linhas) {
    if (usado + l.length + 1 > orcInicio) break;
    inicio.push(l);
    usado += l.length + 1;
  }
  const fim = [];
  usado = 0;
  const orcFim = maxCaracteres - orcInicio;
  for (let i = linhas.length - 1; i >= inicio.length; i--) {
    if (usado + linhas[i].length + 1 > orcFim) break;
    fim.unshift(linhas[i]);
    usado += linhas[i].length + 1;
  }
  const cortadas = linhas.length - inicio.length - fim.length;
  return [...inicio, `... ${cortadas} linha(s) omitida(s); role a página ou use "estado --max" maior ...`, ...fim];
}
