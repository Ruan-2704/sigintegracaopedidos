const path = require('path');
const { spawn, exec } = require('child_process');
const { runSshCommand } = require('./sshClient');

function isSshMode() {
  return String(process.env.EXECUTION_MODE || 'local').toLowerCase() === 'ssh';
}

function isWindowsLocalMode() {
  return !isSshMode() && process.platform === 'win32';
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function limparTokenCron(value = '') {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

function extrairRedirecionamentoLog(linha = '') {
  const tokens = String(linha || '').match(/"[^"]+"|'[^']+'|\S+/g) || [];

  for (let i = 0; i < tokens.length; i++) {
    const token = limparTokenCron(tokens[i]);
    const proximo = limparTokenCron(tokens[i + 1]);
    const inline = token.match(/^(?:[12]?>?>|&>)(.+)$/);

    if (/^(?:[12]?>?>|&>)$/.test(token) && proximo && !proximo.startsWith('&')) {
      return proximo;
    }

    if (inline?.[1] && !inline[1].startsWith('&')) {
      return limparTokenCron(inline[1]);
    }
  }

  return null;
}

function linhaCronAtiva(linha = '') {
  const texto = String(linha || '').trim();
  return texto && !texto.startsWith('#');
}

function encontrarLogNoCrontab(crontab = '', scriptName = '') {
  const linhas = String(crontab || '')
    .split(/\r?\n/)
    .filter(linhaCronAtiva)
    .filter((linha) => linha.includes(scriptName));

  for (const linha of linhas.reverse()) {
    const logPath = extrairRedirecionamentoLog(linha);

    if (logPath && logPath !== '/dev/null') {
      return {
        linha,
        logPath,
      };
    }
  }

  return null;
}

function logEnvName(scriptName, target = 'files') {
  if (scriptName === (process.env.SCRIPT_GERACAO || 'executa_script.sh')) return 'LOG_GERACAO_FILE';
  if (scriptName === (process.env.SCRIPT_EXCLUSAO || 'executa_exclusao_script.sh')) return 'LOG_EXCLUSAO_FILE';
  if (target === 'pedidos' || scriptName === (process.env.JAR_PEDIDOS || 'envia-cotacao-0.0.3.jar')) return 'LOG_PEDIDOS_FILE';
  return null;
}

function normalizarLogPath(logPath, workdir) {
  const clean = limparTokenCron(logPath);
  if (!clean) return null;
  if (clean.startsWith('/')) return clean;
  return `${workdir}/${clean.replace(/^\.\//, '')}`;
}

function limparLinhaLog(linha = '') {
  return String(linha || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s*/, '')
    .replace(/^(INFO|WARN|WARNING|ERROR|DEBUG)\s*[:|-]?\s*/i, '')
    .trim();
}

function extrairDataLog(linha = '') {
  const texto = String(linha || '');
  const match = texto.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/);
  return match ? match[0].replace(' ', 'T').replace(',', '.') : null;
}

function extrairArquivoJson(texto = '') {
  const match = String(texto || '').match(/[A-Za-z0-9._/-]+\.json\b/i);
  return match ? match[0].split('/').pop() : null;
}

function extrairNumero(texto = '', termos = []) {
  for (const termo of termos) {
    const regex = new RegExp(`${termo}\\D{0,20}(\\d+)`, 'i');
    const match = String(texto || '').match(regex);
    if (match?.[1]) return match[1];
  }

  return null;
}

function classificarLinhaLog(linha = '', chave = '') {
  const mensagem = limparLinhaLog(linha);
  const lower = mensagem.toLowerCase();

  if (!mensagem || /^[-=_\s]+$/.test(mensagem)) return null;

  if (/(exception|erro|error|falha|failed|timeout|timed out|refused|unauthorized|nullpointer|sqlexception)/i.test(mensagem)) {
    return {
      tipo: 'ERRO',
      status: 'ERRO',
      mensagem: `Erro encontrado: ${mensagem}`,
      data: extrairDataLog(linha),
      linhaOriginal: linha,
    };
  }

  const arquivoJson = extrairArquivoJson(mensagem);

  if (arquivoJson && /(gerad|criad|salv|upload|bucket|enviad|arquivo)/i.test(mensagem)) {
    return {
      tipo: 'ARQUIVO',
      status: 'SUCESSO',
      mensagem: `Arquivo processado: ${arquivoJson}`,
      detalhe: mensagem,
      data: extrairDataLog(linha),
      linhaOriginal: linha,
    };
  }

  if (/(pedido|cotacao|cotação).*(inserid|enviad|confirmad|sucesso|gravado)/i.test(mensagem)) {
    const pedido = extrairNumero(mensagem, ['pedido', 'cotacao', 'cotação', 'carrinho']);

    return {
      tipo: 'PEDIDO',
      status: 'SUCESSO',
      mensagem: pedido ? `Pedido processado: ${pedido}` : 'Pedido processado com sucesso.',
      detalhe: mensagem,
      data: extrairDataLog(linha),
      linhaOriginal: linha,
    };
  }

  if (/(campanha).*(processad|gerad|finalizad|iniciad|sem produtos|sem arquivo|não gerou|nao gerou)/i.test(mensagem)) {
    const campanha = extrairNumero(mensagem, ['campanha']);

    return {
      tipo: 'CAMPANHA',
      status: lower.includes('não gerou') || lower.includes('nao gerou') ? 'ALERTA' : 'INFO',
      mensagem: campanha ? `Campanha avaliada: ${campanha}` : 'Campanha avaliada.',
      detalhe: mensagem,
      data: extrairDataLog(linha),
      linhaOriginal: linha,
    };
  }

  if (/(iniciando|inicio|início|executando|finalizado|finalizada|concluido|concluído|processo finalizado)/i.test(mensagem)) {
    return {
      tipo: 'EXECUCAO',
      status: /(finalizado|finalizada|concluido|concluído)/i.test(mensagem) ? 'SUCESSO' : 'INFO',
      mensagem,
      data: extrairDataLog(linha),
      linhaOriginal: linha,
    };
  }

  if (/(nenhum|sem).*(arquivo|pedido|item|produto)/i.test(mensagem)) {
    return {
      tipo: 'SEM_DADOS',
      status: 'INFO',
      mensagem,
      data: extrairDataLog(linha),
      linhaOriginal: linha,
    };
  }

  if (chave === 'pedidos' && /(http|status|payload|response|estoque)/i.test(mensagem)) {
    return {
      tipo: 'API',
      status: 'INFO',
      mensagem,
      data: extrairDataLog(linha),
      linhaOriginal: linha,
    };
  }

  return null;
}

function analisarLogCron(chave, linhas = []) {
  const eventos = linhas
    .map((linha) => classificarLinhaLog(linha, chave))
    .filter(Boolean)
    .slice(-80);
  const contadores = eventos.reduce((acc, evento) => {
    acc[evento.tipo] = (acc[evento.tipo] || 0) + 1;
    if (evento.status === 'ERRO') acc.erros += 1;
    if (evento.status === 'ALERTA') acc.alertas += 1;
    return acc;
  }, { erros: 0, alertas: 0 });
  const ultimoEvento = eventos[eventos.length - 1] || null;

  return {
    totalLinhas: linhas.length,
    totalEventos: eventos.length,
    erros: contadores.erros || 0,
    alertas: contadores.alertas || 0,
    arquivos: contadores.ARQUIVO || 0,
    pedidos: contadores.PEDIDO || 0,
    campanhas: contadores.CAMPANHA || 0,
    execucoes: contadores.EXECUCAO || 0,
    semDados: contadores.SEM_DADOS || 0,
    ultimoEvento: ultimoEvento?.mensagem || null,
    eventos,
  };
}

function workdirFor(target = 'files') {
  return target === 'pedidos'
    ? process.env.SSH_PEDIDOS_WORKDIR || process.env.SIGCOTEFACIL_FOLDER
    : process.env.SSH_FILES_WORKDIR || process.env.SIGCOTEFACIL_FOLDER;
}

function requireLocalWorkdir() {
  const folder = process.env.SIGCOTEFACIL_FOLDER;

  if (!folder) {
    throw new Error('SIGCOTEFACIL_FOLDER nao configurado para execucao local.');
  }

  return folder;
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

  const folder = requireLocalWorkdir();
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

async function lerCrontabTexto(target = 'files') {
  if (isSshMode()) {
    const result = await runSshCommand('crontab -l 2>/dev/null || true', target);
    return result.stdout || '';
  }

  return executarComando('crontab -l 2>/dev/null || true');
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
  if (isWindowsLocalMode()) {
    return [];
  }

  const stdout = await executarComando(`lsof -ti:${port} 2>/dev/null || true`, target);

  return String(stdout || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

async function listarPidsPorNome(processName, target = 'files') {
  if (!processName) return [];

  if (isWindowsLocalMode()) {
    return [];
  }

  const stdout = await executarComando(
    `pgrep -f ${shellEscape(processName)} 2>/dev/null || true`,
    target
  );

  return String(stdout || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

async function matarPidsPorPorta(port, target = 'files') {
  if (isWindowsLocalMode()) {
    return [];
  }

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
    const candidatos = await listarCandidatosLog(scriptName, target);
    const testes = candidatos
      .map((item) => `
        if [ -f ${shellEscape(item.path)} ]; then
          echo '=== LOG: ${item.path} (${item.source}) ===';
          tail -n ${n} ${shellEscape(item.path)};
          exit 0;
        fi
      `)
      .join('\n');
    const command = `
      cd ${shellEscape(workdir)} &&
      ${testes}
      echo 'Nenhum arquivo de log encontrado para ${scriptName}.';
      echo 'Candidatos verificados:';
      ${candidatos.map((item) => `echo '- ${item.path} (${item.source})';`).join('\n')}
      echo '--- Linha no crontab ---';
      crontab -l 2>/dev/null | grep ${shellEscape(scriptName)} || true;
      echo '--- Processo localizado ---';
      ps aux | grep ${shellEscape(scriptName)} | grep -v grep || true;
    `;

    const result = await runSshCommand(command, target);

    return result.stdout || result.stderr || '';
  }

  if (isWindowsLocalMode()) {
    return '';
  }

  if (!workdir) {
    return '';
  }

  const stdout = await executarComando(
    `tail -n ${n} ${path.join(workdir, `runtime-${scriptName}.log`)} 2>/dev/null || true`
  );

  return stdout || '';
}

async function listarCandidatosLog(scriptName, target = 'files') {
  const workdir = workdirFor(target);
  const candidatos = [];
  const envName = logEnvName(scriptName, target);

  if (envName && process.env[envName]) {
    candidatos.push({
      source: envName,
      path: normalizarLogPath(process.env[envName], workdir),
    });
  }

  if (isSshMode()) {
    const crontab = await lerCrontabTexto(target);
    const cronLog = encontrarLogNoCrontab(crontab, scriptName);

    if (cronLog?.logPath) {
      candidatos.push({
        source: 'crontab',
        path: normalizarLogPath(cronLog.logPath, workdir),
        linha: cronLog.linha,
      });
    }
  }

  candidatos.push({
    source: 'runtime',
    path: normalizarLogPath(`runtime-${scriptName}.log`, workdir),
  });

  if (target === 'pedidos') {
    candidatos.push(
      { source: 'fallback', path: normalizarLogPath('api-pedidos.log', workdir) },
      { source: 'fallback', path: normalizarLogPath('nohup.out', workdir) }
    );
  }

  const vistos = new Set();

  return candidatos.filter((item) => {
    if (!item.path || vistos.has(item.path)) return false;
    vistos.add(item.path);
    return true;
  });
}

async function diagnosticarLogsCrontab(servicos = {}) {
  const itens = [];

  for (const [chave, servico] of Object.entries(servicos)) {
    const scriptName = servico.script || servico.jar;
    if (!scriptName) continue;

    const target = chave === 'pedidos' ? 'pedidos' : 'files';
    const candidatos = await listarCandidatosLog(scriptName, target);

    let arquivos = [];

    if (isSshMode()) {
      const command = candidatos
        .map((item) => `
          if [ -f ${shellEscape(item.path)} ]; then
            stat -c '${item.path}|%s|%y' ${shellEscape(item.path)};
          else
            echo '${item.path}|NAO_ENCONTRADO|-';
          fi
        `)
        .join('\n');
      const result = await runSshCommand(command, target);

      arquivos = String(result.stdout || '')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((linha) => {
          const [path, tamanho, atualizadoEm] = linha.split('|');
          const candidato = candidatos.find((item) => item.path === path);
          return {
            path,
            source: candidato?.source || 'desconhecido',
            existe: tamanho !== 'NAO_ENCONTRADO',
            tamanhoBytes: tamanho === 'NAO_ENCONTRADO' ? 0 : Number(tamanho || 0),
            atualizadoEm: atualizadoEm === '-' ? null : atualizadoEm,
            linhaCron: candidato?.linha || null,
          };
        });
    } else {
      arquivos = candidatos.map((item) => ({
        path: item.path,
        source: item.source,
        existe: false,
        tamanhoBytes: 0,
        atualizadoEm: null,
        linhaCron: item.linha || null,
      }));
    }

    itens.push({
      chave,
      nome: servico.nome || chave,
      script: scriptName,
      target,
      workdir: workdirFor(target),
      arquivos,
    });
  }

  return itens;
}

async function lerLogsCrontab(servicos = {}, linhas = 200) {
  const itens = [];
  const n = Math.max(Number(linhas) || 200, 50);

  for (const [chave, servico] of Object.entries(servicos)) {
    const scriptName = servico.script || servico.jar;
    if (!scriptName) continue;

    const target = chave === 'pedidos' ? 'pedidos' : 'files';
    const candidatos = await listarCandidatosLog(scriptName, target);

    if (!isSshMode()) {
      itens.push({
        chave,
        nome: servico.nome || chave,
        script: scriptName,
        target,
        workdir: workdirFor(target),
        arquivo: candidatos[0] || null,
        linhas: [],
        content: '',
        resumo: analisarLogCron(chave, []),
      });
      continue;
    }

    const testes = candidatos
      .map((item) => `
        if [ -f ${shellEscape(item.path)} ]; then
          echo '__SIG_LOG_FOUND__|${item.path}|${item.source}';
          tail -n ${n} ${shellEscape(item.path)};
          exit 0;
        fi
      `)
      .join('\n');
    const command = `
      cd ${shellEscape(workdirFor(target))} &&
      ${testes}
      echo '__SIG_LOG_NOT_FOUND__';
      ${candidatos.map((item) => `echo '${item.path}|${item.source}';`).join('\n')}
    `;
    const result = await runSshCommand(command, target);
    const linhasSaida = String(result.stdout || result.stderr || '').split(/\r?\n/);
    const header = linhasSaida[0] || '';
    const found = header.startsWith('__SIG_LOG_FOUND__|');
    const parts = found ? header.split('|') : [];
    const arquivo = found
      ? {
          path: parts[1],
          source: parts[2],
          existe: true,
        }
      : {
          path: null,
          source: 'nao_encontrado',
          existe: false,
        };
    const linhasLog = found
      ? linhasSaida.slice(1).filter(Boolean)
      : linhasSaida.filter(Boolean);

    itens.push({
      chave,
      nome: servico.nome || chave,
      script: scriptName,
      target,
      workdir: workdirFor(target),
      arquivo,
      linhas: linhasLog,
      content: linhasLog.join('\n'),
      resumo: analisarLogCron(chave, linhasLog),
    });
  }

  return itens;
}

module.exports = {
  executarScript,
  executarComando,
  lerCrontab,
  salvarCrontab,
  listarPidsPorPorta,
  listarPidsPorNome,
  matarPidsPorPorta,
  lerLogRemoto,
  diagnosticarLogsCrontab,
  lerLogsCrontab,
  isSshMode,
  isWindowsLocalMode,
};
