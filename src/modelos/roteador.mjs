// Roteamento determinístico de tarefas para papéis/modelos, sem gastar tokens:
// classifica risco e natureza da tarefa por sinais textuais e de caminho.

import { normalizar } from '../rag/texto.mjs';

const SINAIS_RISCO_ALTO = [
  // domínio financeiro e previdenciário
  'pagamento', 'transferencia', 'saldo', 'resgate', 'aporte', 'contribuicao', 'portabilidade', 'previdencia', 'pgbl', 'vgbl',
  'beneficio', 'sinistro', 'rentabilidade', 'cota', 'taxa de administracao', 'carregamento', 'imposto', 'imposto de renda', 'tributacao',
  'tabela regressiva', 'tabela progressiva', 'calculo atuarial', 'juros', 'arredondamento', 'conciliacao', 'boleto', 'pix', 'ted',
  'liquidacao', 'extrato', 'fatura', 'cobranca',
  // segurança e dados
  'autenticacao', 'autorizacao', 'login', 'senha', 'token', 'sessao', 'jwt', 'oauth', 'saml', 'criptografia', 'certificado', 'chave',
  'permissao', 'perfil de acesso', 'lgpd', 'dados pessoais', 'cpf', 'cnpj', 'consentimento', 'anonimiza', 'mascara',
  // técnico de alto impacto
  'migracao', 'migration', 'schema', 'concorrencia', 'transacao', 'lock', 'idempot', 'fila', 'mensageria', 'batch', 'job',
  'integracao', 'api publica', 'webhook', 'upload', 'payment', 'auth', 'security', 'encryption',
];

const SINAIS_MECANICOS = [
  'renomear', 'rename', 'formatar', 'format', 'typo', 'erro de digitacao', 'comentario', 'docstring', 'readme', 'documentacao',
  'mover arquivo', 'import', 'lint', 'boilerplate', 'traducao', 'texto da tela', 'label', 'changelog', 'ajuste de estilo',
];

const SINAIS_FRONT = ['tela', 'layout', 'componente', 'css', 'html', 'react', 'angular', 'vue', 'botao', 'formulario', 'pagina', 'frontend', 'ui', 'ux', 'acessibilidade'];
const SINAIS_BACK = ['api', 'endpoint', 'servico', 'service', 'repositorio', 'banco', 'sql', 'query', 'backend', 'controller', 'dominio', 'regra de negocio'];

const CAMINHOS_RISCO = /(auth|security|seguranca|crypto|payment|pagamento|financeiro|billing|migrations?|db\/|sql|transac|conta|saldo|previdencia)/i;

const cacheSinais = new Map();
function regexSinal(s) {
  if (!cacheSinais.has(s)) {
    const escapado = s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Casa no início de palavra: "lock" casa "locking", mas não "block".
    cacheSinais.set(s, new RegExp(`(?:^|[^a-z0-9])${escapado}`));
  }
  return cacheSinais.get(s);
}

function contarSinais(texto, sinais) {
  return sinais.filter((s) => regexSinal(s).test(texto)).length;
}

/**
 * Classifica uma tarefa. Entrada: { descricao, arquivos?: string[] }.
 * Saída: { risco: 'alto'|'medio'|'baixo', natureza: 'mecanica'|'frontend'|'backend'|'geral', papel, motivos }.
 */
export function classificarTarefa({ descricao = '', arquivos = [] }) {
  const t = ` ${normalizar(descricao)} `;
  const motivos = [];
  const risco = contarSinais(t, SINAIS_RISCO_ALTO);
  const mecanico = contarSinais(t, SINAIS_MECANICOS);
  const caminhosRisco = arquivos.filter((a) => CAMINHOS_RISCO.test(a));
  if (risco) motivos.push(`${risco} sinal(is) de domínio crítico`);
  if (caminhosRisco.length) motivos.push(`${caminhosRisco.length} arquivo(s) em área crítica`);
  if (arquivos.length > 8) motivos.push(`${arquivos.length} arquivos afetados`);

  let nivel = 'medio';
  if (risco >= 2 || caminhosRisco.length || arquivos.length > 8) nivel = 'alto';
  else if (risco === 0 && mecanico > 0 && arquivos.length <= 3) nivel = 'baixo';

  const front = contarSinais(t, SINAIS_FRONT);
  const back = contarSinais(t, SINAIS_BACK);
  let natureza = 'geral';
  if (nivel === 'baixo') natureza = 'mecanica';
  else if (front > back) natureza = 'frontend';
  else if (back > front) natureza = 'backend';

  // Cada papel é um agente Kiro com modelo próprio: o despachante (barato) delega ao executor certo.
  const papel = nivel === 'baixo' ? 'executor-rapido' : nivel === 'alto' ? 'executor-critico' : 'executor';
  return { risco: nivel, natureza, papel, motivos };
}

/** Resolve agente/modelo/esforço de um papel (escalonar/rebaixar são opcionais por política). */
export function resolverModelo(modelos, papel, risco = 'medio') {
  const cfg = modelos.papeis[papel];
  if (!cfg) return null;
  const agente = `bp-${papel}`;
  if (risco === 'alto' && cfg.escalonar) return { papel, agente, modelo: cfg.escalonar.modelo ?? cfg.modelo, esforco: cfg.escalonar.esforco ?? cfg.esforco, escalonado: true };
  if (risco === 'baixo' && cfg.rebaixar) return { papel, agente, modelo: cfg.rebaixar.modelo ?? cfg.modelo, esforco: cfg.rebaixar.esforco ?? cfg.esforco, rebaixado: true };
  return { papel, agente, modelo: cfg.modelo, esforco: cfg.esforco };
}
