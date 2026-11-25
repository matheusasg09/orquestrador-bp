// Erros tipados e códigos de saída estáveis para scripts, hooks e workflows.

export const SAIDA = Object.freeze({
  OK: 0,
  FALHA: 1, // falha de verificação (portão reprovado, teste falhou)
  BLOQUEIO: 2, // hooks: bloqueia a ação (contrato do Kiro: exit 2 bloqueia PreToolUse)
  USO: 64, // argumentos inválidos
  CONFIG: 78, // configuração inválida
  INTERNO: 70, // erro inesperado
});

export class BpErro extends Error {
  constructor(mensagem, { codigo = SAIDA.INTERNO, detalhes } = {}) {
    super(mensagem);
    this.name = 'BpErro';
    this.codigo = codigo;
    if (detalhes !== undefined) this.detalhes = detalhes;
  }
}

export function erroUso(mensagem) {
  return new BpErro(mensagem, { codigo: SAIDA.USO });
}

export function erroConfig(mensagem, detalhes) {
  return new BpErro(mensagem, { codigo: SAIDA.CONFIG, detalhes });
}
