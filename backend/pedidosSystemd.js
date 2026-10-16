const { executarComando, isWindowsLocalMode } = require('./remoteExecution');

const UNIDADE = 'sigcotacao.service';

async function estado() {
  const stdout = await executarComando(
    'systemctl show --no-pager --property=LoadState,ActiveState,SubState,MainPID,InvocationID,ExecMainStartTimestamp,ExecStart ' + UNIDADE,
    'pedidos'
  );
  const props = {};
  String(stdout).split('\n').forEach(linha => {
    const indice = linha.indexOf('=');
    if (indice > 0) props[linha.slice(0, indice)] = linha.slice(indice + 1).trim();
  });
  if (props.LoadState !== 'loaded') throw new Error('Servico ' + UNIDADE + ' nao instalado ou nao carregado.');
  return props;
}

async function controlar(acao, contexto = {}) {
  if (!['start', 'stop'].includes(acao)) throw new Error('Acao systemd invalida.');
  if (isWindowsLocalMode()) throw new Error('Controle systemd requer servidor Linux configurado por SSH.');
  try {
    await executarComando('/usr/bin/sudo -n /usr/bin/systemctl ' + acao + ' ' + UNIDADE, 'pedidos');
  } catch (error) {
    throw new Error('Falha ao executar systemctl ' + acao + ' ' + UNIDADE +
      '. Confira a permissao sudo sem senha do usuario SSH para essa acao. Detalhe: ' + error.message);
  }
  const props = await estado();
  if (acao === 'start' && (props.ActiveState !== 'active' || !Number(props.MainPID))) {
    throw new Error('O servico nao permaneceu ativo apos iniciar. Consulte journalctl -u ' + UNIDADE + '.');
  }
  if (acao === 'stop' && (!['inactive', 'failed'].includes(props.ActiveState) || Number(props.MainPID))) {
    throw new Error('O systemd ainda nao confirmou a parada do servico.');
  }
  return {
    mode: 'systemd',
    unit: UNIDADE,
    pid: Number(props.MainPID) ? props.MainPID : null,
    status: props.ActiveState,
    executionId: contexto.executionId || null,
    iniciadoEm: contexto.iniciadoEm || null,
  };
}

module.exports = { controlar, estado };
