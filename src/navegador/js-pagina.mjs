// Funções executadas dentro da página via Runtime.callFunctionOn/evaluate.
// Partes adaptadas do Browser Use (MIT, (c) 2024 Gregor Zunic / (c) 2026 Browser Use):
// cálculo do ponto de clique sem obstrução (ax.py:199-218) e coleta de texto visível.
// Ver THIRD_PARTY_NOTICES.md. Nenhuma função aqui lê cookies, storage ou envia rede.

/** Chamada com `this` = elemento alvo. Retorna {x, y, coberto, cobertoPor} ou lança erro descritivo. */
export const PONTO_CLIQUE = `function pontoClique(campoEditavel) {
  const e = this.nodeType === Node.ELEMENT_NODE ? this : this.parentElement;
  if (!e || !e.isConnected) throw new Error('alvo removido da página');
  if (e.matches(':disabled') || e.closest('[inert]')) throw new Error('alvo desabilitado');
  if (e.matches('input[type=file]')) throw new Error('campo de arquivo: use a ação de upload');
  if (e.checkVisibility && !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) throw new Error('alvo oculto');
  const r = e.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  if (!r.width || !r.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) throw new Error('alvo fora da área visível');
  const atingido = e.getRootNode().elementFromPoint(x, y);
  const campo = (n) => n && (['INPUT', 'TEXTAREA'].includes(n.tagName) || n.isContentEditable);
  const coberto = !e.contains(atingido)
    && !(atingido && atingido.contains(e) && atingido.tagName === 'LABEL' && getComputedStyle(atingido).pointerEvents !== 'none')
    && !(campoEditavel && campo(e) && campo(atingido));
  let px = x, py = y;
  for (let w = e.ownerDocument.defaultView; w && w.frameElement; w = w.parent) {
    const f = w.frameElement, fr = f.getBoundingClientRect(), cs = getComputedStyle(f);
    px += fr.x + f.clientLeft + parseFloat(cs.paddingLeft);
    py += fr.y + f.clientTop + parseFloat(cs.paddingTop);
  }
  let cobertoPor = '';
  if (coberto && atingido) {
    cobertoPor = (atingido.getAttribute('aria-label') || atingido.innerText || atingido.tagName || '').trim().slice(0, 80);
  }
  return { x: px, y: py, coberto, cobertoPor };
}`;

/** Centraliza o elemento na área visível. */
export const CENTRALIZAR = `function centralizar() {
  const e = this.nodeType === Node.ELEMENT_NODE ? this : this.parentElement;
  if (e) e.scrollIntoView({ block: 'center', inline: 'center' });
  return true;
}`;

/** Classifica o tipo de campo para escolher a estratégia de digitação. */
export const TIPO_CAMPO = `function tipoCampo() {
  const e = this;
  if (!(e instanceof Element)) return 'outro';
  if (e.tagName === 'SELECT') return 'select';
  if (e.tagName === 'INPUT') {
    const t = (e.getAttribute('type') || 'text').toLowerCase();
    if (['date', 'time', 'datetime-local', 'month', 'week'].includes(t)) return 'data';
    if (['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color'].includes(t)) return 'nao-texto';
    if (t === 'password') return 'senha';
    return 'texto';
  }
  if (e.tagName === 'TEXTAREA') return 'texto';
  if (e.isContentEditable) return 'editavel';
  return 'outro';
}`;

/** Seleciona opção de <select> por rótulo, valor ou prefixo único (sem diferenciar caixa). */
export const SELECIONAR = `function selecionar(alvo) {
  const e = this;
  if (!(e instanceof HTMLSelectElement)) throw new Error('o elemento não é um <select>');
  const norm = (s) => String(s).trim().toLowerCase();
  const q = norm(alvo);
  const opcoes = [...e.options];
  let escolhida = opcoes.find((o) => norm(o.label) === q || norm(o.value) === q);
  if (!escolhida) {
    const prefixo = opcoes.filter((o) => norm(o.label).startsWith(q));
    if (prefixo.length === 1) escolhida = prefixo[0];
    else if (prefixo.length > 1) throw new Error('mais de uma opção começa com "' + alvo + '"');
  }
  if (!escolhida) throw new Error('opção não encontrada: ' + alvo + ' (opções: ' + opcoes.slice(0, 8).map((o) => o.label).join(' | ') + ')');
  if (escolhida.disabled) throw new Error('opção desabilitada: ' + escolhida.label);
  e.value = escolhida.value;
  e.dispatchEvent(new Event('input', { bubbles: true }));
  e.dispatchEvent(new Event('change', { bubbles: true }));
  return escolhida.label;
}`;

/** Define valor de campos de data/hora pelo setter nativo (formato ISO). */
export const DEFINIR_DATA = `function definirData(valor) {
  const e = this;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(e, valor);
  e.dispatchEvent(new Event('input', { bubbles: true }));
  e.dispatchEvent(new Event('change', { bubbles: true }));
  if (e.value !== valor) throw new Error('valor de data recusado pelo campo (use formato ISO, ex.: 2026-11-25)');
  return e.value;
}`;

/** Lê o valor atual de um campo (para confirmar a digitação). */
export const LER_VALOR = `function lerValor() {
  const e = this;
  if ('value' in e) return String(e.value);
  return String(e.innerText || '');
}`;

/**
 * Sonda de estabilidade: instala um MutationObserver uma vez e informa há quanto tempo
 * não há mutações. Guarda o estado em uma propriedade não enumerável.
 */
export const SONDA = `(() => {
  const chave = Symbol.for('bp.sonda');
  let s = window[chave];
  if (!s) {
    s = { ultima: performance.now(), mutacoes: 0 };
    Object.defineProperty(window, chave, { value: s, enumerable: false });
    try {
      new MutationObserver(() => { s.ultima = performance.now(); s.mutacoes++; })
        .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (e) { s.semObservador = true; /* documento sem suporte: estabilidade passa a depender só da rede */ }
  }
  return { pronto: document.readyState, quietoMs: Math.round(performance.now() - s.ultima), mutacoes: s.mutacoes, url: location.href, titulo: document.title };
})()`;

/** Texto visível da página (inclui shadow roots abertos e iframes de mesma origem), normalizado. */
export const TEXTO_VISIVEL = `(() => {
  const partes = [];
  let total = 0;
  const LIMITE = 400000;
  const visitar = (raiz) => {
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.currentNode; n && total < LIMITE; n = w.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = n.nodeValue.replace(/\\s+/g, ' ').trim();
        const p = n.parentElement;
        if (t && p && (!p.checkVisibility || p.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) { partes.push(t); total += t.length; }
      } else if (n.shadowRoot) {
        visitar(n.shadowRoot);
      } else if (n.tagName === 'IFRAME') {
        try { if (n.contentDocument) visitar(n.contentDocument); } catch (e) { /* iframe de outra origem: inacessível por política do navegador */ }
      }
    }
  };
  visitar(document);
  return partes.join(' ').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
})()`;

/** Métricas de rolagem para indicar se há conteúdo acima/abaixo. */
export const ROLAGEM = `(() => ({ y: Math.round(scrollY), altura: Math.round(document.documentElement.scrollHeight), janela: innerHeight }))()`;
