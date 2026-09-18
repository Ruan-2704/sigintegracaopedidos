const pool = require('./db');

let tabelaGarantida = false;

async function garantirTabelaServicosLogs() {
  if (tabelaGarantida) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS servico_logs (
      id INT NOT NULL AUTO_INCREMENT,
      servico VARCHAR(40) NOT NULL,
      nome_servico VARCHAR(120) DEFAULT NULL,
      tipo VARCHAR(80) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'INFO',
      mensagem TEXT,
      detalhe MEDIUMTEXT,
      origem VARCHAR(80) DEFAULT NULL,
      pid VARCHAR(160) DEFAULT NULL,
      arquivo_log VARCHAR(500) DEFAULT NULL,
      usuario VARCHAR(80) DEFAULT NULL,
      ip VARCHAR(80) DEFAULT NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_servico_logs_criado_em (criado_em),
      KEY idx_servico_logs_servico_criado (servico, criado_em),
      KEY idx_servico_logs_status_criado (status, criado_em),
      KEY idx_servico_logs_tipo_criado (tipo, criado_em)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  tabelaGarantida = true;
}

function serializarDetalhe(detalhe) {
  if (detalhe === undefined || detalhe === null || detalhe === '') return null;

  if (typeof detalhe === 'string') {
    return detalhe.slice(0, 8000);
  }

  try {
    return JSON.stringify(detalhe).slice(0, 8000);
  } catch {
    return String(detalhe).slice(0, 8000);
  }
}

function normalizarStatus(status) {
  const texto = String(status || 'INFO').trim().toUpperCase();
  if (['SUCESSO', 'ERRO', 'ALERTA', 'INFO'].includes(texto)) return texto;
  return 'INFO';
}

function normalizarData(value, endOfDay = false) {
  const texto = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  return `${texto} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

const RUIDOS_OPERACIONAIS = [
  'pthread_create failed',
  'unable to create native thread',
  'failed to start the native thread',
  'failed to start thread "unknown thread"',
  'failed to start bean',
  'webserverstartstop',
  'application run failed',
  'exception encountered during context initialization - cancelling refresh attempt',
  'invocation of close method failed on bean with name',
  'possibly out of memory or process/resource limits reached',
];

function aplicarFiltroRuidoOperacional(where, params) {
  for (const ruido of RUIDOS_OPERACIONAIS) {
    where.push('(LOWER(COALESCE(mensagem, "")) NOT LIKE ? AND LOWER(COALESCE(detalhe, "")) NOT LIKE ?)');
    const like = `%${ruido}%`;
    params.push(like, like);
  }
}

async function registrarServicoLog({
  req,
  servico,
  nomeServico,
  tipo,
  status = 'INFO',
  mensagem,
  detalhe,
  origem,
  pid,
  arquivoLog,
  usuario,
}) {
  await garantirTabelaServicosLogs();

  const [result] = await pool.query(
    `INSERT INTO servico_logs
      (servico, nome_servico, tipo, status, mensagem, detalhe, origem, pid, arquivo_log, usuario, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      servico,
      nomeServico || null,
      tipo || 'EVENTO',
      normalizarStatus(status),
      mensagem || '',
      serializarDetalhe(detalhe),
      origem || null,
      Array.isArray(pid) ? pid.join(', ') : (pid || null),
      arquivoLog || null,
      usuario || req?.usuario?.usuario || req?.usuario?.sub || 'admin',
      req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null,
    ]
  );

  return result.insertId;
}

async function listarServicosLogs({
  page = 1,
  limit = 50,
  servico,
  tipo,
  status,
  search,
  dataInicio,
  dataFim,
} = {}) {
  await garantirTabelaServicosLogs();

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const offset = (safePage - 1) * safeLimit;
  const where = [];
  const params = [];

  if (servico) {
    where.push('servico = ?');
    params.push(servico);
  }

  if (tipo) {
    where.push('tipo = ?');
    params.push(tipo);
  }

  if (status) {
    where.push('status = ?');
    params.push(String(status).toUpperCase());
  }

  const inicio = normalizarData(dataInicio);
  const fim = normalizarData(dataFim, true);

  if (inicio) {
    where.push('criado_em >= ?');
    params.push(inicio);
  }

  if (fim) {
    where.push('criado_em <= ?');
    params.push(fim);
  }

  aplicarFiltroRuidoOperacional(where, params);

  const termo = String(search || '').trim();
  if (termo) {
    where.push(`(
      servico LIKE ? OR nome_servico LIKE ? OR tipo LIKE ? OR status LIKE ? OR
      mensagem LIKE ? OR detalhe LIKE ? OR origem LIKE ? OR pid LIKE ? OR arquivo_log LIKE ? OR usuario LIKE ?
    )`);
    const like = `%${termo}%`;
    params.push(like, like, like, like, like, like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM servico_logs ${whereSql}`, params);
  const total = Number(countRows?.[0]?.total || 0);

  const [rows] = await pool.query(
    `
      SELECT id, servico, nome_servico, tipo, status, mensagem, detalhe, origem, pid, arquivo_log, usuario, criado_em
      FROM servico_logs
      ${whereSql}
      ORDER BY criado_em DESC, id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, safeLimit, offset]
  );

  return {
    rows,
    meta: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

module.exports = {
  garantirTabelaServicosLogs,
  registrarServicoLog,
  listarServicosLogs,
};
