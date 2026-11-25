import './_ambiente.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { casaGlob, criarIgnorador } from '../src/core/glob.mjs';
import { cpfValido, cnpjValido, luhnValido, encontrarSegredos, encontrarPii, redigir, mascarar } from '../src/core/sensiveis.mjs';
import { resolverConfinado, estaDentro } from '../src/core/caminhos.mjs';
import { analisarJson, escreverJson, lerJson } from '../src/core/json.mjs';
import { validar } from '../src/core/esquema.mjs';
import { analisarArgs, inteiro } from '../src/core/args.mjs';
import { carregarConfig } from '../src/core/config.mjs';

test('glob: curingas, diretórios, chaves e âncoras', () => {
  assert.ok(casaGlob('src/a/b.ts', '**/*.ts'));
  assert.ok(casaGlob('b.ts', '**/*.ts'));
  assert.ok(!casaGlob('src/a/b.tsx', '**/*.ts'));
  assert.ok(casaGlob('node_modules/x/y.js', 'node_modules/**'));
  assert.ok(casaGlob('a/node_modules/x.js', '**/node_modules/**'));
  assert.ok(casaGlob('src/x.jsx', 'src/*.{js,jsx}'));
  assert.ok(casaGlob('config/.env', '**/.env'));
  assert.ok(casaGlob('.env.local', '**/.env.*'));
  assert.ok(!casaGlob('src/environment.ts', '**/.env'));
  assert.ok(casaGlob('dist/app.js', 'dist/**'));
  assert.ok(!casaGlob('src/dist/app.js', '/dist/**'));
});

test('ignorador: última regra vence e negação reabilita', () => {
  const ign = criarIgnorador(['# comentário', '*.log', '!importante.log', 'build/']);
  assert.ok(ign('erro.log'));
  assert.ok(!ign('importante.log'));
  assert.ok(ign('build/saida.js'));
  assert.ok(!ign('src/app.js'));
});

test('dígitos verificadores de CPF, CNPJ e cartão', () => {
  assert.ok(cpfValido('000.000.001-91'));
  assert.ok(!cpfValido('000.000.001-92'));
  assert.ok(!cpfValido('111.111.111-11'));
  assert.ok(cnpjValido('11.222.333/0001-81'));
  assert.ok(!cnpjValido('11.222.333/0001-80'));
  assert.ok(luhnValido('4111 1111 1111 1111'));
  assert.ok(!luhnValido('4111 1111 1111 1112'));
});

test('segredos: detecta reais e ignora valores fictícios', () => {
  const texto = [
    'const k = "AKIAABCDEFGHIJKLMNOP";',
    'password = "Sup3rS3cretaReal!"',
    'senha: "${SENHA_DO_COFRE}"',
    'token = "changeme"',
    '-----BEGIN RSA PRIVATE KEY-----',
    'url = "postgres://admin:segredo123@db:5432/x"',
  ].join('\n');
  const achados = encontrarSegredos(texto);
  const regras = achados.map((a) => a.regra);
  assert.ok(regras.includes('aws-access-key'));
  assert.ok(regras.includes('senha-atribuida'));
  assert.ok(regras.includes('chave-privada'));
  assert.ok(regras.includes('url-com-senha'));
  assert.equal(achados.filter((a) => a.regra === 'senha-atribuida').length, 1, 'placeholders não são segredo');
  for (const a of achados) assert.ok(!a.previa.includes('Sup3rS3cretaReal'), 'prévia nunca expõe o valor inteiro');
});

test('PII e redação', () => {
  assert.equal(encontrarPii('cpf 000.000.001-91').length, 1);
  assert.equal(encontrarPii('número 123.456.789-00').length, 0, 'CPF inválido não é PII');
  const r = redigir('Cliente 000.000.001-91 com chave AKIAABCDEFGHIJKLMNOP e password = "abcdefgh123"');
  assert.ok(!r.includes('000.000.001-91'));
  assert.ok(!r.includes('AKIAABCDEFGHIJKLMNOP'));
  assert.ok(!r.includes('abcdefgh123'));
  assert.match(r, /\[PII:cpf\]/);
  assert.equal(mascarar('ab'), '***');
});

