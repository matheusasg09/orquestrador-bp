#!/usr/bin/env node
// Orquestrador BP: ponto de entrada. Somente biblioteca padrão do Node.js (>= 20.11).
import { executarCli } from '../src/cli.mjs';

await executarCli(process.argv.slice(2));
