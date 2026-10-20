const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const calls = [];
let total = 57;
const moduleMock = { exports: {} };
const pool = { query: async (sql, params = []) => {
  calls.push({ sql, params });
  if (sql.includes('COUNT(*)')) return [[{ total }]];
  if (sql.includes('SELECT id,')) {
    const limit = params[params.length - 2];
    const offset = params[params.length - 1];
    return [Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ id: offset + i + 1 }))];
  }
  return [[]];
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../auditService.js'), 'utf8'), {
  module: moduleMock, require: () => pool
});
(async () => {
  const api = moduleMock.exports;
  const page = await api.listarAcoesPainelPaginadas({ page: 2, limit: 25, acao: 'LOGIN_ACEITO,LOGIN_RECUSADO', status: 'ERRO' });
  assert.equal(page.meta.page, 2);
  assert.equal(page.meta.total, 57);
  assert.equal(page.meta.totalPages, 3);
  assert.equal(page.rows[0].id, 26);
  assert.equal(page.rows.length, 25);
  const query = calls[calls.length - 1];
  assert(query.sql.includes('ORDER BY criado_em DESC, id DESC LIMIT ? OFFSET ?'));
  assert.deepEqual(Array.from(query.params), ['LOGIN_ACEITO', 'LOGIN_RECUSADO', 'ERRO', 25, 25]);
  const count = calls.find(call => call.sql.includes('COUNT(*)'));
  assert.deepEqual(Array.from(count.params), ['LOGIN_ACEITO', 'LOGIN_RECUSADO', 'ERRO']);
  const last = await api.listarAcoesPainelPaginadas({ page: 999, limit: 25 });
  assert.equal(last.meta.page, 3);
  assert.equal(last.rows.length, 7);
  const invalid = await api.listarAcoesPainelPaginadas({ page: 'invalid', limit: Infinity });
  assert.equal(invalid.meta.page, 1);
  assert.equal(invalid.meta.limit, 50);
  total = 0;
  const empty = await api.listarAcoesPainelPaginadas({ page: 2 });
  assert.equal(empty.meta.page, 1);
  assert.equal(empty.meta.totalPages, 1);
  assert.equal(empty.rows.length, 0);
  assert(Array.isArray(await api.listarAcoesPainel()));
  console.log('OK: filtros parametrizados, contagem, pagina intermediaria, ultima pagina, limites invalidos e lista vazia.');
})().catch(error => { console.error(error); process.exitCode = 1; });
