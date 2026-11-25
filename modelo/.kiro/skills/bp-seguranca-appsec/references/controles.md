# Controles por tema (base: OWASP ASVS 5.0, Top 10 2025, CWE Top 25)

Confirme o requisito exato na versão do ASVS adotada pela Segurança da Informação da Brasilprev.

## Autenticação e sessão

- Autenticação centralizada (IdP corporativo); MFA para operações de risco conforme política.
- Sessão com expiração por inatividade e absoluta; renovação do identificador após login; invalidação no logout no servidor.
- Cookies `HttpOnly`, `Secure`, `SameSite`; tokens com assinatura verificada, algoritmo fixo, `exp`, `iss`, `aud`.
- Mensagens de falha de login que não revelam se o usuário existe; limite de tentativas. CWE-287, CWE-307, CWE-384, CWE-613.

## Autorização

- Negar por padrão; verificação por recurso (dono do contrato) e por função em toda rota e serviço.
- Identificadores não sequenciais quando expostos, sem substituir a checagem de autorização. CWE-639, CWE-862, CWE-863.

## Validação, codificação e injeção

- Lista de permissões para formato, tamanho e faixa; normalização antes da validação.
- Consultas parametrizadas; sem montagem de comando de sistema com entrada; codificação de saída por contexto (HTML, atributo, JS, URL). CWE-20, CWE-78, CWE-79, CWE-89, CWE-94.
- SSRF: URLs de destino de lista fixa, sem seguir redirecionamento para rede interna. CWE-918.

## Criptografia e segredos

- TLS 1.2 ou superior com validação de certificado; AES-256-GCM para dados em repouso quando exigido; hash de senha com Argon2id, scrypt ou PBKDF2.
- Chaves e segredos no cofre corporativo; rotação; nunca em código, configuração versionada ou log. CWE-259, CWE-321, CWE-327, CWE-338, CWE-798.

## Dados pessoais e logs

- Minimização na resposta da API; mascaramento na tela e no log; nada de dado pessoal em URL.
- Log de segurança para autenticação, autorização negada, alteração de dados cadastrais e bancários, movimentação financeira. CWE-200, CWE-359, CWE-532.

## Configuração e cabeçalhos

- `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors`.
- CORS com origens explícitas; CSRF ativo para sessão por cookie; sem depuração ou stack trace em produção. CWE-16, CWE-352, CWE-942.

## Arquivos e desserialização

- Upload com tipo verificado por conteúdo, tamanho máximo, nome gerado no servidor e armazenamento fora da raiz web. CWE-434.
- Sem desserialização de tipos arbitrários. CWE-502.

## Disponibilidade e abuso

- Limite de taxa por usuário e por IP em autenticação e operações financeiras; tempo limite; paginação. CWE-400, CWE-770.
