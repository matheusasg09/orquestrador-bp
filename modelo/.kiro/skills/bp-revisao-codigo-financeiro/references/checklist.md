# Checklist completo de revisão financeira

## 1. Regra de negócio

- Cada critério EARS tem implementação e teste correspondente.
- Limites inclusivos ou exclusivos conforme a regra (`>=` versus `>`), conferidos com o texto do requisito.
- Estados e transições válidos; transição proibida é recusada com erro de negócio.
- Valores padrão não mudam o comportamento de contratos existentes.
- Premissas do plano refletidas no código e marcadas para validação humana.

## 2. Dinheiro e cálculo

- Tipo decimal exato em toda a cadeia (entrada, cálculo, persistência, serialização). JSON transporta valores como string decimal ou centavos inteiros.
- `BigDecimal`: construído de string ou `valueOf` de valor exato; `divide` com escala e `RoundingMode`; `setScale` com `RoundingMode`; `compareTo` em vez de `equals` quando a escala variar.
- C#: `decimal`; `Math.Round` com `MidpointRounding` explícito.
- JS/TS: centavos em `bigint` ou inteiro seguro; formatação só na apresentação.
- Arredondamento no ponto definido pela regra (por parcela ou no total); resíduo de centavos distribuído de forma determinística.
- Percentuais e taxas com precisão suficiente (ex.: 4 a 8 casas) antes do arredondamento final.
- Conversão entre valor e cotas com casas decimais do regulamento.

## 3. Datas e prazos

- Fuso explícito; sem `new Date()` ou `now()` espalhado (relógio injetável para teste).
- Prazos em dias úteis usam calendário de feriados configurado.
- Comparações de data de negócio sem componente de hora.

## 4. Concorrência, idempotência e consistência

- Operações de crédito, débito, resgate, aporte e portabilidade com chave de idempotência.
- Controle de versão ou trava em atualização de saldo.
- Efeitos externos (mensagem, e-mail, integração) só após commit ou com outbox.
- Jobs reentrantes e seguros para reprocessamento.

## 5. Erros e resiliência

- Nenhum `catch` vazio; exceção registrada com contexto e sem dado pessoal.
- Mensagem ao usuário genérica e com id de correlação.
- Timeout e retry somente em operação idempotente; falha de dependência não deixa estado parcial.

## 6. API e contratos

- Compatibilidade retroativa (campos novos opcionais, nada removido sem versão).
- Validação de tipo, tamanho, formato e faixa; rejeição de campos desconhecidos onde o padrão do projeto exigir.
- Códigos HTTP corretos (400, 401, 403, 404, 409, 422, 429, 500).

## 7. Persistência e desempenho

- Consultas parametrizadas; índices para novos filtros e ordenações.
- Sem N+1, sem carregar coleção inteira para contar ou filtrar em memória.
- Migração reversível; colunas novas com padrão seguro; sem bloqueio longo em tabela grande.

## 8. Observabilidade e auditoria

- Log estruturado, nível adequado, id de correlação.
- Trilha de auditoria para ação sensível (quem, o quê, quando, origem, resultado).
- Nenhum dado pessoal, token, senha ou número de cartão em log, métrica ou rastreamento.

## 9. Testes

- Testes provam o comportamento (falhariam sem a mudança).
- Bordas, erros e permissões cobertos; dados sintéticos; sem dependência de ordem ou de horário real.

## 10. Manutenção

- Nomes do domínio; funções e classes coesas; sem duplicação de regra; sem código morto ou comentado; consistente com o estilo do projeto.
