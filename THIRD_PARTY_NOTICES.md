# Avisos de terceiros

O Orquestrador BP não tem dependências de pacotes. Partes do controle de navegador foram reescritas em JavaScript a partir de técnicas do projeto Browser Use, sob licença MIT, após auditoria de segurança (ver `docs/AUDITORIA-BROWSER-USE.md`). Nenhum arquivo do Browser Use foi copiado integralmente; os trechos adaptados estão identificados no cabeçalho de `src/navegador/serializar.mjs` e `src/navegador/js-pagina.mjs`.

## Browser Use

- Repositório: https://github.com/browser-use/browser-use (commit `94784c1f7ecb6b0a5f565b7f9fba59e395b7e048`, versão 1.0.8) e tag 0.13.14 (commit `2cc71890e65056b67fdb29d98bb407749c15bb08`).
- Técnicas adaptadas: percurso da árvore de acessibilidade com elementos indexados (`browser_use/ax.py`) e cálculo do ponto de clique sem obstrução.

```text
MIT License

Copyright (c) 2024 Gregor Zunic

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## browser-use-pi

- Repositório: https://github.com/browser-use/browser-use-pi (commit `3583b8a10a2cf393956ad75c32fec302b227aa32`), versão TypeScript do mesmo algoritmo (`src/ax.ts`), usada como referência.

```text
MIT License

Copyright (c) 2026 Browser Use contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
