const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { runSshCommand } = require('./sshClient');

const DEFAULT_PEDIDOS_JAR = 'envia-cotacao-0.0.4.jar';
const DEFAULT_PEDIDOS_LOG = 'logs/integracao-pedidos.log';

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
  if (target === 'pedidos' || scriptName === (process.env.JAR_PEDIDOS || DEFAULT_PEDIDOS_JAR)) return 'LOG_PEDIDOS_FILE';
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

function linhaRuidoLog(linha = '') {
  const texto = String(linha || '').trim();

  if (!texto) return true;
  if (/^=== LOG:/i.test(texto)) return true;
  if (/^\[NOVO-LAYOUT\]\[WARN\] Produto duplicado com dados comerciais diferentes/i.test(texto)) return true;
  if (/^Note: further occurrences of HTTP request parsing errors/i.test(texto)) return true;
  if (/Invalid character found in method name/i.test(texto)) return true;
  if (/HTTP method names must be tokens/i.test(texto)) return true;
  if (/Path contains "\.\.\/" after call to StringUtils#cleanPath/i.test(texto)) return true;
  if (/pthread_create failed/i.test(texto)) return true;
  if (/unable to create native thread/i.test(texto)) return true;
  if (/Failed to start the native thread/i.test(texto)) return true;
  if (/Failed to start thread "Unknown thread"/i.test(texto)) return true;
  if (/Failed to start bean 'webServerStartStop'/i.test(texto)) return true;
  if (/Application run failed/i.test(texto)) return true;
  if (/Exception encountered during context initialization - cancelling refresh attempt/i.test(texto)) return true;
  if (/Invocation of close method failed on bean with name 'dataSource'/i.test(texto)) return true;
  if (/possibly out of memory or process\/resource limits reached/i.test(texto)) return true;
  if (/^\s*at org\.apache\.coyote\./i.test(texto)) return true;
  if (/^\s*at org\.apache\.tomcat\./i.test(texto)) return true;
  if (/^\s*at org\.springframework\.web\.servlet\./i.test(texto)) return true;
  if (/^\s*at java\.base\/java\.lang\.Thread\.run/i.test(texto)) return true;

  return false;
}

function filtrarLinhasLogOperacional(content = '') {
  const vistosDuplicados = new Set();

  return String(content || '')
    .split(/\r?\n/)
    .map((linha) => linha.trimEnd())
    .filter((linha) => {
      if (linhaRuidoLog(linha)) return false;

      const chaveDuplicado = linha
        .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/g, '')
        .trim();

      if (vistosDuplicados.has(chaveDuplicado)) return false;
      vistosDuplicados.add(chaveDuplicado);
      return true;
    });
}

function extrairDataLinhaLog(linha = '') {
  const texto = String(linha || '');
  const iso = texto.match(/\b(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:[.,]\d+)?(?:([+-]\d{2}:\d{2})|Z)?/);

  if (iso) {
    const timezone = iso[3] || '';
    const data = new Date(`${iso[1]}T${iso[2]}${timezone}`);
    return Number.isNaN(data.getTime()) ? null : data;
  }

  const br = texto.match(/\b(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})\b/);
  if (br) {
    const data = new Date(`${br[3]}-${br[2]}-${br[1]}T${br[4]}`);
    return Number.isNaN(data.getTime()) ? null : data;
  }

  return null;
}

function filtrarLinhasPorConsulta(linhas = [], options = {}) {
  let filtradas = Array.isArray(linhas) ? linhas : [];
  const search = String(options.search || '').trim().toLowerCase();
  const dias = Math.min(Math.max(Number(options.dias || 0), 0), 30);

  if (dias > 0) {
    const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
    filtradas = filtradas.filter((linha) => {
      const data = extrairDataLinhaLog(linha);
      return data ? data.getTime() >= limite : true;
    });
  }

  if (search) {
    filtradas = filtradas.filter((linha) => String(linha || '').toLowerCase().includes(search));
  }

  return filtradas;
}

