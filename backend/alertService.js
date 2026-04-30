const pool = require('./db');
const { enviarEmailAlerta } = require('./mailer');

let tabelaGarantida = false;

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function garantirTabelaAlertas() {
  if (tabelaGarantida) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alertas_integracao (
      id INT NOT NULL AUTO_INCREMENT,
      servico VARCHAR(80) NOT NULL,
      tipo VARCHAR(80) NOT NULL,
      severidade VARCHAR(30) DEFAULT 'ALERTA',
      mensagem TEXT,
      detalhe MEDIUMTEXT,
      servidor VARCHAR(120) DEFAULT NULL,
      porta INT DEFAULT NULL,
      enviado_email TINYINT(1) NOT NULL DEFAULT 0,
      email_destino VARCHAR(255) DEFAULT NULL,
      erro_email TEXT DEFAULT NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_alertas_integracao_criado_em (criado_em),
      KEY idx_alertas_integracao_servico_tipo (servico, tipo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  tabelaGarantida = true;
}

async function registrarAlerta({ servico, tipo, severidade = 'ALERTA', mensagem, detalhe, servidor, porta, enviadoEmail = false, erroEmail = null }) {
  await garantirTabelaAlertas();
  const [result] = await pool.query(
    `INSERT INTO alertas_integracao
      (servico, tipo, severidade, mensagem, detalhe, servidor, porta, enviado_email, email_destino, erro_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      servico || 'desconhecido',
      tipo || 'geral',
      severidade,
      mensagem || '',
      detalhe || null,
      servidor || null,
      porta || null,
      enviadoEmail ? 1 : 0,
      process.env.ALERT_EMAIL_TO || 'suporte@solucoessig.com.br',
      erroEmail,
    ]
  );
  return result.insertId;
}

async function enviarAlertaOperacional({ servico, tipo, severidade = 'ALERTA', mensagem, detalhe, servidor, porta, assunto, html }) {
  const alerta = { servico, tipo, severidade, mensagem, detalhe, servidor, porta };
  if (String(process.env.ALERT_EMAIL_ENABLED || 'true').toLowerCase() !== 'true') {
    return registrarAlerta({ ...alerta, enviadoEmail: false, erroEmail: 'Envio de e-mail desabilitado no .env' });
  }
  try {
    await enviarEmailAlerta({
      assunto: assunto || `[SIG Cotação] ${tipo} - ${servico}`,
      texto: mensagem,
      html: html || `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <h2>SIG Cotação - ${escapeHtml(tipo)}</h2>
          <p><b>Serviço:</b> ${escapeHtml(servico)}</p>
          <p><b>Servidor:</b> ${escapeHtml(servidor || '-')}</p>
          <p><b>Porta:</b> ${escapeHtml(porta || '-')}</p>
          <p><b>Mensagem:</b> ${escapeHtml(mensagem || '')}</p>
          ${detalhe ? `<pre style="background:#f4f4f4;padding:12px;border-radius:8px;white-space:pre-wrap">${escapeHtml(String(detalhe).slice(-2500))}</pre>` : ''}
          <p><b>Data/Hora:</b> ${new Date().toLocaleString('pt-BR')}</p>
        </div>
      `,
    });
    return registrarAlerta({ ...alerta, enviadoEmail: true });
  } catch (error) {
    return registrarAlerta({ ...alerta, enviadoEmail: false, erroEmail: error.message });
  }
}

async function listarAlertas({ limit = 50 } = {}) {
  await garantirTabelaAlertas();
  const [rows] = await pool.query(
    `SELECT * FROM alertas_integracao ORDER BY criado_em DESC LIMIT ?`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return rows;
}

module.exports = { garantirTabelaAlertas, registrarAlerta, enviarAlertaOperacional, listarAlertas };