test('caminhos: confinamento à raiz', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'bp-core-'));
  try {
    mkdirSync(join(raiz, 'src'));
    assert.ok(estaDentro(raiz, join(raiz, 'src', 'novo', 'arquivo.txt')));
    assert.ok(!estaDentro(raiz, join(raiz, '..', 'fora.txt')));
    assert.throws(() => resolverConfinado(raiz, '../../etc/passwd'), /fora da raiz/);
    assert.throws(() => resolverConfinado(raiz, 'a\0b'), /recusado/);
    assert.equal(resolverConfinado(raiz, 'src/x.js'), join(raiz, 'src', 'x.js'));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('JSON: sem poluição de protótipo, BOM e escrita atômica', () => {
  const o = analisarJson('{"a":1,"__proto__":{"admin":true},"constructor":{"x":1}}');
  assert.equal(o.a, 1);
  assert.equal({}.admin, undefined);
  assert.equal(Object.getPrototypeOf(o), Object.prototype);
  assert.equal(analisarJson('﻿{"b":2}').b, 2);
  assert.throws(() => analisarJson('{x'), /JSON inválido/);
  const raiz = mkdtempSync(join(tmpdir(), 'bp-json-'));
  try {
    escreverJson(join(raiz, 'a', 'b.json'), { ok: true });
    assert.deepEqual(lerJson(join(raiz, 'a', 'b.json')), { ok: true });
    writeFileSync(join(raiz, 'grande.json'), `"${'x'.repeat(2000)}"`);
    assert.throws(() => lerJson(join(raiz, 'grande.json'), { limite: 100 }), /excede/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('esquema: tipos, obrigatórios, enum, padrões e extras', () => {
  const esquema = { type: 'object', required: ['n'], additionalProperties: false, properties: { n: { type: 'integer', minimum: 1 }, s: { type: 'string', pattern: '^[a-z]+$' }, e: { enum: ['a', 'b'] } } };
  assert.deepEqual(validar(esquema, { n: 2, s: 'abc', e: 'a' }), []);
  const erros = validar(esquema, { n: 0, s: 'ABC', e: 'c', extra: 1 });
  assert.equal(erros.length, 4);
  assert.ok(validar(esquema, {}).some((e) => e.includes('obrigatório')));
});

test('args e inteiros', () => {
  const { posicionais, opcoes } = analisarArgs(['rag', 'buscar', 'x y', '--k', '5', '--json', '--caminho=src/**'], { booleanos: ['json'] });
  assert.deepEqual(posicionais, ['rag', 'buscar', 'x y']);
  assert.equal(opcoes.k, '5');
  assert.equal(opcoes.json, true);
  assert.equal(opcoes.caminho, 'src/**');
  assert.equal(inteiro('5', { min: 1, max: 10 }), 5);
  assert.throws(() => inteiro('50', { min: 1, max: 10, nome: '--k' }), /--k/);
  assert.throws(() => analisarArgs(['--X!']), /Opção inválida/);
});

test('config: padrões seguros e rejeição de valores inválidos', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'bp-cfg-'));
  try {
    const c = carregarConfig(raiz);
    assert.equal(c.portoes.bloquearSegredos, true);
    assert.deepEqual(c.navegador.hostsPermitidos, ['localhost', '127.0.0.1', '[::1]']);
    mkdirSync(join(raiz, '.bp'));
    writeFileSync(join(raiz, '.bp', 'config.json'), JSON.stringify({ navegador: { hostsPermitidos: ['evil.com/x?'] } }));
    assert.throws(() => carregarConfig(raiz), /Configuração inválida/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