function ordenarCandidatosLogLeitura(candidatos = []) {
  const prioridade = {
    crontab: 0,
    LOG_GERACAO_FILE: 1,
    LOG_EXCLUSAO_FILE: 1,
    LOG_PEDIDOS_FILE: 1,
    runtime: 2,
    fallback: 3,
  };

  return [...candidatos].sort((a, b) => {
    const pa = prioridade[a.source] ?? 4;
    const pb = prioridade[b.source] ?? 4;
    return pa - pb;
  });
}

function montarMarcadorPainel(options = {}) {
  if (!options.executionId) return null;

  return [
    '===== SIG_PANEL_START',
    `executionId=${options.executionId}`,
    `servico=${options.servico || '-'}`,
    `nome=${String(options.nomeServico || options.servico || '-').replace(/\s+/g, '_')}`,
    `usuario=${options.usuario || 'admin'}`,
    `data=${options.iniciadoEm || new Date().toISOString()}`,
    '=====',
  ].join(' ');
}

function recortarDesdeMarcador(content = '', options = {}) {
  const texto = String(content || '');
  const marcador = options.marker || montarMarcadorPainel(options);
  const executionId = options.executionId;

  if (!marcador && !executionId) return texto;

  let index = marcador ? texto.lastIndexOf(marcador) : -1;

  if (index < 0 && executionId) {
    index = texto.lastIndexOf(`executionId=${executionId}`);
    if (index > 0) {
      const inicioLinha = texto.lastIndexOf('\n', index);
      index = inicioLinha >= 0 ? inicioLinha + 1 : index;
    }
  }

  return index >= 0 ? texto.slice(index) : texto;
}

