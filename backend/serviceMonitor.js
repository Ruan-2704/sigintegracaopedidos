const crypto = require('crypto');

const {
  listarPidsPorPorta,
  listarPidsPorNome,
  lerLogRemoto,
} = require('./remoteExecution');

const { enviarAlertaOperacional } = require('./alertService');

const estado = new Map();
const cooldown = new Map();
const ultimoErroLog = new Map();

const PALAVRAS_ERRO = [
  'exception',
  'timeout',
  'timed out',
  'nullpointer',
  'sqlexception',
  'connectexception',
  'connection refused',
  'unauthorized',
  'access denied',
  'failed',
  'fatal',
  'erro ao',
  'erro na',
  'erro no',
  'falha ao',
  'falha na',
  'falha no',
  'não gerou campanha',
  'nao gerou campanha',
  'campanha não gerada',
  'campanha nao gerada',
  'processo encerrado inesperadamente',
  'pid encerrado',
  'pid finalizado inesperadamente',
];

const PALAVRAS_IGNORAR = [
  'script finalizado com sucesso',
  'finalizado com sucesso',
  'processo finalizado',
  'nenhum arquivo para gerar',
  'nenhum arquivo para excluir',
  'nenhum arquivo encontrado',
  'não há arquivos',
  'nao ha arquivos',
  'sem arquivos',
  'sem erro',
  'nenhum erro',
  '0 erros',
  'fila vazia',
  'nenhum item na fila',
  'não gerou nenhum arquivo',
  'nao gerou nenhum arquivo',
    'invalid character found in method name',
  'http method names must be tokens',
  'invalid character found in the http protocol',
];

function alvoServico(chave) {
  return chave === 'pedidos' ? 'pedidos' : 'files';
}

function hostServico(chave) {
  return chave === 'pedidos' ? process.env.SSH_PEDIDOS_HOST : process.env.SSH_FILES_HOST;
}

function isServicoContinuo(chave) {
  return chave === 'pedidos';
}

function deveNotificar(codigo, min = Number(process.env.ALERT_COOLDOWN_MINUTES || 30)) {
  const last = cooldown.get(codigo) || 0;

  if (Date.now() - last < min * 60 * 1000) {
    return false;
  }

  cooldown.set(codigo, Date.now());
  return true;
}

function linhaIgnorada(linha) {
  const lower = String(linha || '').toLowerCase();
  return PALAVRAS_IGNORAR.some((p) => lower.includes(p));
}

function linhaComErro(linha) {
  const lower = String(linha || '').toLowerCase();
  return PALAVRAS_ERRO.some((p) => lower.includes(p));
}

function detectarErroLog(log = '') {
  const linhas = String(log || '')
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  if (!linhas.length) {
    return false;
  }

  return linhas.some((linha) => {
    if (linhaIgnorada(linha)) return false;
    return linhaComErro(linha);
  });
}

function extrairTrechoErro(log = '') {
  const linhas = String(log || '')
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  const linhasErro = linhas.filter((linha) => !linhaIgnorada(linha) && linhaComErro(linha));

  if (linhasErro.length) {
    return linhasErro.slice(-20).join('\n').slice(-2500);
  }

  return linhas.slice(-40).join('\n').slice(-2500);
}

function normalizarErroParaAssinatura(log = '') {
  const texto = String(log || '').toLowerCase();

  if (texto.includes('java.lang.indexoutofboundsexception')) {
    return 'java.lang.indexoutofboundsexception';
  }

  if (texto.includes('java.lang.nullpointerexception')) {
    return 'java.lang.nullpointerexception';
  }

  if (texto.includes('java.sql.sqlexception') || texto.includes('sqlexception')) {
    return 'java.sql.sqlexception';
  }

  if (texto.includes('connection refused')) {
    return 'connection refused';
  }

  if (texto.includes('connectexception')) {
    return 'connectexception';
  }

  if (texto.includes('timeout') || texto.includes('timed out')) {
    return 'timeout';
  }

  return extrairTrechoErro(log)
    .replace(/\d{4}-\d{2}-\d{2}t?\d{2}:\d{2}:\d{2}[^\s]*/gi, '')
    .replace(/\bnio-\d+-exec-\d+\b/gi, '')
    .replace(/\b\d+\b/g, '')
    .trim();
}

