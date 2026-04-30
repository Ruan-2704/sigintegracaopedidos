const { listarPidsPorPorta, lerLogRemoto } = require('./remoteExecution');
const { enviarAlertaOperacional } = require('./alertService');

const estado = new Map();
const cooldown = new Map();
const erroLogAtual = new Map();

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
  'pid finalizado inesperadamente'
];

const PALAVRAS_IGNORAR = [
  'script finalizado com sucesso', 'finalizado com sucesso', 'processo finalizado',
  'porta 8080 está livre', 'porta 8081 está livre', 'nenhum arquivo para gerar',
  'nenhum arquivo para excluir', 'nenhum arquivo encontrado', 'não há arquivos',
  'nao ha arquivos', 'sem arquivos', 'sem erro', 'nenhum erro', '0 erros',
  'fila vazia', 'nenhum item na fila', 'não gerou nenhum arquivo', 'nao gerou nenhum arquivo'
];

function alvoServico(chave) {
  return chave === 'pedidos' ? 'pedidos' : 'files';
}

function hostServico(chave) {
  return chave === 'pedidos' ? process.env.SSH_PEDIDOS_HOST : process.env.SSH_FILES_HOST;
}

function deveNotificar(codigo, min = Number(process.env.ALERT_COOLDOWN_MINUTES || 15)) {
  const last = cooldown.get(codigo) || 0;
  if (Date.now() - last < min * 60 * 1000) return false;
  cooldown.set(codigo, Date.now());
  return true;
}

function detectarErroLog(log = '') {
  const lower = String(log || '').toLowerCase();
  if (!lower.trim()) return false;
  if (PALAVRAS_IGNORAR.some((p) => lower.includes(p))) return false;
  return PALAVRAS_ERRO.some((p) => lower.includes(p));
}

async function notificarServico(chave, servico, tipo, mensagem, detalhe) {
  const codigoCooldown = `${chave}:${tipo}`;
  if (!deveNotificar(codigoCooldown)) return;
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
  if (!scriptOuJar) return;
  const log = await lerLogRemoto(scriptOuJar, Number(process.env.MONITOR_LOG_LINES || 120), alvoServico(chave));
  const erroDetectado = detectarErroLog(log);
  
  const anterior = erroLogAtual.get(chave);
  if (erroDetectado && anterior !== true) {
    await notificarServico(chave, servico, 'ERRO_LOG', `Erro identificado no log do serviço ${servico.nome}.`, String(log || '').slice(-2500));
  }
  erroLogAtual.set(chave, erroDetectado);
}

async function checarServicos(SERVICOS) {
  for (const [chave, servico] of Object.entries(SERVICOS)) {
    try {
      const pids = await listarPidsPorPorta(servico.porta, alvoServico(chave));
      const online = pids.length > 0;
      const anterior = estado.get(chave);
      const erroDetectado = detectarErroLog(log);

if (erroDetectado) {
  await notificarServico(
    chave,
    servico,
    'ERRO_LOG',
    `Erro identificado no log do serviço ${servico.nome}.`,
    String(log || '').slice(-2500)
  );
}
      estado.set(chave, { online, pids, erro: null, updatedAt: Date.now() });
      if (online || chave !== 'pedidos') await checarLogServico(chave, servico);
    } catch (error) {
      const anterior = estado.get(chave);
      if (anterior?.online === true || chave === 'pedidos') {
        await notificarServico(chave, servico, 'FALHA_MONITORAMENTO', `Falha ao monitorar serviço: ${error.message}`);
      }
      estado.set(chave, { online: false, pids: [], erro: error.message, updatedAt: Date.now() });
    }
  }
}

function iniciarMonitoramento(SERVICOS) {
  const enabled = String(process.env.SERVICE_MONITOR_ENABLED || 'true').toLowerCase() === 'true';
  if (!enabled) return;
  const intervalMs = Number(process.env.SERVICE_MONITOR_INTERVAL_SECONDS || 60) * 1000;
  setTimeout(() => checarServicos(SERVICOS).catch((e) => console.error('Monitoramento inicial falhou:', e.message)), 5000);
  setInterval(() => checarServicos(SERVICOS).catch((e) => console.error('Monitoramento falhou:', e.message)), intervalMs);
}

module.exports = { iniciarMonitoramento, detectarErroLog };
