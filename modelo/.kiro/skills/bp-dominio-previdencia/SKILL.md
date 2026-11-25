---
name: bp-dominio-previdencia
description: Conceitos do domínio de previdência complementar aberta (PGBL, VGBL, contribuição, aporte, resgate, portabilidade, cotas, regimes de tributação progressivo e regressivo, carregamento, benefícios) e cuidados de cálculo para o Orquestrador BP. Use ao planejar, implementar, testar ou revisar regras de negócio previdenciárias.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# Domínio de previdência complementar

Vocabulário e armadilhas comuns. **A regra que vale é a da demanda e do regulamento do plano.** Os números abaixo são de referência e devem ser confirmados com a área de negócio e a área tributária; qualquer divergência vira premissa registrada, nunca suposição silenciosa.

## Produtos

- **PGBL:** contribuições podem ser deduzidas da base do IR na declaração completa (limite de referência: 12% da renda bruta tributável); no resgate ou benefício, o IR incide sobre o **valor total**.
- **VGBL:** sem dedução; o IR incide apenas sobre os **rendimentos**.
- Fase de **acumulação** (contribuições e aportes compram cotas do fundo) e fase de **benefício** (renda ou pagamento único).

## Operações

- **Contribuição** (periódica) e **aporte** (esporádico): convertidos em cotas pelo valor da cota da data de conversão definida no regulamento.
- **Resgate:** total ou parcial, sujeito a carência do regulamento; valor bruto, IR retido, taxas e valor líquido devem fechar exatamente.
- **Portabilidade:** transferência de reserva entre planos sem incidência de IR, entre produtos do mesmo tipo (PGBL para PGBL, VGBL para VGBL), preservando o histórico de aportes para o regime regressivo.
- **Taxas:** carregamento (sobre contribuições ou resgates, conforme o plano) e administração (sobre o patrimônio, refletida no valor da cota).

## Tributação (referência; confirmar com a área tributária)

- **Regime regressivo (Lei 11.053/2004):** alíquota definitiva pelo prazo de acumulação **de cada aporte**: 35% até 2 anos; 30% de 2 a 4; 25% de 4 a 6; 20% de 6 a 8; 15% de 8 a 10; 10% acima de 10 anos. O cálculo é por aporte (ordem cronológica), não pelo saldo.
- **Regime progressivo:** retenção antecipada no resgate (referência: 15%) com ajuste na declaração anual pela tabela progressiva; na renda, tabela progressiva mensal.
- **Escolha do regime:** a Lei 14.803/2024 permite optar até a obtenção do benefício ou o primeiro resgate; trate a opção como dado versionado do participante.

## Armadilhas de cálculo

- Cotas com casas decimais do regulamento; valor em reais com 2 casas; arredondamento explícito e testado.
- A soma dos valores por aporte deve bater com o total resgatado; resíduo de arredondamento distribuído de forma determinística.
- Datas de conversão, dias úteis e fuso de São Paulo; virada de ano muda faixa do regime regressivo.
- Resgate parcial consome aportes conforme a regra do plano (normalmente os mais antigos primeiro no regressivo); teste os dois extremos.
- Valores negativos, zerados, acima do saldo ou durante carência são recusados com mensagem de negócio.

## Dados e testes

Participante, CPF, proposta e certificado são dados pessoais: use dados sintéticos e nunca exponha em log. Cenários de teste sempre com exemplos numéricos fechados (entrada, alíquota, imposto, líquido).