function gerarAssinaturaErro(log = '') {
  const base = normalizarErroParaAssinatura(log);
  return crypto.createHash('sha1').update(base).digest('hex');
}

async function notificarServico(chave, servico, tipo, mensagem, detalhe) {
  const codigoCooldown = `${chave}:${tipo}`;

  if (!deveNotificar(codigoCooldown)) {
    return;
  }

  await enviarAlertaOperacional({
    servico: servico.nome,
    tipo,
    severidade: tipo === 'ERRO_LOG' ? 'ERRO' : 'ALERTA',
    mensagem,
    detalhe,
    servidor: hostServico(chave),
    porta: servico.porta,
    assunto: `[SIG Cotação] ${tipo} - ${servico.nome}`,
  });
}

async function checarLogServico(chave, servico) {
  const scriptOuJar = servico.script || servico.jar;

  if (!scriptOuJar) {
    return;
  }

  const log = await lerLogRemoto(
    scriptOuJar,
    Number(process.env.MONITOR_LOG_LINES || 120),
    alvoServico(chave)
  );

  const erroDetectado = detectarErroLog(log);

  if (!erroDetectado) {
    ultimoErroLog.delete(chave);
    return;
  }

  const assinaturaAtual = gerarAssinaturaErro(log);
  const assinaturaAnterior = ultimoErroLog.get(chave);

  if (assinaturaAtual !== assinaturaAnterior) {
    ultimoErroLog.set(chave, assinaturaAtual);

    await notificarServico(
      chave,
      servico,
      'ERRO_LOG',
      `Erro identificado no log do serviço ${servico.nome}.`,
      extrairTrechoErro(log)
    );
  }
}

async function checarServicoContinuo(chave, servico) {
  const target = alvoServico(chave);

  const pidsPorta = await listarPidsPorPorta(servico.porta, target);
  const pidsProcesso = servico.jar ? await listarPidsPorNome(servico.jar, target) : [];

  const online = pidsPorta.length > 0 && pidsProcesso.length > 0;
  const anterior = estado.get(chave);

  if (!online && (!anterior || anterior.online === true)) {
    await notificarServico(
      chave,
      servico,
      'SERVICO_OFFLINE',
      `O serviço ${servico.nome} está offline ou o processo Java/JAR não foi encontrado.`,
      `Porta ${servico.porta}: ${pidsPorta.length ? pidsPorta.join(', ') : 'sem PID'}\nProcesso ${
        servico.jar || '-'
      }: ${pidsProcesso.length ? pidsProcesso.join(', ') : 'sem PID'}`
    );
  }

  estado.set(chave, {
    online,
    pids: {
      porta: pidsPorta,
      processo: pidsProcesso,
    },
    erro: null,
    updatedAt: Date.now(),
  });

  if (online) {
    await checarLogServico(chave, servico);
  }
}

async function checarJob(chave, servico) {
  await checarLogServico(chave, servico);

  estado.set(chave, {
    online: false,
    tipo: 'job',
    erro: null,
    updatedAt: Date.now(),
  });
}

async function checarServicos(SERVICOS) {
  for (const [chave, servico] of Object.entries(SERVICOS)) {
    try {
      if (isServicoContinuo(chave)) {
        await checarServicoContinuo(chave, servico);
      } else {
        await checarJob(chave, servico);
      }
    } catch (error) {
      console.error(`Falha interna ao monitorar ${chave}:`, error.message);

      estado.set(chave, {
        online: false,
        erro: error.message,
        updatedAt: Date.now(),
      });
    }
  }
}

function iniciarMonitoramento(SERVICOS) {
  const enabled = String(process.env.SERVICE_MONITOR_ENABLED || 'true').toLowerCase() === 'true';

  if (!enabled) {
    return;
  }

  const intervalMs = Number(process.env.SERVICE_MONITOR_INTERVAL_SECONDS || 60) * 1000;

  setTimeout(() => {
    checarServicos(SERVICOS).catch((error) => {
      console.error('Monitoramento inicial falhou:', error.message);
    });
  }, 5000);

  setInterval(() => {
    checarServicos(SERVICOS).catch((error) => {
      console.error('Monitoramento falhou:', error.message);
    });
  }, intervalMs);
}

module.exports = {
  iniciarMonitoramento,
  detectarErroLog,
};