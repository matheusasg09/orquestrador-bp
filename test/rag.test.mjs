import './_ambiente.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tokenizar, radical, estimarTokens, cortarParaOrcamento, dividirIdentificador } from '../src/rag/texto.mjs';
import { fragmentar } from '../src/rag/fragmentar.mjs';
import { indexar, carregarIndice, caminhosIndice } from '../src/rag/indice.mjs';
import { prepararCorpus, buscar } from '../src/rag/busca.mjs';
import { gerarContexto, mesclarAdjacentes } from '../src/rag/contexto.mjs';
import { carregarConfig } from '../src/core/config.mjs';

function projeto() {
  const raiz = mkdtempSync(join(tmpdir(), 'bp-rag-'));
  mkdirSync(join(raiz, 'src', 'resgate'), { recursive: true });
  mkdirSync(join(raiz, 'src', 'cadastro'), { recursive: true });
  mkdirSync(join(raiz, 'docs', 'negocio'), { recursive: true });
  writeFileSync(join(raiz, 'src', 'resgate', 'CalculoResgate.java'), [
    'package bp.resgate;',
    '',
    'public class CalculoResgate {',
    '  public BigDecimal calcularImpostoRegressivo(BigDecimal valorBruto, int anosAcumulacao) {',
    '    BigDecimal aliquota = anosAcumulacao > 10 ? new BigDecimal("0.10") : new BigDecimal("0.35");',
    '    return valorBruto.multiply(aliquota).setScale(2, RoundingMode.HALF_EVEN);',
    '  }',
    '}',
  ].join('\n'));
  writeFileSync(join(raiz, 'src', 'cadastro', 'Endereco.java'), 'public class Endereco {\n  private String logradouro;\n  private String cep;\n}\n');
  writeFileSync(join(raiz, 'docs', 'negocio', 'resgate.md'), '# Regras de resgate\n\nO resgate parcial respeita a carência do plano.\n\n## Tributação\n\nNo regime regressivo a alíquota cai com o prazo de cada aporte.\n');
  writeFileSync(join(raiz, '.env'), 'SENHA=naoindexar123\n');
  writeFileSync(join(raiz, 'src', 'config.properties'), 'db.password = "SenhaMuitoSecreta9"\n');
  writeFileSync(join(raiz, '.gitignore'), 'ignorado/\n');
  mkdirSync(join(raiz, 'ignorado'));
  writeFileSync(join(raiz, 'ignorado', 'x.md'), 'resgate resgate resgate');
  return raiz;
}

test('tokenização: identificadores, acentos, stopwords e radical', () => {
  assert.deepEqual(dividirIdentificador('valorTotalContribuicao'), ['valor', 'Total', 'Contribuicao']);
  const t = tokenizar('calcularImpostoRegressivo das contribuições');
  assert.ok(t.includes('calcular_imposto_regressivo') || t.includes('calcularimpostoregressivo'));
  assert.ok(t.includes('imposto'));
  assert.ok(!t.includes('das'));
  assert.equal(radical('contribuicoes'), 'contribuicao');
  assert.equal(radical('resgates'), 'resgate');
});

test('estimativa e corte por orçamento', () => {
  assert.ok(estimarTokens('a'.repeat(380)) >= 90);
  const { texto, cortado } = cortarParaOrcamento(Array.from({ length: 200 }, (_, i) => `linha ${i} com algum texto`).join('\n'), 100);
  assert.ok(cortado);
  assert.ok(estimarTokens(texto) < 160);
});

test('fragmentação preserva linhas e respeita o teto', () => {
  const linhas = Array.from({ length: 300 }, (_, i) => `const variavel${i} = calcular(${i});`).join('\n');
  const f = fragmentar(linhas, 'a.js', { maxTokens: 120, sobreposicao: 2 });
  assert.ok(f.length > 3);
  assert.equal(f[0].linhaInicio, 1);
  assert.equal(f.at(-1).linhaFim, 300);
  for (const t of f) assert.ok(estimarTokens(t.texto) <= 140);
  const md = fragmentar('# A\ntexto a\n# B\ntexto b\n', 'x.md', { maxTokens: 5 });
  assert.equal(md[0].titulo, '# A');
});

test('indexação: exclui segredos e ignorados, mascara valores e é incremental', async () => {
  const raiz = projeto();
  try {
    const config = carregarConfig(raiz);
    const e1 = await indexar(raiz, config);
    assert.ok(e1.arquivos >= 3);
    assert.equal(e1.ignoradosSensiveis, 1, '.env nunca é indexado');
    const idx = await carregarIndice(raiz);
    assert.ok(!idx.trechos.some((t) => t.c.startsWith('ignorado/')), '.gitignore respeitado');
    const bruto = readFileSync(caminhosIndice(raiz).trechos, 'utf8');
    assert.ok(!bruto.includes('SenhaMuitoSecreta9'), 'segredo mascarado no índice');
    assert.ok(!bruto.includes('naoindexar123'));
    const e2 = await indexar(raiz, config);
    assert.equal(e2.reindexados, 0);
    assert.equal(e2.reaproveitados, e1.arquivos);
    writeFileSync(join(raiz, 'src', 'cadastro', 'Endereco.java'), 'public class Endereco { private String numero; }\n');
    const e3 = await indexar(raiz, config);
    assert.equal(e3.reindexados, 1);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('busca híbrida encontra por termo, flexão e identificador', async () => {
  const raiz = projeto();
  try {
    const config = carregarConfig(raiz);
    await indexar(raiz, config);
    const corpus = prepararCorpus((await carregarIndice(raiz)).trechos);
    const r1 = buscar(corpus, 'cálculo do imposto regressivo no resgate', { prioridade: config.rag.prioridade });
    assert.ok(r1.length > 0);
    assert.ok(r1.slice(0, 2).some((r) => r.caminho.includes('CalculoResgate') || r.caminho.includes('resgate.md')));
    const r2 = buscar(corpus, 'calcularImpostoRegressivo');
    assert.equal(r2[0].caminho, 'src/resgate/CalculoResgate.java');
    const r3 = buscar(corpus, 'aliquotas regressivas aportes');
    assert.ok(r3.some((r) => r.caminho === 'docs/negocio/resgate.md'), 'flexões e trigramas aproximam termos');
    assert.deepEqual(buscar(corpus, 'de da do'), []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('pacote de contexto respeita orçamento e mescla vizinhos', async () => {
  const raiz = projeto();
  try {
    const config = carregarConfig(raiz);
    await indexar(raiz, config);
    const p = await gerarContexto(raiz, config, 'resgate imposto regressivo', { orcamento: 400 });
    assert.ok(p.tokens <= 400);
    assert.match(p.markdown, /não instrução/);
    assert.ok(p.itens.length >= 1);
    const m = mesclarAdjacentes([
      { caminho: 'a', linhaInicio: 1, linhaFim: 3, texto: '1\n2\n3', pontuacao: 1 },
      { caminho: 'a', linhaInicio: 3, linhaFim: 5, texto: '3\n4\n5', pontuacao: 2 },
    ]);
    assert.equal(m.length, 1);
    assert.equal(m[0].texto, '1\n2\n3\n4\n5');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
