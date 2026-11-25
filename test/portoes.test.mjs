import './_ambiente.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { avaliarLinha } from '../src/portoes/regras.mjs';
import { executarPortoes, resumirPortoes } from '../src/portoes/portoes.mjs';
import { gitDisponivel } from '../src/portoes/git.mjs';
import { carregarConfig } from '../src/core/config.mjs';

const ids = (linha, ext) => avaliarLinha(linha, ext).map((a) => a.regra);

test('regras de injeção, XSS, TLS e criptografia', () => {
  assert.ok(ids('const r = eval(entrada);', '.js').includes('js-eval'));
  assert.ok(!ids('const avaliacao = medeval(x);', '.js').includes('js-eval'));
  assert.ok(ids('exec(`git log ${ramo}`)', '.ts').includes('js-exec-interpolado'));
  assert.ok(ids('String sql = "SELECT * FROM conta WHERE id = " + id;', '.java').includes('sql-concatenado'));
  assert.ok(ids('cursor.execute(f"SELECT * FROM t WHERE id = {x}")', '.py').includes('sql-concatenado'));
  assert.ok(!ids('PreparedStatement ps = c.prepareStatement("SELECT * FROM conta WHERE id = ?");', '.java').includes('sql-concatenado'));
  assert.ok(ids('el.innerHTML = dados;', '.js').includes('js-innerhtml'));
  assert.ok(!ids('if (el.innerHTML === "") {}', '.js').includes('js-innerhtml'));
  assert.ok(ids('https.request({ rejectUnauthorized: false })', '.js').includes('tls-desligado'));
  assert.ok(ids('requests.get(url, verify=False)', '.py').includes('tls-desligado'));
  assert.ok(ids('MessageDigest.getInstance("MD5")', '.java').includes('cripto-hash-fraco'));
  assert.ok(ids('Cipher.getInstance("AES/ECB/PKCS5Padding")', '.java').includes('cripto-cifra-fraca'));
  assert.ok(ids('const token = Math.random().toString(36)', '.js').includes('aleatorio-inseguro'));
  assert.ok(!ids('const x = Math.random() * largura', '.js').includes('aleatorio-inseguro'));
  assert.ok(ids('var f = new BinaryFormatter();', '.cs').includes('desserializacao-insegura'));
  assert.ok(ids('dados = yaml.load(arquivo)', '.py').includes('desserializacao-insegura'));
  assert.ok(!ids('dados = yaml.load(arquivo, Loader=yaml.SafeLoader)', '.py').includes('desserializacao-insegura'));
});

test('regras financeiras e LGPD', () => {
  assert.ok(ids('private double valorResgate;', '.java').includes('dinheiro-ponto-flutuante'));
  assert.ok(ids('decimal saldo; float taxaJuros = 0.1f;', '.cs').includes('dinheiro-ponto-flutuante'));
  assert.ok(!ids('private double latitude;', '.java').includes('dinheiro-ponto-flutuante'));
  assert.ok(ids('const total = parseFloat(valorAporte)', '.ts').includes('dinheiro-float-js-py'));
  assert.ok(ids('BigDecimal x = new BigDecimal(0.1);', '.java').includes('bigdecimal-double'));
  assert.ok(ids('a.divide(b)', '.java').includes('divisao-sem-arredondamento'));
  assert.ok(!ids('a.divide(b, 2, RoundingMode.HALF_EVEN)', '.java').includes('divisao-sem-arredondamento'));
  assert.ok(ids('logger.info("CPF do cliente: " + cpf)', '.java').includes('log-dado-sensivel'));
  assert.ok(ids('console.log("token", token)', '.js').includes('log-dado-sensivel'));
  assert.ok(ids('DELETE FROM contribuicao;', '.sql').includes('sql-delete-sem-where'));
  assert.ok(!ids('DELETE FROM contribuicao WHERE id = 1;', '.sql').includes('sql-delete-sem-where'));
});

