const assert = require('assert');
const { criarRedesService, GERACAO } = require('../redesService');
let passed = 0;
async function test(name, fn) { await fn(); console.log('OK ' + name); passed++; }
function fixture(options = {}) {
  const writes = [];
  const pool = { query: async (sql, params) => {
    if (sql.includes('FROM gestao.redes ORDER')) return [[{ codigo: 7, nome: 'Compre Certo', schemaNome: options.schema || 'redecomprecerto', cadastroAtivo: options.inativo ? 0 : 1 }]];
    if (sql.includes('information_schema.TABLES')) return [GERACAO.filter(t => t !== options.falta).map(nome => ({ nome }))];
    if (sql.includes('information_schema.VIEWS')) return [[{ definicao: options.semView ? null : 'select * from `redecomprecerto`.`operacoes_logisticas`' }]];
    if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) {
      writes.push({ sql, params });
      if (options.duplicada) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      return [{ affectedRows: options.conflito ? 0 : 1 }];
    }
    if (sql.includes('c JOIN gestao.redes')) return [[{ schemaNome: options.schema || 'redecomprecerto', nome: 'Compre Certo' }]];
    if (options.semTabela) throw Object.assign(new Error('missing'), { code: 'ER_NO_SUCH_TABLE' });
    return [[{ codigo_rede: 7, geracao: 1, validador: 0, versao: 2 }]];
  }};
  return { service: criarRedesService(pool), writes };
}
(async () => {
  await test('base nas views e tabelas completas habilita os dois usos', async () => {
    const d = await fixture().service.validar(7); assert(d.geracao && d.validador);
  });
  await test('view sem a base bloqueia geracao e preserva validador', async () => {
    const d = await fixture({ semView: true }).service.validar(7); assert(!d.geracao && d.validador);
  });
  await test('fabricante ausente bloqueia apenas geracao', async () => {
    const d = await fixture({ falta: 'fabricante' }).service.validar(7); assert(!d.geracao && d.validador);
  });
  await test('tabela comum ausente bloqueia ambos', async () => {
    const d = await fixture({ falta: 'medicamentos' }).service.validar(7); assert(!d.geracao && !d.validador);
  });
  await test('cadastro central inativo bloqueia ambos', async () => {
    const d = await fixture({ inativo: true }).service.validar(7); assert(!d.geracao && !d.validador);
  });
  await test('schema do navegador nao substitui o cadastro central', async () => {
    const { service, writes } = fixture(); await service.salvar({ codigo: 7, geracao: true, validador: false, versao: 0, schemaNome: 'malicioso' });
    assert.strictEqual(writes.length, 1); assert.deepStrictEqual(writes[0].params, [7, true, false]);
  });
  await test('schema inseguro no cadastro nao habilita integracao', async () => {
    const f = fixture({ schema: 'rede;DROP' });
    await assert.rejects(f.service.salvar({ codigo: 7, geracao: true, validador: false, versao: 0 }), /Não foi possível habilitar/);
    assert.strictEqual(f.writes.length, 0); await assert.rejects(f.service.redesValidador(), /Base inválida/);
  });
  await test('desabilitacao funciona com cadastro inativo e sem views', async () => {
    const f = fixture({ inativo: true, semView: true });
    await f.service.salvar({ codigo: 7, geracao: false, validador: false, versao: 2 }); assert.strictEqual(f.writes.length,1);
  });
  await test('edicao simultanea devolve conflito', async () => {
    await assert.rejects(fixture({ conflito: true }).service.salvar({ codigo: 7, geracao: false, validador: false, versao: 2 }), e => e.status === 409);
  });
  await test('inclusao duplicada devolve conflito', async () => {
    await assert.rejects(fixture({ duplicada: true }).service.salvar({ codigo: 7, geracao: true, validador: false, versao: 0 }), e => e.status === 409);
  });
  await test('tabela ainda nao instalada permite consultar catalogo sem criar tabelas', async () => {
    const f = fixture({ semTabela: true }); const d = await f.service.listar();
    assert.strictEqual(d.configuracaoDisponivel,false); assert.strictEqual(d.catalogo.length,1); assert.strictEqual(f.writes.length,0);
  });
  await test('opcoes obrigatorias e codigo desconhecido sao recusados', async () => {
    const f = fixture(); await assert.rejects(f.service.salvar({ codigo: 7, geracao: 'true', validador: false, versao: 0 }));
    await assert.rejects(f.service.salvar({ codigo: 999, geracao: false, validador: false, versao: 0 })); assert.strictEqual(f.writes.length,0);
  });
  console.log(`${passed} testes passaram; nenhum banco real foi alterado.`);
})().catch(e => { console.error(e); process.exitCode=1; });
