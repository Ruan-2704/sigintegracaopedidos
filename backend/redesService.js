// Configuracao da integracao; o cadastro mestre e as views pertencem a outros sistemas.
const TABELA = 'integracaopedidos.redes_integracao';
const REFERENCIAS = ['farmacias', 'operacoes_logisticas', 'farmacias_opl', 'fornecedores',
  'fornecedores_participa_operacao_logistica', 'medicamentos', 'medicamentos_opl'];
const GERACAO = [...REFERENCIAS, 'representantes', 'fabricante'];
function falha(message, status = 400) { return Object.assign(new Error(message), { status }); }
function codigoValido(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw falha('Código de rede inválido.');
  return n;
}
function schemaValido(schema) { return /^[a-z][a-z0-9_]*$/.test(String(schema || '')); }
function criarRedesService(pool) {
  async function catalogo() {
    const [rows] = await pool.query(`SELECT CODIGO AS codigo, NOME AS nome,
      BANCO_DADOS_NOME AS schemaNome, ATIVO AS cadastroAtivo FROM gestao.redes ORDER BY NOME, CODIGO`);
    return rows.map(r => ({ ...r, codigo: Number(r.codigo), cadastroAtivo: Number(r.cadastroAtivo) === 1 }));
  }
  async function listar() {
    const redes = await catalogo();
    let configuracoes;
    try { [configuracoes] = await pool.query(`SELECT codigo_rede, geracao, validador, versao, atualizado_em FROM ${TABELA}`); }
    catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
      return { redes: [], catalogo: redes, configuracaoDisponivel: false,
        aviso: 'Cadastro disponível para consulta. A configuração da integração ainda precisa ser instalada no banco.' };
    }
    const map = new Map(redes.map(r => [r.codigo, r]));
    return { configuracaoDisponivel: true, catalogo: redes, redes: configuracoes.map(c => ({
      ...(map.get(Number(c.codigo_rede)) || { codigo: Number(c.codigo_rede), nome: 'Cadastro mestre não encontrado', schemaNome: '', cadastroAtivo: false }),
      geracao: Number(c.geracao) === 1, validador: Number(c.validador) === 1,
      versao: Number(c.versao), atualizadoEm: c.atualizado_em
    })).sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR')) };
  }
  async function validar(codigo) {
    codigo = codigoValido(codigo);
    const rede = (await catalogo()).find(r => r.codigo === codigo);
    if (!rede) throw falha('Rede não encontrada no cadastro mestre.', 404);
    const pendencias = [];
    if (!rede.cadastroAtivo) pendencias.push('Cadastro mestre inativo.');
    if (!schemaValido(rede.schemaNome)) {
      return { rede, geracao: false, validador: false, pendencias: [...pendencias, 'Nome da base inválido ou ausente.'] };
    }
    const [tables] = await pool.query(`SELECT TABLE_NAME AS nome FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`, [rede.schemaNome]);
    const existentes = new Set(tables.map(t => t.nome));
    const faltantes = GERACAO.filter(t => !existentes.has(t));
    const faltaValidador = REFERENCIAS.filter(t => !existentes.has(t));
    if (faltantes.length) pendencias.push('Tabelas ausentes: ' + faltantes.join(', ') + '.');
    // Leitura da definicao: uma rede sem campanhas tambem pode estar corretamente incluida.
    const [views] = await pool.query(`SELECT VIEW_DEFINITION AS definicao FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = 'integracaopedidos' AND TABLE_NAME = 'vw_farmacias_operacoeslogistica_integra'`);
    const definicao = String(views[0]?.definicao || '').replace(/\x60/g, '').toLowerCase();
    const incluiBase = new RegExp('(^|[^a-z0-9_])' + rede.schemaNome + '\\.operacoes_logisticas([^a-z0-9_]|$)').test(definicao);
    if (!incluiBase) pendencias.push('Inclusão da base na view de campanhas não confirmada. Verifique na aplicação responsável pelas views.');
    return { rede, geracao: rede.cadastroAtivo && !faltantes.length && incluiBase,
      validador: rede.cadastroAtivo && !faltaValidador.length, pendencias,
      observacao: 'Valida a estrutura. Produtos, fornecedores e demais dados são verificados por campanha. Não gera nem reprocessa arquivos.' };
  }
  async function salvar(body) {
    const codigo = codigoValido(body.codigo);
    if (typeof body.geracao !== 'boolean' || typeof body.validador !== 'boolean') throw falha('Informe as opções de geração e validador.');
    const versao = Number(body.versao);
    if (!Number.isSafeInteger(versao) || versao < 0) throw falha('Versão da configuração inválida.');
    // Desabilitar deve continuar possivel mesmo se a base/view estiver indisponivel.
    const diagnostico = (body.geracao || body.validador) ? await validar(codigo) : null;
    if (versao === 0 && !(await catalogo()).some(r => r.codigo === codigo)) throw falha('Rede não encontrada no cadastro mestre.', 404);
    if ((body.geracao && !diagnostico.geracao) || (body.validador && !diagnostico.validador)) {
      throw falha('Não foi possível habilitar esta rede: ' + diagnostico.pendencias.join(' '));
    }
    // Schema e nome nunca sao recebidos do navegador: sempre vem de gestao.redes.
    if (versao === 0) {
      try { await pool.query(`INSERT INTO ${TABELA} (codigo_rede, geracao, validador) VALUES (?, ?, ?)`, [codigo, body.geracao, body.validador]); }
      catch (e) { if (e.code === 'ER_DUP_ENTRY') throw falha('Rede já cadastrada. Atualize a lista.', 409); throw e; }
    } else {
      const [result] = await pool.query(`UPDATE ${TABELA} SET geracao = ?, validador = ?, versao = versao + 1
        WHERE codigo_rede = ? AND versao = ?`, [body.geracao, body.validador, codigo, versao]);
      if (!result.affectedRows) throw falha('Configuração alterada por outra sessão. Atualize a lista antes de salvar.', 409);
    }
    return { codigo, geracao: body.geracao, validador: body.validador };
  }
  async function redesValidador() {
    const [rows] = await pool.query(`SELECT r.BANCO_DADOS_NOME AS schemaNome, r.NOME AS nome
      FROM ${TABELA} c JOIN gestao.redes r ON r.CODIGO = c.codigo_rede
      WHERE c.validador = 1 AND r.ATIVO = 1`);
    if (rows.some(r => !schemaValido(r.schemaNome))) throw falha('Base inválida no cadastro mestre.', 503);
    return rows;
  }
  return { listar, validar, salvar, redesValidador };
}
module.exports = { criarRedesService, codigoValido, schemaValido, REFERENCIAS, GERACAO };