async function resolverLogExecucao(scriptName, target = 'files') {
  const workdir = workdirFor(target);

  if (!isSshMode()) {
    return {
      source: 'runtime',
      path: normalizarLogPath(`runtime-${scriptName}.log`, workdir),
    };
  }

  const candidatos = await listarCandidatosLog(scriptName, target);

  return ordenarCandidatosLogLeitura(candidatos)[0] || {
    source: 'runtime',
    path: normalizarLogPath(`runtime-${scriptName}.log`, workdir),
  };
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

  if (chave === 'pedidos' && /(x-rastreio|rastreio|payloadRecebido|payloadSigrede|pedido|cotacao|cotação|bucket|campanha)/i.test(mensagem)) {
    const status = /(n[ãa]o inserid|inexistente|n[ãa]o encontrad|sem json|erro|error|falha)/i.test(mensagem)
      ? 'ALERTA'
      : 'INFO';

    return {
      tipo: 'PEDIDO',
      status,
      mensagem,
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

async function executarScript(scriptName, options = {}) {
  if (isSshMode()) {
    const workdir = workdirFor('files');
    const arquivoLog = await resolverLogExecucao(scriptName, 'files');
    const marcador = montarMarcadorPainel(options);

    const command = [
      `cd ${shellEscape(workdir)}`,
      `chmod +x ${shellEscape(scriptName)}`,
      marcador ? `printf '%s\\n' ${shellEscape(marcador)} >> ${shellEscape(arquivoLog.path)}` : null,
      `nohup ./${scriptName} >> ${shellEscape(arquivoLog.path)} 2>&1 & echo $!`,
    ].filter(Boolean).join(' && ');

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
      executionId: options.executionId || null,
      marker: marcador,
      logPath: arquivoLog.path,
      logSource: arquivoLog.source,
      iniciadoEm: options.iniciadoEm || null,
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
    executionId: options.executionId || null,
    marker: montarMarcadorPainel(options),
    iniciadoEm: options.iniciadoEm || null,
  };
}

async function executarJar(jarName, target = 'pedidos', options = {}) {
  if (isSshMode()) {
    const workdir = workdirFor(target);
    const arquivoLog = await resolverLogExecucao(jarName, target);
    const marcador = montarMarcadorPainel(options);

    const command = [
      `cd ${shellEscape(workdir)}`,
      marcador ? `printf '%s\\n' ${shellEscape(marcador)} >> ${shellEscape(arquivoLog.path)}` : null,
      `nohup java -jar ${shellEscape(jarName)} >> ${shellEscape(arquivoLog.path)} 2>&1 & echo $!`,
    ].filter(Boolean).join(' && ');

    const result = await runSshCommand(command, target);

    if (result.code !== 0) {
      throw new Error(result.stderr || 'Erro ao executar JAR via SSH');
    }

    return {
      mode: 'ssh',
      servidor: target === 'pedidos' ? process.env.SSH_PEDIDOS_HOST : process.env.SSH_FILES_HOST,
      pid: String(result.stdout || '').trim(),
      stdout: result.stdout,
      stderr: result.stderr,
      executionId: options.executionId || null,
      marker: marcador,
      logPath: arquivoLog.path,
      logSource: arquivoLog.source,
      iniciadoEm: options.iniciadoEm || null,
    };
  }

  const folder = requireLocalWorkdir();
  const child = spawn('java', ['-jar', path.join(folder, jarName)], {
    cwd: folder,
    detached: false,
  });

  return {
    mode: 'local',
    pid: child.pid,
    executionId: options.executionId || null,
    marker: montarMarcadorPainel(options),
    iniciadoEm: options.iniciadoEm || null,
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

async function lerArquivoScript(scriptName, target = 'files') {
  const workdir = workdirFor(target);

  if (isSshMode()) {
    const scriptPath = `${workdir}/${scriptName}`;
    const result = await runSshCommand(`cat ${shellEscape(scriptPath)}`, target);

    if (result.code !== 0) {
      throw new Error(result.stderr || 'Erro ao ler script via SSH');
    }

    return {
      script: scriptName,
      target,
      workdir,
      path: scriptPath,
      content: result.stdout || '',
    };
  }

  const folder = requireLocalWorkdir();
  const scriptPath = path.join(folder, scriptName);

  return {
    script: scriptName,
    target,
    workdir: folder,
    path: scriptPath,
    content: fs.readFileSync(scriptPath, 'utf8'),
  };
}

async function salvarArquivoScript(scriptName, content, target = 'files') {
  const workdir = workdirFor(target);
  const safeContent = Buffer.from(String(content || ''), 'utf8').toString('base64');
  const backupSuffix = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);

  if (isSshMode()) {
    const scriptPath = `${workdir}/${scriptName}`;
    const backupPath = `${scriptPath}.bak-${backupSuffix}`;
    const command = [
      `test -f ${shellEscape(scriptPath)}`,
      `cp ${shellEscape(scriptPath)} ${shellEscape(backupPath)}`,
      `printf '%s' ${shellEscape(safeContent)} | base64 -d > ${shellEscape(scriptPath)}`,
      `chmod +x ${shellEscape(scriptPath)}`,
    ].join(' && ');
    const result = await runSshCommand(command, target);

    if (result.code !== 0) {
      throw new Error(result.stderr || 'Erro ao salvar script via SSH');
    }

    return {
      script: scriptName,
      target,
      workdir,
      path: scriptPath,
      backupPath,
    };
  }

  const folder = requireLocalWorkdir();
  const scriptPath = path.join(folder, scriptName);
  const backupPath = `${scriptPath}.bak-${backupSuffix}`;

  fs.copyFileSync(scriptPath, backupPath);
  fs.writeFileSync(scriptPath, String(content || ''), 'utf8');

  try {
    fs.chmodSync(scriptPath, 0o755);
  } catch {
    // Windows local mode may not support chmod in the same way as Linux.
  }

  return {
    script: scriptName,
    target,
    workdir: folder,
    path: scriptPath,
    backupPath,
  };
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

async function lerLogRemoto(scriptName, linhas = 300, target = 'files', options = {}) {
  const workdir = workdirFor(target);
  const n = Math.max(Number(linhas) || 300, 50);
  const consultaHistorica = Number(options.dias || 0) > 0 || String(options.search || '').trim();
  const linhasBusca = options.executionId || options.marker
    ? Math.max(n, Number(options.linhasBusca || 4000))
    : consultaHistorica
      ? Math.max(n, Number(options.linhasBusca || 8000))
      : n;

  if (isSshMode()) {
    const candidatos = await listarCandidatosLog(scriptName, target);
    const candidatosOrdenados = ordenarCandidatosLogLeitura(candidatos);
    const testes = candidatosOrdenados
      .map((item) => `
        if [ -f ${shellEscape(item.path)} ]; then
          tail -n ${linhasBusca} ${shellEscape(item.path)};
          exit 0;
        fi
      `)
      .join('\n');
    const command = `
      cd ${shellEscape(workdir)} &&
      ${testes}
      echo 'Nenhum arquivo de log encontrado para ${scriptName}.';
      echo 'Candidatos verificados:';
      ${candidatosOrdenados.map((item) => `echo '- ${item.path} (${item.source})';`).join('\n')}
      echo '--- Linha no crontab ---';
      crontab -l 2>/dev/null | grep ${shellEscape(scriptName)} || true;
      echo '--- Processo localizado ---';
      ps aux | grep ${shellEscape(scriptName)} | grep -v grep || true;
    `;

    const result = await runSshCommand(command, target);

    const content = recortarDesdeMarcador(result.stdout || result.stderr || '', options);
    return filtrarLinhasPorConsulta(filtrarLinhasLogOperacional(content), options).slice(-n).join('\n');
  }

  if (isWindowsLocalMode()) {
    return '';
  }

  if (!workdir) {
    return '';
  }

  const stdout = await executarComando(
    `tail -n ${linhasBusca} ${path.join(workdir, `runtime-${scriptName}.log`)} 2>/dev/null || true`
  );

  const content = recortarDesdeMarcador(stdout || '', options);
  return filtrarLinhasPorConsulta(filtrarLinhasLogOperacional(content), options).slice(-n).join('\n');
}

function linhaErroLogPedidos(linha = '') {
  return /(ERROR|WARN|erro|falha|exception|unauthorized|forbidden|token|login|X-Rastreio|rastreio|payloadRecebido|payloadSigrede|pedido.*n[ãa]o inserid|n[ãa]o encontrad|inexistente|sem json|timeout|refused)/i
    .test(String(linha || ''));
}

async function lerLogErrosPedidos(options = {}) {
  const workdir = workdirFor('pedidos');
  const linhas = Math.min(Math.max(Number(options.linhas || 300), 50), 1000);
  const linhasBusca = Math.min(Math.max(Number(options.linhasBusca || linhas * 5), linhas), 5000);
  const logPath = normalizarLogPath(
    process.env.LOG_PEDIDOS_ERROS_FILE || process.env.PEDIDOS_API_LOG_FILE || DEFAULT_PEDIDOS_LOG,
    workdir
  );
  const search = String(options.search || '').trim().toLowerCase();
  const rastreio = String(options.rastreio || '').trim().toLowerCase();
  const somenteErros = String(options.somenteErros ?? 'true').toLowerCase() !== 'false';

  const filtrar = (content = '') => {
    let linhasLog = filtrarLinhasLogOperacional(content);

    if (somenteErros) {
      linhasLog = linhasLog.filter(linhaErroLogPedidos);
    }

    if (rastreio) {
      linhasLog = linhasLog.filter((linha) => String(linha || '').toLowerCase().includes(rastreio));
    }

    if (search) {
      linhasLog = linhasLog.filter((linha) => String(linha || '').toLowerCase().includes(search));
    }

    return linhasLog.slice(-linhas);
  };

  if (isSshMode()) {
    const command = `
      cd ${shellEscape(workdir)} &&
      if [ -f ${shellEscape(logPath)} ]; then
        echo '__SIG_PEDIDOS_LOG_FOUND__|${logPath}';
        tail -n ${linhasBusca} ${shellEscape(logPath)};
      else
        echo '__SIG_PEDIDOS_LOG_NOT_FOUND__|${logPath}';
      fi
    `;
    const result = await runSshCommand(command, 'pedidos');
    const linhasSaida = String(result.stdout || result.stderr || '').split(/\r?\n/);
    const header = linhasSaida[0] || '';
    const encontrado = header.startsWith('__SIG_PEDIDOS_LOG_FOUND__|');
    const content = encontrado ? linhasSaida.slice(1).join('\n') : '';
    const linhasFiltradas = filtrar(content);

    return {
      arquivo: {
        path: logPath,
        source: 'LOG_PEDIDOS_ERROS_FILE',
        existe: encontrado,
      },
      linhas: linhasFiltradas,
      content: linhasFiltradas.join('\n'),
      meta: {
        linhas: linhasFiltradas.length,
        linhasBusca,
        somenteErros,
        search: search || null,
        rastreio: rastreio || null,
      },
    };
  }

  if (isWindowsLocalMode() || !workdir) {
    return {
      arquivo: { path: logPath, source: 'LOG_PEDIDOS_ERROS_FILE', existe: false },
      linhas: [],
      content: '',
      meta: { linhas: 0, linhasBusca, somenteErros, search: search || null, rastreio: rastreio || null },
    };
  }

  const stdout = await executarComando(`tail -n ${linhasBusca} ${shellEscape(logPath)} 2>/dev/null || true`);
  const linhasFiltradas = filtrar(stdout || '');

  return {
    arquivo: { path: logPath, source: 'LOG_PEDIDOS_ERROS_FILE', existe: Boolean(stdout) },
    linhas: linhasFiltradas,
    content: linhasFiltradas.join('\n'),
    meta: { linhas: linhasFiltradas.length, linhasBusca, somenteErros, search: search || null, rastreio: rastreio || null },
  };
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

async function lerLogsCrontab(servicos = {}, linhas = 200, options = {}) {
  const itens = [];
  const n = Math.max(Number(linhas) || 200, 50);
  const consultaHistorica = Number(options.dias || 0) > 0 || String(options.search || '').trim();
  const linhasBusca = consultaHistorica ? Math.max(n, Number(options.linhasBusca || 8000)) : n;

  for (const [chave, servico] of Object.entries(servicos)) {
    const scriptName = servico.script || servico.jar;
    if (!scriptName) continue;

    const target = chave === 'pedidos' ? 'pedidos' : 'files';
    const candidatos = await listarCandidatosLog(scriptName, target);
    const candidatosOrdenados = ordenarCandidatosLogLeitura(candidatos);

    if (!isSshMode()) {
      itens.push({
        chave,
        nome: servico.nome || chave,
        script: scriptName,
        target,
        workdir: workdirFor(target),
        arquivo: candidatosOrdenados[0] || null,
        linhas: [],
        content: '',
        resumo: analisarLogCron(chave, []),
      });
      continue;
    }

    const testes = candidatosOrdenados
      .map((item) => `
        if [ -f ${shellEscape(item.path)} ]; then
          echo '__SIG_LOG_FOUND__|${item.path}|${item.source}';
          tail -n ${linhasBusca} ${shellEscape(item.path)};
          exit 0;
        fi
      `)
      .join('\n');
    const command = `
      cd ${shellEscape(workdirFor(target))} &&
      ${testes}
      echo '__SIG_LOG_NOT_FOUND__';
      ${candidatosOrdenados.map((item) => `echo '${item.path}|${item.source}';`).join('\n')}
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
    const linhasLogBase = found
      ? filtrarLinhasLogOperacional(linhasSaida.slice(1).join('\n'))
      : filtrarLinhasLogOperacional(linhasSaida.join('\n'));
    const linhasLog = filtrarLinhasPorConsulta(linhasLogBase, options).slice(-n);

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
  executarJar,
  executarComando,
  lerArquivoScript,
  salvarArquivoScript,
  lerCrontab,
  salvarCrontab,
  listarPidsPorPorta,
  listarPidsPorNome,
  matarPidsPorPorta,
  lerLogRemoto,
  lerLogErrosPedidos,
  diagnosticarLogsCrontab,
  lerLogsCrontab,
  isSshMode,
  isWindowsLocalMode,
};
