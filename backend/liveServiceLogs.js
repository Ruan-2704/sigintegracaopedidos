const { StringDecoder } = require('string_decoder');
const { spawn } = require('child_process');
const { streamSshCommand } = require('./sshClient');
const { executarComando, listarCandidatosLog, isSshMode, isWindowsLocalMode } = require('./remoteExecution');
const { estado } = require('./pedidosSystemd');
const sources = new Map();
const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";

function open(command, target, handlers) {
  if (isSshMode()) return streamSshCommand(command, target, handlers);
  if (isWindowsLocalMode()) throw new Error('Configure o alvo SSH para acompanhar o terminal do servidor.');
  const child = spawn('bash', ['-lc', command]);
  child.stdout.on('data', handlers.data);
  child.stderr.on('data', handlers.stderr);
  child.on('error', handlers.error);
  child.on('close', handlers.end);
  return { close() { child.kill('SIGTERM'); } };
}

async function setup(source, servico) {
  const target = source.key === 'pedidos' ? 'pedidos' : 'files';
  let command;
  if (source.key === 'pedidos') {
    const props = await estado();
    source.invocation = props.InvocationID || '';
    const jar = (props.ExecStart || '').match(/-jar\s+([^ ;}]+)/);
    let resolved = jar ? jar[1] : '';
    if (resolved) resolved = String(await executarComando('readlink -f ' + quote(resolved), target)).trim();
    source.meta = { origem: 'Terminal do servidor', logSource: 'systemd-journal',
      logPath: 'journal:sigcotacao.service', pid: props.MainPID === '0' ? null : props.MainPID,
      versao: (resolved.match(/envia-cotacao-(.+)\.jar$/) || [])[1] || null,
      inicio: props.ExecMainStartTimestamp || null, invocationId: source.invocation };
    command = 'journalctl --quiet --no-pager -u sigcotacao.service -n 300 -f -o json --all';
  } else {
    const candidatos = await listarCandidatosLog(servico.script, target);
    const paths = candidatos.map(c => 'if [ -f ' + quote(c.path) + ' ]; then printf "%s\\n" ' + quote(c.path) + '; exit 0; fi').join('\n');
    const path = String(await executarComando(paths, target)).trim();
    if (!path) throw new Error('Ainda nao existe saida de execucao para este servico. Execute a rotina e reconecte.');
    source.meta = { origem: 'Saida da rotina no servidor', logSource: 'terminal-job', logPath: path };
    command = 'tail -n 300 -F -- ' + quote(path);
  }
  if (source.closed) return;
  source.ready = true;
  broadcast(source, { tipo: 'init', linhas: source.lines, meta: source.meta });
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let stderr = '';
  const failed = err => {
    if (source.closed || source.failed) return;
    source.failed = true;
    broadcast(source, { tipo: 'erro', mensagem: err.message });
    if (source.handle) source.handle.close();
    if (sources.get(source.key) === source) sources.delete(source.key);
  };
  source.handle = open(command, target, {
    data(chunk) {
      pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const lines = pending.split('\n'); pending = lines.pop();
      for (const raw of lines) {
        let line = raw.replace(/\r$/, '');
        if (source.key === 'pedidos') {
          let entry;
          try { entry = JSON.parse(line); } catch (_) { continue; }
          const invocation = entry._SYSTEMD_INVOCATION_ID;
          const timestamp = Number(entry.__REALTIME_TIMESTAMP || 0) / 1000;
          if (invocation !== source.invocation) {
            if (!invocation || timestamp < source.connectedAt) continue;
            source.invocation = invocation;
            source.lines = []; source.queue = [];
            source.meta.invocationId = invocation;
            source.meta.pid = entry._PID || null;
            source.meta.versao = null;
            source.meta.inicio = new Date(timestamp).toISOString();
            broadcast(source, { tipo: 'init', linhas: [], meta: source.meta });
          }
          line = typeof entry.MESSAGE === 'string' ? entry.MESSAGE : '';
          const version = line.match(/Starting CotacaoApplication v([^\s]+)/);
          if (version) source.meta.versao = version[1];
        } else if (line.includes('===== SIG_PANEL_START')) {
          source.lines = []; source.queue = [];
          source.meta.inicio = (line.match(/data=([^\s]+)/) || [])[1] || null;
          broadcast(source, { tipo: 'init', linhas: [], meta: source.meta });
        }
        source.queue.push(...line.split(/\r?\n/));
      }
    },
    stderr(data) { stderr = (stderr + data.toString()).slice(-2000); },
    error: failed,
    end(code) { failed(new Error(stderr || 'Conexao com o terminal encerrada' + (code ? ' (' + code + ')' : '') + '.')); }
  });
}
function broadcast(source, event) {
  const payload = Object.assign({}, event, { meta: Object.assign({}, source.meta, event.meta || {}, { atualizadoEm: new Date().toISOString() }) });
  source.listeners.forEach(listener => listener(payload));
}
function subscribe(key, servico, listener) {
  let source = sources.get(key);
  if (!source) {
    source = { key, lines: [], queue: [], listeners: new Set(), meta: {}, connectedAt: Date.now(), closed: false };
    sources.set(key, source);
    source.timer = setInterval(() => {
      if (!source.queue.length) return;
      const novasLinhas = source.queue.splice(0);
      source.lines = source.lines.concat(novasLinhas).slice(-1000);
      broadcast(source, { tipo: 'append', novasLinhas });
    }, 200);
    setup(source, servico).catch(err => {
      source.failed = true;
      broadcast(source, { tipo: 'erro', mensagem: err.message });
      if (sources.get(key) === source) sources.delete(key);
    });
  }
  source.listeners.add(listener);
  if (source.failed) listener({ tipo: 'erro', mensagem: 'Reconecte para acompanhar o terminal.' });
  else if (source.ready) listener({ tipo: 'init', linhas: source.lines.slice(), meta: source.meta });
  return () => {
    source.listeners.delete(listener);
    if (!source.listeners.size) {
      source.closed = true;
      clearInterval(source.timer);
      if (source.handle) source.handle.close();
      if (sources.get(key) === source) sources.delete(key);
    }
  };
}
module.exports = { subscribe };
