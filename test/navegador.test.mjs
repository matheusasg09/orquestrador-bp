import './_ambiente.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { avaliarUrl, urlParaRegistro } from '../src/navegador/guarda.mjs';
import { serializarArvores, limitarTexto } from '../src/navegador/serializar.mjs';
import { ConexaoCdp } from '../src/navegador/cdp.mjs';
import { localizarAlvo, resolverVariaveis } from '../src/navegador/roteiro.mjs';
import { FLAGS_PROIBIDAS } from '../src/navegador/navegador.mjs';

const HOSTS = ['localhost', '127.0.0.1', '[::1]', '*.intranet.exemplo', 'app.exemplo:8443'];

test('guarda: hosts permitidos, curingas, portas e esquemas', () => {
  assert.ok(avaliarUrl('http://localhost:3000/a', HOSTS).permitido);
  assert.ok(avaliarUrl('http://[::1]:8080/', HOSTS).permitido);
  assert.ok(avaliarUrl('https://portal.intranet.exemplo/x', HOSTS).permitido);
  assert.ok(!avaliarUrl('https://intranet.exemplo/x', HOSTS).permitido, '*.dominio não casa o próprio domínio');
  assert.ok(avaliarUrl('https://app.exemplo:8443/', HOSTS).permitido);
  assert.ok(!avaliarUrl('https://app.exemplo/', HOSTS).permitido, 'porta diferente');
  assert.ok(!avaliarUrl('https://evil.com/', HOSTS).permitido);
  assert.ok(!avaliarUrl('https://localhost.evil.com/', HOSTS).permitido);
  assert.ok(!avaliarUrl('file:///C:/Windows/win.ini', HOSTS).permitido);
  assert.ok(!avaliarUrl('javascript:alert(1)', HOSTS).permitido);
  assert.ok(!avaliarUrl('chrome://settings', HOSTS).permitido);
  assert.ok(!avaliarUrl('http://user:pass@localhost/', HOSTS).permitido);
  assert.ok(avaliarUrl('about:blank', HOSTS).permitido);
  assert.ok(avaliarUrl('data:text/html,oi', HOSTS).permitido);
  assert.equal(urlParaRegistro('https://x.com/p?token=abc#f'), 'https://x.com/p');
});

test('flags proibidas do navegador cobrem as inseguras auditadas', () => {
  for (const f of ['--no-sandbox', '--disable-web-security', '--ignore-certificate-errors', '--remote-debugging-port', '--load-extension']) assert.ok(FLAGS_PROIBIDAS.includes(f));
});

const n = (nodeId, role, extra = {}) => ({ nodeId: String(nodeId), role: { value: role }, ...extra });

test('serialização da árvore de acessibilidade em linhas indexadas', () => {
  const nodes = [
    n(1, 'RootWebArea', { childIds: ['2', '3', '4', '5', '7', '9'], name: { value: 'Login' } }),
    n(2, 'heading', { name: { value: 'Acesse sua conta' }, childIds: ['20'] }),
    n(20, 'StaticText', { name: { value: 'Acesse sua conta' } }),
    n(3, 'textbox', { backendDOMNodeId: 812, name: { value: 'Usuário' }, value: { value: 'joao' }, properties: [{ name: 'required', value: { value: true } }] }),
    n(4, 'textbox', { backendDOMNodeId: 830, name: { value: 'Senha' }, value: { value: '••••' } }),
    n(5, 'combobox', { backendDOMNodeId: 840, name: { value: 'Plano' }, childIds: ['6'] }),
    n(6, 'MenuListPopup', { childIds: ['61', '62'] }),
    n(61, 'MenuListOption', { name: { value: 'PGBL' } }),
    n(62, 'MenuListOption', { name: { value: 'VGBL' } }),
    n(7, 'paragraph', { childIds: ['71'] }),
    n(71, 'StaticText', { name: { value: 'Esqueceu a senha?' } }),
    n(9, 'button', { backendDOMNodeId: 851, name: { value: 'Entrar' }, properties: [{ name: 'focusable', value: { value: true } }] }),
  ];
  const { linhas, ids } = serializarArvores([{ url: 'http://localhost', nodes }], { visivel: 'acesse sua conta esqueceu a senha?', sensiveis: new Set([830]), anteriores: new Set([812, 830, 840]) });
  assert.deepEqual(linhas, [
    '## Acesse sua conta',
    '[812] textbox "Usuário" = "joao" obrigatorio',
    '[830] textbox "Senha" = <oculto>',
    '[840] select "Plano"  opções: PGBL | VGBL',
    'Esqueceu a senha?',
    '*[851] button "Entrar"',
  ]);
  assert.equal(ids.get(851).papel, 'button');
  const ocultoNaoVisivel = serializarArvores([{ url: '', nodes: [n(1, 'RootWebArea', { childIds: ['2'] }), n(2, 'StaticText', { name: { value: 'Banner invisível' } })] }], { visivel: 'outro texto' });
  assert.deepEqual(ocultoNaoVisivel.linhas, [], 'texto fora do visível é omitido');
});

