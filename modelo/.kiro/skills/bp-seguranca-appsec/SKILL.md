---
name: bp-seguranca-appsec
description: Segurança de aplicações do Orquestrador BP para instituição financeira (modelagem de ameaças STRIDE, OWASP ASVS 5.0 nível 2 e 3, OWASP Top 10 2025, CWE Top 25, autenticação, autorização, criptografia, injeção, segredos, logs) com régua de severidade. Use ao projetar, implementar ou revisar código com impacto de segurança.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# AppSec no Orquestrador BP

Referências: OWASP ASVS 5.0 (nível 2 como base; nível 3 para fluxos que movimentam dinheiro, autenticação e dados pessoais), OWASP Top 10 2025 e CWE Top 25. Mapa por tema em `references/controles.md`.

## Modelagem de ameaças do diff (STRIDE)

Para cada componente ou fluxo alterado, pergunte:

- **Falsificação:** a identidade é verificada no servidor? Tokens validados (assinatura, emissor, audiência, expiração)?
- **Adulteração:** dados de entrada e de integração são validados e protegidos em trânsito e em repouso?
- **Repúdio:** a ação sensível deixa trilha de auditoria íntegra?
- **Divulgação:** algum dado pessoal ou segredo aparece em resposta, log, URL, erro ou teste?
- **Negação de serviço:** há limite de taxa, tamanho, paginação e tempo limite?
- **Elevação de privilégio:** a autorização é checada por recurso e por função em cada operação?

## Pontos que mais falham em sistemas financeiros

1. Controle de acesso quebrado: IDOR (trocar o id do contrato na URL), função administrativa sem checagem, autorização só no front-end.
2. Injeção: SQL concatenado, comando de sistema, template, LDAP, consultas dinâmicas em ORM.
3. Lógica de negócio abusável: valores negativos, repetição de operação, corrida entre requisições, pular etapa de confirmação.
4. Criptografia: algoritmo fraco (MD5, SHA-1, DES, ECB), chave no código, IV fixo, aleatório não criptográfico.
5. Segredos e dados pessoais em código, log, URL ou mensagem de erro.
6. Configuração: CORS aberto, CSRF desligado, TLS sem validação, cabeçalhos de segurança ausentes, modo de depuração.
7. Desserialização insegura e upload sem validação de tipo, tamanho e destino.
8. Cadeia de suprimentos: dependência nova sem aprovação (proibida neste ambiente).
9. Falhas em condições excepcionais: exceção que deixa estado parcial ou libera acesso.

## Régua de severidade

- **bloqueante:** exploração plausível que expõe dados, permite fraude ou movimentação indevida, contorna autenticação ou autorização, ou viola a LGPD.
- **alta:** fraqueza séria com mitigação parcial ou dependente de condição comum.
- **media:** defesa em profundidade ausente, configuração fraca sem exploração direta.
- **baixa:** endurecimento recomendado.

Cada achado cita `referencia` (CWE ou tema do ASVS), o cenário defensivo e a correção. Não produza exploit funcional.
