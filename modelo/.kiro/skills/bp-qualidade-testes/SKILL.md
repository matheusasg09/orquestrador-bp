---
name: bp-qualidade-testes
description: Estratégia de testes automatizados do Orquestrador BP (TDD, pirâmide, casos de borda financeiros, testes de propriedade, dados sintéticos, roteiros E2E) e o loop de testes até verde. Use ao escrever, corrigir ou revisar testes e ao concluir tarefas.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# Testes no Orquestrador BP

## Loop

1. Escreva o teste do critério de aceite e veja falhar pelo motivo certo.
2. Implemente o mínimo para passar.
3. Refatore com os testes verdes.
4. `node .bp/bp.mjs testes` (detecta npm, Maven, Gradle, dotnet, pytest e Go, ou usa `testes.comandos` da configuração) e devolve só as falhas.

## O que testar

- **Regra de negócio:** cada critério EARS vira teste nomeado pelo comportamento.
- **Bordas:** zero, mínimo, máximo, igualdade no limite, negativo, vazio, nulo, texto longo, caracteres especiais e acentos.
- **Dinheiro:** arredondamento em cada etapa, soma de parcelas igual ao total, centavos residuais, conversão de cotas.
- **Datas:** virada de mês e ano, fim de semana e feriado, fuso, prazos contados em dias corridos e úteis.
- **Erros:** entrada inválida, recurso inexistente, permissão negada (outro participante), dependência fora do ar, timeout.
- **Concorrência e idempotência:** requisição repetida não duplica efeito; disputa de saldo não gera saldo negativo.

## Testes de propriedade sem dependência nova

Quando não houver biblioteca no projeto, gere casos com um gerador pseudoaleatório de semente fixa no próprio teste e verifique invariantes (ex.: `valorLiquido + imposto + taxas == valorBruto` para 1.000 valores; resultado sempre com 2 casas). Registre a semente na mensagem de falha.

## Pirâmide

Muitos testes de unidade do domínio, testes de integração nas fronteiras (repositório, API, mensageria) e poucos E2E nos fluxos críticos (roteiros do navegador do BP).

## Dados

Somente sintéticos: CPF gerado com dígito verificador válido apenas quando a regra exigir validação, nomes fictícios, valores redondos e conhecidos. Nunca copie dados de produção.

## Proibido

`.skip`, `.only`, `@Disabled`, `@Ignore`, asserção removida ou afrouxada para passar, teste que não falharia sem a implementação, dependência de ordem entre testes, `sleep` fixo para esperar condição.
