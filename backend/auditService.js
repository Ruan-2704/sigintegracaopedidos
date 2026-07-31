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

async function listarAcoesPainel({ limit = 50, acao, status } = {}) {
  await garantirTabelaAcoesPainel();

  const where = [];
  const params = [];

  if (acao) {
    where.push('acao = ?');
    params.push(acao);
  }

  if (status) {
    where.push('status = ?');
    params.push(status);
  }

  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));

  const [rows] = await pool.query(
    `
      SELECT id, usuario, acao, alvo, status, mensagem, detalhe, ip, criado_em
      FROM painel_acoes
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY criado_em DESC
      LIMIT ?
    `,
    params
  );

  return rows;
}

module.exports = {
  garantirTabelaAcoesPainel,
  registrarAcaoPainel,
  listarAcoesPainel,
};
