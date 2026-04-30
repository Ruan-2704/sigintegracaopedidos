const path = require('path');
const { spawn, exec } = require('child_process');
const { runSshCommand } = require('./sshClient');

function isSshMode() {
  return String(process.env.EXECUTION_MODE || 'local').toLowerCase() === 'ssh';
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function workdirFor(target = 'files') {
  return target === 'pedidos'
    ? process.env.SSH_PEDIDOS_WORKDIR || process.env.SIGCOTEFACIL_FOLDER
    : process.env.SSH_FILES_WORKDIR || process.env.SIGCOTEFACIL_FOLDER;
}

async function executarScript(scriptName) {
  if (isSshMode()) {
    const workdir = workdirFor('files');

    const command = [
      `cd ${shellEscape(workdir)}`,
      `chmod +x ${shellEscape(scriptName)}`,
      `nohup ./${scriptName} > runtime-${scriptName}.log 2>&1 & echo $!`,
    ].join(' && ');

    const result = await runSshCommand(command, 'files');

    if (result.code !== 0) {
      throw new Error(result.stderr || 'Erro ao executar script via SSH');
    }

    return {
      mode: 'ssh',
      servidor: process.env.SSH_FILES_HOST,
      pid: String(result.stdout || '').trim(),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const folder = process.env.SIGCOTEFACIL_FOLDER;
  const scriptPath = path.join(folder, scriptName);

  const child = spawn(scriptPath, [], {
    cwd: folder,
    shell: true,
    detached: false,
  });

  return {
    mode: 'local',
    pid: child.pid,
  };
}

async function executarComando(command, target = 'files') {
  if (isSshMode()) {
    const result = await runSshCommand(command, target);

    if (result.code !== 0) {
      throw new Error(result.stderr || 'Erro ao executar comando via SSH');
    }

    return result.stdout;
  }

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message));
      }

      resolve(stdout);
    });
  });
}

async function lerCrontab() {
  if (isSshMode()) {
    const result = await runSshCommand('crontab -l 2>/dev/null || true', 'files');

    return {
      content: result.stdout || '',
      crontab: result.stdout || '',
      writable: process.env.ALLOW_CRON_WRITE === 'true',
      escritaLiberada: process.env.ALLOW_CRON_WRITE === 'true',
      servidor: process.env.SSH_FILES_HOST,
    };
  }

  const stdout = await executarComando('crontab -l 2>/dev/null || true');

  return {
    content: stdout || '',
    crontab: stdout || '',
    writable: process.env.ALLOW_CRON_WRITE === 'true',
    escritaLiberada: process.env.ALLOW_CRON_WRITE === 'true',
  };
}

async function salvarCrontab(content) {
  if (process.env.ALLOW_CRON_WRITE !== 'true') {
    throw new Error('Edição de crontab bloqueada');
  }

  const safeContent = Buffer.from(content || '', 'utf8').toString('base64');

  if (isSshMode()) {
    const command = [
      `echo ${shellEscape(safeContent)} | base64 -d > /tmp/sig_integracao_cron_tmp`,
      `crontab /tmp/sig_integracao_cron_tmp`,
      `rm -f /tmp/sig_integracao_cron_tmp`,
    ].join(' && ');

    const result = await runSshCommand(command, 'files');

    if (result.code !== 0) {
      throw new Error(result.stderr || 'Erro ao salvar crontab via SSH');
    }

    return true;
  }

  await executarComando(
    `echo ${safeContent} | base64 -d > /tmp/sig_integracao_cron_tmp && crontab /tmp/sig_integracao_cron_tmp && rm -f /tmp/sig_integracao_cron_tmp`
  );

  return true;
}

async function listarPidsPorPorta(port, target = 'files') {
  const stdout = await executarComando(`lsof -ti:${port} 2>/dev/null || true`, target);

  return String(stdout || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

async function matarPidsPorPorta(port, target = 'files') {
  const pids = await listarPidsPorPorta(port, target);

  for (const pid of pids) {
    await executarComando(`kill -9 ${pid}`, target);
  }

  return pids;
}

async function lerLogRemoto(scriptName, linhas = 300, target = 'files') {
  const workdir = workdirFor(target);
  const n = Math.max(Number(linhas) || 300, 50);

  if (isSshMode()) {
    let command;

    if (target === 'pedidos') {
      command = [
        `cd ${shellEscape(workdir)}`,
        `if [ -f runtime-${scriptName}.log ]; then tail -n ${n} runtime-${scriptName}.log;`,
        `elif [ -f nohup.out ]; then tail -n ${n} nohup.out;`,
        `elif screen -ls | grep -q .; then screen -ls;`,
        `else ps aux | grep ${shellEscape(scriptName)} | grep -v grep || echo 'API de pedidos sem log localizado. Processo pode estar fora do nohup/pm2/screen.'; fi`,
      ].join(' ');
    } else {
      const logFile = `runtime-${scriptName}.log`;

      command = `cd ${shellEscape(workdir)} && tail -n ${n} ${shellEscape(logFile)} 2>/dev/null || true`;
    }

    const result = await runSshCommand(command, target);

    return result.stdout || result.stderr || '';
  }

  const stdout = await executarComando(
    `tail -n ${n} ${path.join(workdir, `runtime-${scriptName}.log`)} 2>/dev/null || true`
  );

  return stdout || '';
}

module.exports = {
  executarScript,
  executarComando,
  lerCrontab,
  salvarCrontab,
  listarPidsPorPorta,
  matarPidsPorPorta,
  lerLogRemoto,
  isSshMode,
};