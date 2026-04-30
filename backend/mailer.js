const nodemailer = require('nodemailer');

let transporter;

function stripHtml(value = '') {
  return String(value || '').replace(/<[^>]+>/g, '');
}

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SIGPHARMA_EMAIL_HOST || process.env.SMTP_HOST;
  const port = Number(process.env.SIGPHARMA_EMAIL_PORT || process.env.SMTP_PORT || 465);
  const user = process.env.SIGPHARMA_EMAIL_USER || process.env.SMTP_USER;
  const pass =
    process.env.SIGPHARMA_EMAIL_PASSWORD ||
    process.env.SMTP_PASSWORD ||
    process.env.SMTP_PASS;

  if (!host) throw new Error('SMTP não configurado: informe SIGPHARMA_EMAIL_HOST');
  if (!user) throw new Error('SMTP não configurado: informe SIGPHARMA_EMAIL_USER');
  if (!pass) throw new Error('SMTP não configurado: informe SIGPHARMA_EMAIL_PASSWORD');

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  return transporter;
}

async function enviarEmailAlerta({ assunto, texto, html }) {
  const to = process.env.ALERT_EMAIL_TO || 'suporte@solucoessig.com.br';

  const from =
    process.env.SIGPHARMA_EMAIL_FROM ||
    process.env.ALERT_EMAIL_FROM ||
    process.env.SMTP_FROM;

  if (!from) {
    throw new Error('SMTP não configurado: informe SIGPHARMA_EMAIL_FROM com remetente autorizado.');
  }

  return getTransporter().sendMail({
    from: `"SIG Cotação - Soluções SIG" <${from}>`,
    to,
    subject: assunto,
    text: texto || stripHtml(html),
    html: html || undefined,
  });
}

module.exports = { enviarEmailAlerta };