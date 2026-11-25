---
name: bp-lgpd-regulatorio
description: Requisitos de LGPD e de regulação do setor (SUSEP, segurança cibernética, prevenção à lavagem de dinheiro, PCI DSS quando houver cartão) aplicados a código e design no Orquestrador BP. Use ao tratar dados pessoais, desenhar fluxos com clientes ou revisar conformidade.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# LGPD e regulatório no código

Esta skill orienta engenharia; não substitui o parecer de Compliance, Jurídico e DPO. Confirme sempre o normativo vigente com essas áreas.

## LGPD (Lei 13.709/2018)

- **Princípios (art. 6º):** finalidade, adequação, necessidade (minimização), livre acesso, qualidade, transparência, segurança, prevenção, não discriminação e responsabilização. No código: colete e exponha só o necessário para a finalidade declarada na demanda.
- **Dados sensíveis (art. 5º, II e art. 11):** saúde, biometria, origem racial e outros exigem cuidado reforçado; em previdência, dados de saúde podem surgir em coberturas de risco. Não trafegue nem registre sem necessidade explícita.
- **Segurança (art. 46):** medidas técnicas para proteger contra acesso não autorizado, perda e vazamento: autorização por recurso, criptografia, mascaramento, logs sem dados pessoais.
- **Incidentes (art. 48):** trilha de auditoria e logs de segurança precisam permitir investigar quem acessou o quê.
- **Direitos do titular:** o design não deve impedir acesso, correção, portabilidade e eliminação quando aplicáveis; respeite prazos de retenção definidos pela área de negócio.

## Práticas obrigatórias neste ambiente

- Nenhum dado pessoal real em código, testes, fixtures, logs, capturas de tela ou prompts. Dados de teste sintéticos.
- Mascaramento padrão de CPF (`***.***.***-12`), e-mail e telefone em telas que não sejam do próprio titular e em todo log.
- Sem dado pessoal em URL, cabeçalho de referência, título de página ou analytics.
- Retenção e exclusão conforme política: não crie cópias, caches ou exports sem prazo definido.

## Setor de seguros e previdência

- **SUSEP:** a Circular SUSEP nº 638/2021 trata de requisitos de segurança cibernética para supervisionadas (política de segurança, controles, gestão de incidentes). Reflita no código: controle de acesso, rastreabilidade, proteção de dados, resposta a incidentes.
- **Prevenção à lavagem de dinheiro:** operações de aporte, resgate e portabilidade podem alimentar monitoramento (normas SUSEP de PLD/FT). Não remova nem altere eventos e registros usados por esse monitoramento sem requisito explícito.
- **Grupo financeiro:** se o sistema integrar com instituições reguladas pelo Banco Central, a política de segurança cibernética da Resolução CMN nº 4.893/2021 pode se aplicar aos fluxos compartilhados.
- **Cartões:** se houver dado de cartão, aplique PCI DSS v4.0.1: não armazenar CVV, truncar o número, tokenizar.

## Residência de dados e uso de IA

- Os modelos usados pelo Kiro processam inferência fora do Brasil (geografias US ou EU). A política `.bp/modelos.json` bloqueia roteamento Global e modelos com retenção estendida por padrão.
- Nunca envie ao modelo dado pessoal real ou segredo: os hooks e o RAG do BP mascaram, mas a responsabilidade é de quem escreve demanda, código e testes.
