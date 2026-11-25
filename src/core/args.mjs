// Analisador de argumentos mínimo: --chave valor, --chave=valor, --flag, posicionais.

import { erroUso } from './erros.mjs';

export function analisarArgs(argv, { booleanos = [], multiplos = [] } = {}) {
  const posicionais = [];
  const opcoes = {};
  const bools = new Set(booleanos);
  const multi = new Set(multiplos);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      posicionais.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const igual = a.indexOf('=');
      const chave = (igual === -1 ? a.slice(2) : a.slice(2, igual)).trim();
      if (!/^[a-z][a-z0-9-]*$/.test(chave)) throw erroUso(`Opção inválida: ${a}`);
      let valor;
      if (igual !== -1) valor = a.slice(igual + 1);
      else if (bools.has(chave)) valor = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) valor = argv[++i];
      else valor = true;
      if (multi.has(chave)) (opcoes[chave] ??= []).push(valor);
      else opcoes[chave] = valor;
    } else {
      posicionais.push(a);
    }
  }
  return { posicionais, opcoes };
}

export function inteiro(argumento, { padrao, min = -Infinity, max = Infinity, nome = 'argumento' } = {}) {
  if (argumento === undefined || argumento === true) return padrao;
  if (!/^-?\d{1,15}$/.test(String(argumento))) throw erroUso(`${nome} deve ser inteiro entre ${min} e ${max}`);
  const n = Number.parseInt(String(argumento), 10);
  if (!Number.isInteger(n) || n < min || n > max) throw erroUso(`${nome} deve ser inteiro entre ${min} e ${max}`);
  return n;
}
