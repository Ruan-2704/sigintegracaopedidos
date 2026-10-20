const pool = require('./db');

let tabelaGarantida = false;

async function garantirTabelaAcoesPainel() {
  if (tabelaGarantida) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS painel_acoes (
      id INT NOT NULL AUTO_INCREMENT,
      usuario VARCHAR(80) NOT NULL DEFAULT 'admin',
      acao VARCHAR(80) NOT NULL,
      alvo VARCHAR(120) DEFAULT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'SUCESSO',
      mensagem TEXT,
      detalhe MEDIUMTEXT,
      ip VARCHAR(80) DEFAULT NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_painel_acoes_criado_em (criado_em),
      KEY idx_painel_acoes_acao (acao),
      KEY idx_painel_acoes_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  tabelaGarantida = true;
}

function serializarDetalhe(detalhe) {
  if (detalhe === undefined || detalhe === null || detalhe === '') return null;

  if (typeof detalhe === 'string') {
    return detalhe.slice(0, 5000);
  }

  try {
    return JSON.stringify(detalhe).slice(0, 5000);
  } catch {
    return String(detalhe).slice(0, 5000);
  }
}

async function registrarAcaoPainel({ req, usuario, acao, alvo, status = 'SUCESSO', mensagem, detalhe }) {
  await garantirTabelaAcoesPainel();

  const [result] = await pool.query(
    `INSERT INTO painel_acoes
      (usuario, acao, alvo, status, mensagem, detalhe, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      usuario || req?.usuario?.usuario || req?.usuario?.sub || 'admin',
      acao || 'ACAO',
      alvo || null,
      status,
      mensagem || '',
      serializarDetalhe(detalhe),
      req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null,
    ]
  );

  return result.insertId;
}

function filtrosAcoesPainel(acao, status) {
  const where = [], params = [];
  for (const [coluna, valor, maximo] of [['acao', acao, 30], ['status', status, 10]]) {
    const valores = String(valor || '').split(',').map(item => item.trim()).filter(Boolean).slice(0, maximo);
    if (valores.length) {
      where.push(coluna + ' IN (' + valores.map(() => '?').join(',') + ')');
      params.push(...valores);
    }
  }
  return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

async function listarAcoesPainelPaginadas({ page = 1, limit = 50, acao, status } = {}) {
  await garantirTabelaAcoesPainel();
  const numeroLimite = Number(limit);
  const tamanho = Number.isFinite(numeroLimite) ? Math.min(Math.max(Math.floor(numeroLimite) || 50, 1), 200) : 50;
  const { whereSql, params } = filtrosAcoesPainel(acao, status);
  const [contagem] = await pool.query('SELECT COUNT(*) AS total FROM painel_acoes ' + whereSql, params);
  const total = Number(contagem[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / tamanho));
  const numeroPagina = Number(page);
  const pagina = Math.min(Math.max(Number.isFinite(numeroPagina) ? Math.floor(numeroPagina) : 1, 1), totalPages);
  const [rows] = await pool.query(
    'SELECT id, usuario, acao, alvo, status, mensagem, detalhe, ip, criado_em ' +
    'FROM painel_acoes ' + whereSql + ' ORDER BY criado_em DESC, id DESC LIMIT ? OFFSET ?',
    [...params, tamanho, (pagina - 1) * tamanho]
  );
  return { rows, meta: { page: pagina, limit: tamanho, total, totalPages } };
}

async function listarAcoesPainel(options) {
  return (await listarAcoesPainelPaginadas(options)).rows;
}

module.exports = { garantirTabelaAcoesPainel, registrarAcaoPainel, listarAcoesPainel, listarAcoesPainelPaginadas };
