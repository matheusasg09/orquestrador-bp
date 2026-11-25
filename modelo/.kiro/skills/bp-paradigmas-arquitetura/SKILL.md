---
name: bp-paradigmas-arquitetura
description: Princípios de arquitetura e paradigmas do Orquestrador BP (SOLID, arquitetura hexagonal, DDD tático, programação funcional e orientada a objetos, imutabilidade, tratamento de erros, concorrência) para decidir estrutura de código e revisar design. Use ao projetar módulos, refatorar ou revisar acoplamento.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# Arquitetura e paradigmas

Consistência com o repositório vem primeiro. Introduza padrão novo só quando a tarefa exigir e o design aprovado previr.

## Estrutura

- **Hexagonal (portas e adaptadores):** domínio sem dependência de framework, banco ou HTTP; casos de uso orquestram; adaptadores traduzem.
- **DDD tático onde há regra rica:** entidades com identidade, objetos de valor imutáveis (`Dinheiro`, `Cpf`, `Periodo`, `QuantidadeCotas`) que validam a si mesmos, agregados que protegem invariantes, eventos de domínio para efeitos colaterais.
- **SOLID com bom senso:** responsabilidade única por módulo; dependa de abstrações nas fronteiras; não crie interfaces com uma só implementação sem motivo.

## Paradigmas

- **Funcional no núcleo:** cálculos como funções puras e determinísticas (fáceis de testar e auditar); efeitos (I/O, data atual, aleatório) injetados.
- **Orientado a objetos no modelo:** comportamento junto dos dados; evite modelo anêmico com regras espalhadas em serviços.
- **Imutabilidade por padrão;** mutação localizada e explícita.

## Erros

- Erros de negócio esperados como tipos ou resultados explícitos; exceções para o inesperado.
- Nunca engula exceção; nunca use exceção para fluxo normal.
- Mensagens de erro de domínio sem dados pessoais.

## Concorrência

- Estado compartilhado mínimo; operações idempotentes; travas com escopo e tempo limite; nada de condição de corrida em saldo ou numeração.

## Simplicidade

- A solução mais simples que cumpre os requisitos e é fácil de mudar. Sem abstração especulativa, sem duplicação de regra de negócio, sem código morto.
