// Validador mínimo de JSON Schema (subconjunto: type, required, properties,
// additionalProperties, items, enum, pattern, minimum, maximum, minLength,
// maxLength, minItems, maxItems). Suficiente para validar as configurações.

function tipoDe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function confereTipo(esperado, valor) {
  const real = tipoDe(valor);
  const lista = Array.isArray(esperado) ? esperado : [esperado];
  return lista.some((t) => t === real || (t === 'number' && real === 'integer'));
}

export function validar(esquema, valor, caminho = '$') {
  const erros = [];
  const visitar = (s, v, p) => {
    if (s.type && !confereTipo(s.type, v)) {
      erros.push(`${p}: esperado ${[].concat(s.type).join('|')}, recebido ${tipoDe(v)}`);
      return;
    }
    if (s.enum && !s.enum.some((e) => e === v)) erros.push(`${p}: valor fora do permitido (${s.enum.join(', ')})`);
    if (typeof v === 'string') {
      if (s.minLength !== undefined && v.length < s.minLength) erros.push(`${p}: mínimo de ${s.minLength} caracteres`);
      if (s.maxLength !== undefined && v.length > s.maxLength) erros.push(`${p}: máximo de ${s.maxLength} caracteres`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) erros.push(`${p}: não casa com ${s.pattern}`);
    }
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) erros.push(`${p}: mínimo ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) erros.push(`${p}: máximo ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) erros.push(`${p}: mínimo de ${s.minItems} itens`);
      if (s.maxItems !== undefined && v.length > s.maxItems) erros.push(`${p}: máximo de ${s.maxItems} itens`);
      if (s.items) v.forEach((item, i) => visitar(s.items, item, `${p}[${i}]`));
    }
    if (tipoDe(v) === 'object') {
      for (const r of s.required ?? []) if (!(r in v)) erros.push(`${p}: campo obrigatório ausente "${r}"`);
      const props = s.properties ?? {};
      for (const [k, sub] of Object.entries(props)) if (k in v) visitar(sub, v[k], `${p}.${k}`);
      if (s.additionalProperties === false) {
        for (const k of Object.keys(v)) if (!(k in props)) erros.push(`${p}: campo não permitido "${k}"`);
      } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        for (const [k, sub] of Object.entries(v)) if (!(k in props)) visitar(s.additionalProperties, sub, `${p}.${k}`);
      }
    }
  };
  visitar(esquema, valor, caminho);
  return erros;
}