test('limitarTexto mantém início e fim', () => {
  const linhas = Array.from({ length: 100 }, (_, i) => `linha ${i}`);
  const r = limitarTexto(linhas, 200);
  assert.equal(r[0], 'linha 0');
  assert.equal(r.at(-1), 'linha 99');
  assert.ok(r.some((l) => l.includes('omitida')));
});

test('transporte CDP por pipe: correlação, eventos, erros e fragmentação', async () => {
  const paraNavegador = new PassThrough();
  const doNavegador = new PassThrough();
  const cdp = new ConexaoCdp(paraNavegador, doNavegador, { tempoLimitePadraoMs: 500 });
  const eventos = [];
  cdp.aoEvento((m) => eventos.push(m.method));
  paraNavegador.on('data', (b) => {
    for (const bruto of b.toString().split('\0').filter(Boolean)) {
      const msg = JSON.parse(bruto);
      if (msg.method === 'Falha') doNavegador.write(`${JSON.stringify({ id: msg.id, error: { code: -32000, message: 'nope' } })}\0`);
      else if (msg.method !== 'Silencio') {
        const resp = JSON.stringify({ id: msg.id, result: { eco: msg.params.x, sessao: msg.sessionId ?? null } });
        doNavegador.write(`${JSON.stringify({ method: 'Page.loadEventFired', params: {} })}\0${resp.slice(0, 5)}`);
        setTimeout(() => doNavegador.write(`${resp.slice(5)}\0`), 5);
      }
    }
  });
  assert.deepEqual(await cdp.enviar('Eco', { x: 1 }, { sessao: 'S1' }), { eco: 1, sessao: 'S1' });
  assert.deepEqual(eventos, ['Page.loadEventFired']);
  await assert.rejects(cdp.enviar('Falha'), /nope/);
  await assert.rejects(cdp.enviar('Silencio', {}, { tempoLimiteMs: 50 }), /Tempo esgotado/);
  doNavegador.end();
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(cdp.enviar('Eco', { x: 2 }), /fechada/);
});

test('roteiro: localização por papel e nome, ambiguidade e variáveis', () => {
  const ids = new Map([[1, { papel: 'button', nome: 'Salvar' }], [2, { papel: 'button', nome: 'Salvar rascunho' }], [3, { papel: 'textbox', nome: 'Nome' }]]);
  assert.equal(localizarAlvo(ids, { papel: 'button', nome: 'Salvar' }), 1, 'nome exato desempata');
  assert.equal(localizarAlvo(ids, { papel: 'button', nome: 'salvar', ordem: 2 }), 2);
  assert.throws(() => localizarAlvo(ids, { papel: 'button', nome: 'alv' }), /ambíguo/);
  assert.throws(() => localizarAlvo(ids, { papel: 'link', nome: 'x' }), /não encontrado/);
  process.env.BP_TESTE_SENHA = 'sintetica';
  assert.equal(resolverVariaveis('a ${env:BP_TESTE_SENHA} b'), 'a sintetica b');
  assert.throws(() => resolverVariaveis('${env:PATH}'), /não permitida/);
  delete process.env.BP_TESTE_SENHA;
});
