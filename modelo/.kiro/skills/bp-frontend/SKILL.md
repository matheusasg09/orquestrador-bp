---
name: bp-frontend
description: Padrões de front-end do Orquestrador BP para portais financeiros (React, Angular, Vue ou HTML), cobrindo fidelidade ao layout, formulários, formatação brasileira, acessibilidade, segurança no navegador e desempenho. Use ao implementar ou corrigir telas.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# Front-end para portal financeiro

Use o design system e os componentes já existentes no repositório. Não crie estilo paralelo.

## Fidelidade ao layout

- Implemente exatamente o que o layout da demanda descreve: campos, rótulos, ordem, textos de ajuda, mensagens, botões e estados.
- Todo fluxo tem estados vazio, carregando, sucesso e erro, com texto definido.
- Responsivo nas larguras do padrão do projeto; sem rolagem horizontal.

## Formulários

- Validação no cliente para usabilidade e sempre de novo no servidor.
- Mensagens de erro junto ao campo, objetivas, sem expor detalhes técnicos.
- Botão de confirmação desabilitado durante o envio (evita duplicidade); confirmação explícita antes de operações que movimentam valor.

## Formatação brasileira

- Moeda com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` a partir de centavos inteiros; nunca aritmética de dinheiro em `number` de ponto flutuante.
- Datas `dd/mm/aaaa` em `America/Sao_Paulo`; CPF e CNPJ com máscara e exibidos mascarados quando não forem do próprio usuário.

## Acessibilidade (WCAG 2.2 AA)

- Todo campo com `label` associado; botões e links com nome acessível; imagens com `alt`.
- Navegação completa por teclado, foco visível, ordem lógica; contraste adequado.
- Mensagens dinâmicas anunciadas (`aria-live`) e erros ligados ao campo (`aria-describedby`).

## Segurança no navegador

- Nada de `innerHTML`, `dangerouslySetInnerHTML`, `v-html` ou `bypassSecurityTrust` com dado variável.
- Tokens em cookie `HttpOnly`/`Secure`/`SameSite` gerido pelo servidor, nunca em `localStorage`/`sessionStorage`.
- Sem dados pessoais em URL, título da página, logs do console ou analytics.
- Sem dependências ou scripts de terceiros novos.

## Desempenho

- Carregamento sob demanda de rotas pesadas; listas grandes paginadas ou virtualizadas; sem requisições em laço.

## Testes

- Testes de componente para regras de exibição e validação; roteiro E2E do BP (`e2e/roteiros/*.json`) para os fluxos principais.