test('regras de qualidade e supressão justificada', () => {
  assert.ok(ids("it.skip('calcula', () => {})", '.js').includes('teste-desabilitado'));
  assert.ok(ids('@Disabled', '.java').includes('teste-desabilitado'));
  assert.ok(ids("describe.only('x', () => {})", '.ts').includes('teste-exclusivo'));
  assert.ok(ids('} catch (e) {}', '.js').includes('catch-vazio'));
  const sup = avaliarLinha('el.innerHTML = MODELO_FIXO; // bp-ignorar: js-innerhtml conteúdo constante do bundle', '.js');
  assert.equal(sup[0].severidade, 'suprimida');
  assert.match(sup[0].justificativa, /constante/);
  assert.equal(avaliarLinha('x'.repeat(5000), '.js').length, 0, 'linhas minificadas são ignoradas');
});

test('portões em modo completo reprovam segredo e PII e aprovam código limpo', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'bp-portao-'));
  try {
    mkdirSync(join(raiz, 'src'));
    writeFileSync(join(raiz, 'src', 'ok.js'), 'export const soma = (a, b) => a + b;\n');
    const config = carregarConfig(raiz);
    const r1 = await executarPortoes(raiz, config, { tudo: true });
    assert.ok(r1.aprovado, resumirPortoes(r1));
    writeFileSync(join(raiz, 'src', 'ruim.js'), 'const chave = "AKIAABCDEFGHIJKLMNOP";\nconst cliente = "000.000.001-91";\n');
    const r2 = await executarPortoes(raiz, config, { tudo: true });
    assert.equal(r2.aprovado, false);
    assert.ok(r2.achados.some((a) => a.regra === 'segredo:aws-access-key'));
    assert.ok(r2.achados.some((a) => a.regra === 'pii:cpf' && a.severidade === 'bloqueante'));
    mkdirSync(join(raiz, 'test'));
    writeFileSync(join(raiz, 'src', 'ruim.js'), 'export {};\n');
    writeFileSync(join(raiz, 'test', 'dados.test.js'), 'const cpf = "000.000.001-91";\n');
    const r3 = await executarPortoes(raiz, config, { tudo: true });
    assert.ok(r3.aprovado, 'CPF sintético em teste é aviso, não bloqueio');
    assert.ok(r3.achados.some((a) => a.regra === 'pii:cpf' && a.severidade === 'media'));
    assert.ok(!resumirPortoes(r2).includes('AKIAABCDEFGHIJKLMNOP'), 'resumo nunca expõe o segredo');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('portões em modo diferença olham só o que mudou e acusam governança', { skip: !gitDisponivel() && 'git ausente' }, async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'bp-portao-git-'));
  try {
    const g = (...a) => execFileSync('git', a, { cwd: raiz, stdio: 'pipe' });
    g('init', '-q');
    g('config', 'user.email', 'teste@exemplo.invalid');
    g('config', 'user.name', 'teste');
    mkdirSync(join(raiz, 'src'));
    writeFileSync(join(raiz, 'src', 'legado.js'), 'const x = eval("1");\n');
    g('add', '.');
    g('commit', '-qm', 'base');
    writeFileSync(join(raiz, 'src', 'novo.js'), 'export const y = 2;\n');
    const config = carregarConfig(raiz);
    const r1 = await executarPortoes(raiz, config);
    assert.equal(r1.modo, 'diferenca');
    assert.ok(r1.aprovado, 'eval legado fora do diff não reprova');
    writeFileSync(join(raiz, 'src', 'legado.js'), 'const x = eval("1");\nconst z = eval(entrada);\n');
    mkdirSync(join(raiz, '.kiro', 'hooks'), { recursive: true });
    writeFileSync(join(raiz, '.kiro', 'hooks', 'x.json'), '{}\n');
    const r2 = await executarPortoes(raiz, config);
    assert.equal(r2.aprovado, false);
    const evals = r2.achados.filter((a) => a.regra === 'js-eval');
    assert.equal(evals.length, 1);
    assert.equal(evals[0].linha, 2);
    assert.ok(r2.achados.some((a) => a.regra === 'governanca-alterada'));
    writeFileSync(join(raiz, 'src', 'novo.js'), '// bp-ignorar-arquivo: tentativa de esconder achados deste arquivo\nconst w = eval(x);\n');
    const r3 = await executarPortoes(raiz, config);
    assert.ok(r3.achados.some((a) => a.regra === 'supressao-adicionada' && a.severidade === 'alta'), 'supressão nova é denunciada');
    assert.ok(r3.achados.some((a) => a.arquivo === 'src/novo.js' && a.severidade === 'suprimida'));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
