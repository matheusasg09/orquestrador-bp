// Isola as chaves de integridade dos testes numa pasta temporária (nunca no perfil real).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.BP_DIR_CHAVES) process.env.BP_DIR_CHAVES = mkdtempSync(join(tmpdir(), 'bp-chaves-teste-'));
