---
name: bp-backend
description: Padrões de back-end do Orquestrador BP para sistemas financeiros (APIs, serviços, persistência, transações, integração, erros, logs), em Java, .NET, Node.js/TypeScript, Python ou Go. Use ao implementar ou corrigir código de servidor.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# Back-end para instituição financeira

Siga primeiro o padrão já adotado no repositório (frameworks, camadas, nomes). Estas regras complementam, não substituem.

## Domínio e precisão

- Valores monetários: `BigDecimal` (Java/Kotlin), `decimal` (C#), `Decimal` (Python), centavos em `bigint`/inteiro (JS/TS, Go). Escala e modo de arredondamento explícitos em cada operação (`HALF_EVEN` é o padrão bancário; use o que a regra de negócio definir).
- Nunca compare dinheiro com `==` de ponto flutuante; compare decimais com `compareTo`/igualdade de escala definida.
- Datas: armazene em UTC, apresente no fuso `America/Sao_Paulo`; datas de negócio (competência, vencimento) como `LocalDate`/`DateOnly`, sem hora. Dias úteis vêm de calendário configurado, nunca de cálculo ingênuo.
- Regra de negócio no domínio, isolada de framework e I/O, testável sem banco.

## API

- Validação de entrada na borda (tipo, tamanho, formato, faixa, lista de valores); rejeite o desconhecido.
- Autorização por recurso no servidor, em toda operação (o participante só acessa os próprios contratos).
- Erros com código e mensagem genérica ao cliente, detalhes só no log; formato consistente (ex.: RFC 9457 Problem Details).
- Operações que movimentam valor são idempotentes (chave de idempotência persistida) e auditadas.
- Paginação e limites em listagens; sem retorno de entidades inteiras com dados sensíveis.

## Persistência e transações

- Consultas parametrizadas ou ORM; nunca concatenação.
- Transação do tamanho da regra: nem maior (bloqueios longos) nem menor (estado inconsistente). Controle de concorrência otimista (versão) ou pessimista explícito onde há disputa de saldo.
- Migrações versionadas, reversíveis e compatíveis com a versão anterior da aplicação (expandir, migrar, contrair).
- Sem N+1: carregue relações necessárias de forma explícita; índices para filtros novos.

## Integração e resiliência

- Timeouts em toda chamada externa; retry só em operações idempotentes, com backoff e limite; circuit breaker onde houver padrão no projeto.
- Mensageria: consumo idempotente, tratamento de mensagens envenenadas, ordenação quando a regra exigir.

## Observabilidade

- Log estruturado com id de correlação; nunca CPF, nome, e-mail, saldo de pessoa identificável, token ou senha (mascare: `***.***.***-12`).
- Eventos de auditoria para ações sensíveis: quem, o quê, quando, de onde, resultado.
- Métricas de negócio e técnicas nos pontos novos, no padrão do projeto.

## Configuração e segredos

- Segredos só de variável de ambiente ou cofre corporativo; nada em código, teste ou arquivo versionado.
- Valores padrão seguros (falhar fechado).
