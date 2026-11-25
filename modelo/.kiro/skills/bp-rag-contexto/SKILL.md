---
name: bp-rag-contexto
description: Uso do RAG local do Orquestrador BP (índice vetorial e lexical do repositório) para achar código, regras de negócio e documentação relevantes com orçamento de tokens. Use antes de abrir arquivos, ao investigar onde algo está implementado ou ao montar contexto para uma tarefa.
metadata:
  autor: Orquestrador BP
  versao: "1.0"
---

# RAG local do BP

O índice fica em `.bp/estado/rag/` e é 100% local: nada sai da máquina. Cada trecho tem vetor TF-IDF de trigramas (tolerante a plural, acento e variação de identificadores como `valorTotal`/`valor_total`) e termos para BM25; a busca funde os dois rankings (Reciprocal Rank Fusion), prioriza `docs/negocio/` e specs, e limita trechos por arquivo para diversificar. Segredos e dados pessoais são mascarados antes de indexar.

## Comandos

- `node .bp/bp.mjs rag indexar`: cria ou atualiza (incremental por hash; rápido quando pouco mudou).
- `node .bp/bp.mjs rag buscar "consulta" --k 8`: lista `caminho:linhas` e pontuação.
- `node .bp/bp.mjs rag contexto "consulta" --orcamento 3000`: Markdown com os trechos que cabem no orçamento, trechos vizinhos mesclados. `--caminho "src/**"` filtra; `--saida arquivo.md` grava em `.bp/estado/entrada/`.

## Como consultar bem

- Use termos do domínio e do código juntos: `resgate saldo cotas ResgateService validacao`.
- Uma consulta por assunto; duas consultas curtas são melhores que uma longa e difusa.
- Se o resultado não trouxer o esperado, troque sinônimos (português e inglês, nome de classe, rota da API).
- Reindexe depois de mudanças grandes: o índice reflete o disco no momento da indexação.

## Busca semântica nativa do Kiro

O Kiro também oferece bases de conhecimento locais (`knowledgeBase`, índice `best` com embeddings `all-minilm-l6-v2`) para documentação extensa. O RAG do BP continua sendo a fonte para pacotes de contexto com orçamento, citações e mascaramento.
