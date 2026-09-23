const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawn, execFile } = require('child_process');
const { Storage } = require('@google-cloud/storage');

require('dotenv').config();

const ultimoErroDetectado = {};
const ultimoStatusServicos = {};
const ultimoEventoManual = {};
const execucoesPainel = {};
const statusServicosCache = {
  data: null,
  updatedAt: 0,
};
const logsServicosCache = {};
const logsCronCache = {};
const pedidosApiLogsCache = {};
let statusServicosRefreshPromise = null;

const STATUS_CACHE_TTL_MS = Number(process.env.STATUS_CACHE_TTL_MS || 300000);
const STATUS_STALE_TTL_MS = Number(process.env.STATUS_STALE_TTL_MS || 1800000);
const LOGS_CACHE_TTL_MS = Number(process.env.LOGS_CACHE_TTL_MS || 30000);
const CRON_LOGS_CACHE_TTL_MS = Number(process.env.CRON_LOGS_CACHE_TTL_MS || 60000);
const SSH_STATUS_TIMEOUT_MS = Number(process.env.SSH_STATUS_TIMEOUT_MS || 6000);
const IGNORAR_ALERTA_APOS_STOP_MS = Number(process.env.IGNORAR_ALERTA_APOS_STOP_MS || 45000);
const ALERT_EMAIL_ON_MANUAL_STOP =
  String(process.env.ALERT_EMAIL_ON_MANUAL_STOP || 'false').toLowerCase() === 'true';

const {
  executarScript,
  executarJar,
  lerCrontab,
  salvarCrontab,
  listarPidsPorPorta,
  listarPidsPorNome,
  matarPidsPorPorta,
  lerArquivoScript,
  salvarArquivoScript,
  lerLogRemoto,
  lerLogErrosPedidos,
  diagnosticarLogsCrontab,
  lerLogsCrontab,
} = require('./remoteExecution');

const { iniciarMonitoramento } = require('./serviceMonitor');
const { enviarEmailAlerta } = require('./mailer');
const { enviarAlertaOperacional, listarAlertas, garantirTabelaAlertas } = require('./alertService');
const { garantirTabelaAcoesPainel, registrarAcaoPainel, listarAcoesPainel } = require('./auditService');
const {
  garantirTabelaServicosLogs,
  registrarServicoLog,
  listarServicosLogs,
} = require('./serviceLogService');
const { detectarErroLog } = require('./serviceMonitor');
const { criarCache, cacheValido, salvarCache } = require('./cacheService');

const pool = require('./db');
const { validarPedido } = require('./pedidoValidator');

const app = express();
const PORT = Number(process.env.PORT || 3001);

const BUCKET_NAME = process.env.BUCKET_NAME || 'sig-integracao-pedidos';
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'My Project 53233';
const GCP_KEY_FILE = process.env.GCP_KEY_FILE || 'maximal-record-383715-6df91a0e1e50.json';

const GCP_KEY_PATH = path.isAbsolute(GCP_KEY_FILE)
  ? GCP_KEY_FILE
  : path.join(__dirname, GCP_KEY_FILE);

const APP_SECRET = process.env.APP_SECRET || 'sig-integracao-pedidos-dev-secret';
const PANEL_TOKEN = process.env.PANEL_TOKEN || process.env.SIG_PANEL_TOKEN || 'sig-integracao-pedidos';
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS || 60 * 60 * 12);

const SIG_FOLDER = process.env.SIGCOTEFACIL_FOLDER || '/home/sigpedidos/sigcotefacil';
const RUNTIME_LOG_DIR = process.env.RUNTIME_LOG_DIR || path.join(__dirname, 'runtime-logs');
const ALLOW_CRON_WRITE = String(process.env.ALLOW_CRON_WRITE || 'false').toLowerCase() === 'true';
const DEFAULT_PEDIDOS_JAR = 'envia-cotacao-0.0.5.jar';
const DEFAULT_PEDIDOS_LOG = 'logs/integracao-pedidos.log';
const dashboardCache = {
  bucket: criarCache(60000),
  redeLoja: criarCache(60000),
};
const arquivosBucketCache = criarCache(process.env.BUCKET_CACHE_TTL_MS || 30000);

function normalizarDataFiltro(value) {
  const texto = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  return texto;
}

function filtrosData(req, coluna, aliasesInicio = ['dataInicio', 'dataInicial', 'inicio'], aliasesFim = ['dataFim', 'dataFinal', 'fim']) {
  const inicio = normalizarDataFiltro(aliasesInicio.map((key) => req.query[key]).find(Boolean));
  const fim = normalizarDataFiltro(aliasesFim.map((key) => req.query[key]).find(Boolean));
  const where = [];
  const params = [];

  if (inicio) {
    where.push(`DATE(${coluna}) >= ?`);
    params.push(inicio);
  }

  if (fim) {
    where.push(`DATE(${coluna}) <= ?`);
    params.push(fim);
  }

  return { inicio, fim, where, params };
}

function bancoConfigurado() {
  return Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_DATABASE);
}

function registrarAcaoPainelSeguro(payload) {
  if (!bancoConfigurado()) return;

  registrarAcaoPainel(payload).catch((error) => {
    console.error('Falha ao registrar acao do painel:', error.message);
  });
}

function registrarServicoLogSeguro(payload) {
  if (!bancoConfigurado()) return;

  registrarServicoLog(payload).catch((error) => {
    console.error('Falha ao registrar log de servico:', error.message);
  });
}

function eventoServicoPayload(chave, overrides = {}) {
  const servico = SERVICOS[chave] || {};

  return {
    servico: chave,
    nomeServico: servico.nome || chave,
    origem: servico.script || servico.jar || null,
    ...overrides,
  };
}

function registrarInicioServico(req, chave, result) {
  registrarServicoLogSeguro(eventoServicoPayload(chave, {
    req,
    tipo: 'INICIAR_SERVICO',
    status: 'SUCESSO',
    mensagem: `${SERVICOS[chave]?.nome || chave} iniciado pelo painel.`,
    detalhe: result,
    pid: result?.pid,
  }));
}

function registrarErroInicioServico(req, chave, error) {
  registrarServicoLogSeguro(eventoServicoPayload(chave, {
    req,
    tipo: 'INICIAR_SERVICO',
    status: 'ERRO',
    mensagem: `Erro ao iniciar ${SERVICOS[chave]?.nome || chave}.`,
    detalhe: error.stack || error.message,
  }));
}

function scriptOuJarServico(chave) {
  const servico = SERVICOS[chave] || {};
  return servico.script || servico.jar || null;
}

function targetServicoLog(chave) {
  return chave === 'pedidos' ? 'pedidos' : 'files';
}

function calcularNovasLinhas(linhasAnteriores = [], linhasAtuais = []) {
  const limite = Math.min(linhasAnteriores.length, linhasAtuais.length);

  for (let tamanho = limite; tamanho > 0; tamanho--) {
    const anterior = linhasAnteriores.slice(-tamanho).join('\n');
    const atual = linhasAtuais.slice(0, tamanho).join('\n');

    if (anterior === atual) {
      return linhasAtuais.slice(tamanho);
    }
  }

  return linhasAtuais;
}

const SERVICOS = {
  geracao: {
    chave: 'geracao',
    nome: 'GeraÃƒÂ§ÃƒÂ£o de arquivos',
    script: process.env.SCRIPT_GERACAO || 'executa_script.sh',
    porta: Number(process.env.GERACAO_PORT || 8080),
  },
  exclusao: {
    chave: 'exclusao',
    nome: 'ExclusÃƒÂ£o de arquivos',
    script: process.env.SCRIPT_EXCLUSAO || 'executa_exclusao_script.sh',
    porta: Number(process.env.EXCLUSAO_PORT || 8081),
  },
  pedidos: {
    chave: 'pedidos',
    nome: 'API inserÃƒÂ§ÃƒÂ£o de pedidos',
    jar: process.env.JAR_PEDIDOS || DEFAULT_PEDIDOS_JAR,
    errorLogFile: process.env.LOG_PEDIDOS_ERROS_FILE || DEFAULT_PEDIDOS_LOG,
    porta: Number(process.env.PEDIDOS_PORT || 8080),
    healthUrl:
      process.env.PEDIDOS_HEALTH_URL ||
      `http://localhost:${Number(process.env.PEDIDOS_PORT || 8080)}/actuator/health`,
  },
};

function criarContextoExecucaoPainel(req, chave) {
  const servico = SERVICOS[chave] || {};
  const iniciadoEm = new Date().toISOString();
  const executionId = `${chave}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  return {
    executionId,
    servico: chave,
    nomeServico: servico.nome || chave,
    usuario: req?.usuario?.usuario || req?.usuario?.sub || 'admin',
    iniciadoEm,
  };
}

function registrarExecucaoPainel(chave, contexto, result) {
  execucoesPainel[chave] = {
    ...contexto,
    pid: result?.pid || null,
    marker: result?.marker || null,
    logPath: result?.logPath || null,
    logSource: result?.logSource || null,
    registradoEm: Date.now(),
  };

  invalidarCacheLogsServico(chave);
}

function contextoLogServico(req, chave) {
  const executionId = req?.query?.executionId || null;
  const atual = execucoesPainel[chave] || null;

  if (!executionId) return atual;
  if (atual?.executionId === executionId) return atual;

  return {
    executionId,
    marker: null,
  };
}

function timeoutPromise(promise, ms, label = 'operaÃƒÂ§ÃƒÂ£o') {
  let timer;

  const limite = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} excedeu ${ms / 1000}s`)), ms);
  });

  return Promise.race([promise, limite]).finally(() => clearTimeout(timer));
}

function alvoServico(chave) {
  return chave === 'pedidos' ? 'pedidos' : 'files';
}

function servidorServico(chave) {
  return chave === 'pedidos' ? process.env.SSH_PEDIDOS_HOST : process.env.SSH_FILES_HOST;
}

function houveAcaoManualRecente(chave) {
  const ts = ultimoEventoManual[chave];
  return Boolean(ts && Date.now() - ts < IGNORAR_ALERTA_APOS_STOP_MS);
}

function erroSshTransitorio(error) {
  const mensagem = String(error?.message || '').toLowerCase();
  return mensagem.includes('excedeu')
    || mensagem.includes('econnreset')
    || mensagem.includes('timed out')
    || mensagem.includes('timeout');
}

function debugStatusSshAtivo() {
  return String(process.env.DEBUG_SSH_STATUS || 'false').toLowerCase() === 'true';
}
async function safePidsServico(chave) {
  const servico = SERVICOS[chave];

  if (!servico) return [];

  try {
    if (chave === 'pedidos') {
      const [pidsPorta, pidsJar] = await Promise.all([
        timeoutPromise(
          listarPidsPorPorta(servico.porta, alvoServico(chave)),
          SSH_STATUS_TIMEOUT_MS,
          `consulta de porta ${chave}`
        ),
        timeoutPromise(
          listarPidsPorNome(servico.jar, alvoServico(chave)),
          SSH_STATUS_TIMEOUT_MS,
          `consulta de processo ${chave}`
        ),
      ]);

      const portaOk = Array.isArray(pidsPorta) ? pidsPorta : [];
      const jarOk = Array.isArray(pidsJar) ? pidsJar : [];

      return portaOk.filter((pid) => jarOk.includes(pid));
    }

    const pids = await timeoutPromise(
      listarPidsPorPorta(servico.porta, alvoServico(chave)),
      SSH_STATUS_TIMEOUT_MS,
      `consulta de status ${chave}`
    );

    return Array.isArray(pids) ? pids : [];
  } catch (error) {
    if (!erroSshTransitorio(error) || debugStatusSshAtivo()) {
      console.warn(`Status do serviÃƒÂ§o ${chave} indisponÃƒÂ­vel:`, error.message);
    }
    return [];
  }
}

function statusServicoInicial(chave) {
  const servico = SERVICOS[chave];

  return {
    nome: servico.nome,
    script: servico.script || null,
    jar: servico.jar || null,
    porta: servico.porta,
    servidor: servidorServico(chave),
    tipo: chave === 'pedidos' ? 'servico' : 'job',
    online: false,
    statusOperacional: 'verificando',
    pids: [],
    target: alvoServico(chave),
  };
}

function statusInicialServicos() {
  return {
    atualizadoEm: new Date().toISOString(),
    data: {
      geracao: statusServicoInicial('geracao'),
      exclusao: statusServicoInicial('exclusao'),
      pedidos: statusServicoInicial('pedidos'),
    },
  };
}

async function atualizarStatusServicos({ detectarQueda = true } = {}) {
  const resultados = await Promise.allSettled([
    safePidsServico('geracao'),
    safePidsServico('exclusao'),
    safePidsServico('pedidos'),
  ]);

  const getPids = (index) =>
    resultados[index].status === 'fulfilled' && Array.isArray(resultados[index].value)
      ? resultados[index].value
      : [];

  const geracaoPids = getPids(0);
  const exclusaoPids = getPids(1);
  const pedidosPids = getPids(2);

  const data = {
    geracao: {
  nome: SERVICOS.geracao.nome,
  script: SERVICOS.geracao.script,
  porta: SERVICOS.geracao.porta,
  servidor: servidorServico('geracao'),
  tipo: 'job',
  online: geracaoPids.length > 0,
  statusOperacional: geracaoPids.length > 0 ? 'executando' : 'aguardando execuÃƒÂ§ÃƒÂ£o',
  pids: geracaoPids,
  target: 'files',
},
    exclusao: {
  nome: SERVICOS.exclusao.nome,
  script: SERVICOS.exclusao.script,
  porta: SERVICOS.exclusao.porta,
  servidor: servidorServico('exclusao'),
  tipo: 'job',
  online: exclusaoPids.length > 0,
  statusOperacional: exclusaoPids.length > 0 ? 'executando' : 'aguardando execuÃƒÂ§ÃƒÂ£o',
  pids: exclusaoPids,
  target: 'files',
},
  pedidos: {
  nome: SERVICOS.pedidos.nome,
  jar: SERVICOS.pedidos.jar,
  errorLogFile: SERVICOS.pedidos.errorLogFile,
  porta: SERVICOS.pedidos.porta,
  servidor: servidorServico('pedidos'),
  tipo: 'servico',
  online: pedidosPids.length > 0,
  statusOperacional: pedidosPids.length > 0 ? 'online' : 'offline',
  pids: pedidosPids,
  target: 'pedidos',
},
  };

if (detectarQueda) {
  for (const key of Object.keys(data)) {
    const atualOnline = data[key].online;
    const anteriorOnline = ultimoStatusServicos[key];

    if (key !== 'pedidos') {
      ultimoStatusServicos[key] = atualOnline;
      continue;
    }

    if (anteriorOnline === true && atualOnline === false && !houveAcaoManualRecente(key)) {
      enviarAlertaOperacional({
        servico: data[key].nome,
        tipo: 'SERVICO_OFFLINE',
        severidade: 'ALERTA',
        mensagem: `O serviÃƒÂ§o ${data[key].nome} ficou offline.`,
        servidor: data[key].servidor,
        porta: data[key].porta,
        assunto: `Ã°Å¸Å¡Â¨ ServiÃƒÂ§o offline - ${data[key].nome}`,
      }).catch((error) => {
        console.error(`Falha ao enviar alerta offline ${key}:`, error.message);
      });
    }

    ultimoStatusServicos[key] = atualOnline;
  }
}

  const payload = {
    atualizadoEm: new Date().toISOString(),
    data,
  };

  statusServicosCache.data = payload;
  statusServicosCache.updatedAt = Date.now();

  return {
    ...payload,
    cache: false,
    cacheAgeMs: 0,
  };
}

function atualizarStatusServicosEmBackground({ detectarQueda = true } = {}) {
  if (statusServicosRefreshPromise) {
    return statusServicosRefreshPromise;
  }

  statusServicosRefreshPromise = atualizarStatusServicos({ detectarQueda })
    .catch((error) => {
      console.error('Falha ao atualizar cache de status dos serviÃƒÂ§os:', error.message);
      return null;
    })
    .finally(() => {
      statusServicosRefreshPromise = null;
    });

  return statusServicosRefreshPromise;
}

async function consultarStatusServicos({ force = false, detectarQueda = true } = {}) {
  const agora = Date.now();
  const cacheAgeMs = statusServicosCache.updatedAt ? agora - statusServicosCache.updatedAt : 0;

  if (!force && statusServicosCache.data && cacheAgeMs < STATUS_CACHE_TTL_MS) {
    return {
      ...statusServicosCache.data,
      cache: true,
      stale: false,
      cacheAgeMs,
    };
  }

  if (!force && statusServicosCache.data && cacheAgeMs < STATUS_STALE_TTL_MS) {
    atualizarStatusServicosEmBackground({ detectarQueda });

    return {
      ...statusServicosCache.data,
      cache: true,
      stale: true,
      cacheAgeMs,
    };
  }

  if (!force && !statusServicosCache.data) {
    atualizarStatusServicosEmBackground({ detectarQueda });

    return {
      ...statusInicialServicos(),
      cache: true,
      stale: true,
      pendingRefresh: true,
      cacheAgeMs: 0,
    };
  }

  return atualizarStatusServicos({ detectarQueda });
}

function invalidarCacheStatusServicos() {
  statusServicosCache.data = null;
  statusServicosCache.updatedAt = 0;
}

function invalidarCacheLogsServico(chave) {
  Object.keys(logsServicosCache)
    .filter((key) => key.startsWith(`${chave}:`))
    .forEach((key) => delete logsServicosCache[key]);

  if (chave === 'pedidos') {
    Object.keys(pedidosApiLogsCache).forEach((key) => delete pedidosApiLogsCache[key]);
  }
}

const processos = new Map();

if (!fs.existsSync(RUNTIME_LOG_DIR)) {
  fs.mkdirSync(RUNTIME_LOG_DIR, { recursive: true });
}

const storage = new Storage({
  projectId: GCP_PROJECT_ID,
  ...(fs.existsSync(GCP_KEY_PATH) ? { keyFilename: GCP_KEY_PATH } : {}),
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.disable('etag');

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

function erroResponse(res, status, message, error) {
  return res.status(status).json({
    success: false,
    message,
    error: error?.message || String(error || ''),
  });
}

function base64url(input) {
  return Buffer
    .from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function criarToken(payload) {
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function validarToken(token) {
  if (!token || !token.includes('.')) return null;

  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function authMiddleware(req, res, next) {
  const publicPaths = ['/', '/health', '/auth/login'];

  if (publicPaths.includes(req.path)) {
    return next();
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : req.path.endsWith('/logs/stream')
      ? req.query.token || null
      : null;
  const payload = validarToken(token);

  if (!payload) {
    return erroResponse(res, 401, 'Acesso nÃƒÂ£o autorizado. FaÃƒÂ§a login novamente.');
  }

  req.usuario = payload;
  return next();
}

app.get('/', (req, res) => {
  return res.json({
    success: true,
    message: 'Backend SIG Integracao Pedidos online.',
    data: {
      api: `http://localhost:${PORT}`,
      health: '/health',
      login: '/auth/login',
      painel: process.env.FRONTEND_URL || 'http://localhost:4200/login',
    },
  });
});

app.post('/auth/login', (req, res) => {
  const tokenInformado = String(req.body?.token || req.body?.password || '').trim();

  if (!tokenInformado || tokenInformado !== PANEL_TOKEN) {
    return erroResponse(res, 401, 'Token invÃƒÂ¡lido.');
  }

  const now = Math.floor(Date.now() / 1000);
  const accessToken = criarToken({
    sub: 'admin',
    usuario: 'admin',
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  });

  return res.json({
    success: true,
    data: {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: TOKEN_TTL_SECONDS,
    },
  });
});

app.use(authMiddleware);

function executarComando(comando, args = [], options = {}) {
  return new Promise((resolve) => {
    execFile(comando, args, { timeout: options.timeout || 8000, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
        error: error?.message || null,
      });
    });
  });
}

async function portaPid(porta) {
  const result = await executarComando('lsof', ['-ti', `:${porta}`], { timeout: 5000 });
  const pids = result.stdout
    ? result.stdout
        .split(/\s+/)
        .map((pid) => pid.trim())
        .filter(Boolean)
    : [];

  return pids;
}

async function statusPorta(porta) {
  const pids = await portaPid(porta);

  return {
    porta,
    online: pids.length > 0,
    pids,
  };
}

function caminhoLog(servico) {
  return path.join(RUNTIME_LOG_DIR, `${servico}.log`);
}

function escreverLog(servico, mensagem) {
  const linha = `[${new Date().toISOString()}] ${mensagem}\n`;
  fs.appendFileSync(caminhoLog(servico), linha);
}

function lerUltimasLinhas(filePath, maxLinhas = 300) {
  if (!fs.existsSync(filePath)) return [];

  const conteudo = fs.readFileSync(filePath, 'utf8');

  return conteudo
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-maxLinhas);
}

function validarServicoScript(chave) {
  const servico = SERVICOS[chave];

  if (!servico || !servico.script) {
    throw new Error('ServiÃƒÂ§o invÃƒÂ¡lido para execuÃƒÂ§ÃƒÂ£o de script.');
  }

  const scriptPath = path.join(SIG_FOLDER, servico.script);

  if (!fs.existsSync(SIG_FOLDER)) {
    throw new Error(`DiretÃƒÂ³rio nÃƒÂ£o encontrado: ${SIG_FOLDER}`);
  }

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script nÃƒÂ£o encontrado: ${scriptPath}`);
  }

  return { servico, scriptPath };
}

function iniciarScript(chave) {
  const { servico, scriptPath } = validarServicoScript(chave);

  if (processos.has(chave)) {
    const atual = processos.get(chave);

    if (!atual.killed) {
      throw new Error(`${servico.nome} jÃƒÂ¡ estÃƒÂ¡ em execuÃƒÂ§ÃƒÂ£o pelo painel. PID: ${atual.pid}`);
    }
  }

  escreverLog(chave, `Iniciando ${servico.nome} via painel. Script: ${scriptPath}`);

  const child = spawn('bash', [scriptPath], {
    cwd: SIG_FOLDER,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  processos.set(chave, child);

  child.stdout.on('data', (data) => escreverLog(chave, `[stdout] ${data.toString().trimEnd()}`));
  child.stderr.on('data', (data) => escreverLog(chave, `[stderr] ${data.toString().trimEnd()}`));
  child.on('error', (error) => escreverLog(chave, `[error] ${error.message}`));
  child.on('close', (code, signal) => {
    escreverLog(chave, `Processo finalizado. code=${code} signal=${signal || '-'}`);
    processos.delete(chave);
  });

  return child;
}

async function queryComTimeout(sql, params = [], ms = 30000) {
  let timer;
  const consulta = pool.query(sql, params);

  const tempoLimite = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Consulta excedeu ${ms / 1000}s`)), ms);
  });

  try {
    return await Promise.race([consulta, tempoLimite]);
  } finally {
    clearTimeout(timer);
  }
}

function parsePagination(req, defaultLimit = 20, maxLimit = 200) {
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || defaultLimit), 1), maxLimit);
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

function extrairDadosPedido(payload) {
  const info = payload?.informacoes || payload || {};

  return {
    origem: info?.integradora || payload?.integradora || null,
    pedidoIntegrador:
      info?.pedidoIntegradora ||
      info?.pedidoCoteFacil ||
      payload?.pedidoIntegradora ||
      payload?.pedidoCoteFacil ||
      null,
    idCampanha:
      info?.IdCampanha ||
      info?.idCampanha ||
      info?.idCampanhaPc ||
      payload?.IdCampanha ||
      payload?.idCampanha ||
      payload?.idCampanhaPc ||
      null,
    cnpjCliente:
      info?.cnpjCliente ||
      info?.CnpjCliente ||
      payload?.CnpjCliente ||
      payload?.cnpjCliente ||
      null,
  };
}

function postJson(urlDestino, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlDestino);
    const body = JSON.stringify(payload);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
        timeout: Number(process.env.PROXY_PEDIDOS_TIMEOUT_MS || 30000),
      },
      (response) => {
        let responseBody = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            text: responseBody,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Tempo limite excedido ao comunicar com endpoint externo.'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function formatarArquivo(file) {
  const campanha = file.name.replace(/\.json$/i, '');

  return {
    nomeArquivo: file.name,
    campanha,
    bucket: BUCKET_NAME,
    tamanhoBytes: Number(file.metadata.size || 0),
    tipo: file.metadata.contentType || 'application/json',
    criadoEm: file.metadata.timeCreated || null,
    atualizadoEm: file.metadata.updated || null,
    geracao: file.metadata.timeCreated || file.metadata.updated || null,
    linkDownload: `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodeURIComponent(
      file.name
    )}?alt=media`,
  };
}

function filtrarArquivos(arquivos, search) {
  const termo = String(search || '').trim().toLowerCase();

  if (!termo) return arquivos;

  return arquivos.filter((item) =>
    Object.values(item).some((valor) => String(valor ?? '').toLowerCase().includes(termo))
  );
}

async function listarArquivosBucket() {
  const [files] = await storage.bucket(BUCKET_NAME).getFiles({ maxResults: 1000 });

  return files
    .filter((file) => file.name.toLowerCase().endsWith('.json'))
    .map(formatarArquivo)
    .sort(
      (a, b) =>
        new Date(b.atualizadoEm || b.criadoEm || 0).getTime() -
        new Date(a.atualizadoEm || a.criadoEm || 0).getTime()
    );
}

async function listarArquivosBucketCached({ force = false } = {}) {
  if (!force && cacheValido(arquivosBucketCache)) {
    return arquivosBucketCache.data;
  }

  const arquivos = await listarArquivosBucket();
  return salvarCache(arquivosBucketCache, arquivos);
}

/* =========================
   HEALTH
========================= */

app.get('/health', async (req, res) => {
  const status = {
    api: 'online',
    banco: 'desconhecido',
    bucket: 'desconhecido',
    bucketName: BUCKET_NAME,
  };

  try {
    await queryComTimeout('SELECT 1 AS ok', [], 5000);
    status.banco = 'conectado';
  } catch (error) {
    status.banco = 'erro';
    status.bancoErro = error.message;
  }

  try {
  await storage.bucket(BUCKET_NAME).getFiles({ maxResults: 1 });
  status.bucket = 'conectado';
} catch (error) {
  status.bucket = 'erro';
  status.bucketErro = error.message;
  console.error('ERRO HEALTH BUCKET:', error.message);
}

  return res.json({
    success: true,
    data: status,
  });
});

/* =========================
   OPERACIONAL / SERVIÃƒâ€¡OS
========================= */

app.get('/servicos/status', authMiddleware, async (req, res) => {
  try {
    const payload = await consultarStatusServicos({
      force: String(req.query.force || 'false') === 'true',
      detectarQueda: false,
    });

    return res.json({
      success: true,
      data: payload.data,
      meta: {
        cache: !!payload.cache,
        stale: !!payload.stale,
        pendingRefresh: !!payload.pendingRefresh,
        cacheAgeMs: payload.cacheAgeMs || 0,
        atualizadoEm: payload.atualizadoEm,
      },
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao consultar status dos serviÃƒÂ§os', error);
  }
});

app.post('/servicos/geracao/start', authMiddleware, async (req, res) => {
  try {
    const contextoExecucao = criarContextoExecucaoPainel(req, 'geracao');
    const result = await executarScript(process.env.SCRIPT_GERACAO || 'executa_script.sh', contextoExecucao);
    registrarExecucaoPainel('geracao', contextoExecucao, result);
    invalidarCacheStatusServicos();
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'geracao',
      mensagem: 'GeraÃƒÂ§ÃƒÂ£o iniciada pelo painel.',
      detalhe: result,
    });
    registrarInicioServico(req, 'geracao', result);

    return res.json({
      success: true,
      message: 'GeraÃƒÂ§ÃƒÂ£o iniciada com sucesso',
      data: result,
    });
  } catch (error) {
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'geracao',
      status: 'ERRO',
      mensagem: 'Erro ao iniciar geraÃƒÂ§ÃƒÂ£o.',
      detalhe: error.stack || error.message,
    });
    registrarErroInicioServico(req, 'geracao', error);
    

    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar geraÃƒÂ§ÃƒÂ£o',
      error: error.message,
    });
  }
});

app.post('/servicos/geracao/iniciar', authMiddleware, async (req, res) => {
  try {
    const contextoExecucao = criarContextoExecucaoPainel(req, 'geracao');
    const result = await executarScript(process.env.SCRIPT_GERACAO || 'executa_script.sh', contextoExecucao);
    registrarExecucaoPainel('geracao', contextoExecucao, result);
    invalidarCacheStatusServicos();
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'geracao',
      mensagem: 'GeraÃƒÂ§ÃƒÂ£o iniciada pelo painel.',
      detalhe: result,
    });
    registrarInicioServico(req, 'geracao', result);

    return res.json({
      success: true,
      message: 'GeraÃƒÂ§ÃƒÂ£o iniciada com sucesso',
      data: result,
    });
  } catch (error) {
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'geracao',
      status: 'ERRO',
      mensagem: 'Erro ao iniciar geraÃƒÂ§ÃƒÂ£o.',
      detalhe: error.stack || error.message,
    });
    registrarErroInicioServico(req, 'geracao', error);
  

    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar geraÃƒÂ§ÃƒÂ£o',
      error: error.message,
    });
  }
});

app.post('/servicos/exclusao/start', authMiddleware, async (req, res) => {
  try {
    const contextoExecucao = criarContextoExecucaoPainel(req, 'exclusao');
    const result = await executarScript(process.env.SCRIPT_EXCLUSAO || 'executa_exclusao_script.sh', contextoExecucao);
    registrarExecucaoPainel('exclusao', contextoExecucao, result);
    invalidarCacheStatusServicos();
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'exclusao',
      mensagem: 'ExclusÃƒÂ£o iniciada pelo painel.',
      detalhe: result,
    });
    registrarInicioServico(req, 'exclusao', result);

    return res.json({
      success: true,
      message: 'ExclusÃƒÂ£o iniciada com sucesso',
      data: result,
    });
  } catch (error) {
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'exclusao',
      status: 'ERRO',
      mensagem: 'Erro ao iniciar exclusÃƒÂ£o.',
      detalhe: error.stack || error.message,
    });
    registrarErroInicioServico(req, 'exclusao', error);

    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar exclusÃƒÂ£o',
      error: error.message,
    });
  }
});

app.post('/servicos/exclusao/iniciar', authMiddleware, async (req, res) => {
  try {
    const contextoExecucao = criarContextoExecucaoPainel(req, 'exclusao');
    const result = await executarScript(process.env.SCRIPT_EXCLUSAO || 'executa_exclusao_script.sh', contextoExecucao);
    registrarExecucaoPainel('exclusao', contextoExecucao, result);
    invalidarCacheStatusServicos();
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'exclusao',
      mensagem: 'ExclusÃƒÂ£o iniciada pelo painel.',
      detalhe: result,
    });
    registrarInicioServico(req, 'exclusao', result);

    return res.json({
      success: true,
      message: 'ExclusÃƒÂ£o iniciada com sucesso',
      data: result,
    });
  } catch (error) {
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'exclusao',
      status: 'ERRO',
      mensagem: 'Erro ao iniciar exclusÃƒÂ£o.',
      detalhe: error.stack || error.message,
    });
    registrarErroInicioServico(req, 'exclusao', error);

    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar exclusÃƒÂ£o',
      error: error.message,
    });
  }
});

app.post('/servicos/pedidos/start', authMiddleware, async (req, res) => {
  try {
    const contextoExecucao = criarContextoExecucaoPainel(req, 'pedidos');
    const result = await executarJar(SERVICOS.pedidos.jar, 'pedidos', contextoExecucao);
    registrarExecucaoPainel('pedidos', contextoExecucao, result);
    invalidarCacheStatusServicos();
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'pedidos',
      mensagem: 'API de pedidos iniciada pelo painel.',
      detalhe: result,
    });
    registrarInicioServico(req, 'pedidos', result);

    return res.json({
      success: true,
      message: 'API de pedidos iniciada com sucesso',
      data: result,
    });
  } catch (error) {
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'pedidos',
      status: 'ERRO',
      mensagem: 'Erro ao iniciar API de pedidos.',
      detalhe: error.stack || error.message,
    });
    registrarErroInicioServico(req, 'pedidos', error);

    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar API de pedidos',
      error: error.message,
    });
  }
});

app.post('/servicos/pedidos/iniciar', authMiddleware, async (req, res) => {
  try {
    const contextoExecucao = criarContextoExecucaoPainel(req, 'pedidos');
    const result = await executarJar(SERVICOS.pedidos.jar, 'pedidos', contextoExecucao);
    registrarExecucaoPainel('pedidos', contextoExecucao, result);
    invalidarCacheStatusServicos();
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'pedidos',
      mensagem: 'API de pedidos iniciada pelo painel.',
      detalhe: result,
    });
    registrarInicioServico(req, 'pedidos', result);

    return res.json({
      success: true,
      message: 'API de pedidos iniciada com sucesso',
      data: result,
    });
  } catch (error) {
    registrarAcaoPainelSeguro({
      req,
      acao: 'INICIAR_SERVICO',
      alvo: 'pedidos',
      status: 'ERRO',
      mensagem: 'Erro ao iniciar API de pedidos.',
      detalhe: error.stack || error.message,
    });
    registrarErroInicioServico(req, 'pedidos', error);

    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar API de pedidos',
      error: error.message,
    });
  }
});

app.post('/servicos/:servico/stop', authMiddleware, async (req, res) => {
  try {
    const chave = req.params.servico;
    const servico = SERVICOS[chave];

    if (!servico) {
      return erroResponse(res, 400, 'ServiÃƒÂ§o invÃƒÂ¡lido.');
    }

    const target = alvoServico(chave);

    const pidsAntes = await safePidsServico(chave);

    ultimoEventoManual[chave] = Date.now();

    const pidsEncerrados = await matarPidsPorPorta(servico.porta, target);

    invalidarCacheStatusServicos();

    await new Promise((resolve) => setTimeout(resolve, 900));

    const pidsDepois = await safePidsServico(chave);

    escreverLog(
      chave,
      `Parada solicitada pelo painel. ServiÃƒÂ§o=${chave}, target=${target}, porta=${servico.porta}, PIDs antes=${
        pidsAntes.join(', ') || '-'
      }, PIDs encerrados=${(pidsEncerrados || []).join(', ') || '-'}, PIDs depois=${
        pidsDepois.join(', ') || '-'
      }`
    );
    registrarAcaoPainelSeguro({
      req,
      acao: 'PARAR_SERVICO',
      alvo: chave,
      mensagem: pidsAntes.length
        ? pidsDepois.length
          ? 'Parada solicitada, mas ainda existem processos ativos.'
          : 'ServiÃƒÂ§o parado com sucesso.'
        : 'Nenhum processo ativo encontrado para parar.',
      detalhe: {
        target,
        porta: servico.porta,
        servidor: servidorServico(chave),
        pidsAntes,
        pidsEncerrados,
        pidsDepois,
      },
    });
    registrarServicoLogSeguro(eventoServicoPayload(chave, {
      req,
      tipo: 'PARAR_SERVICO',
      status: pidsAntes.length && pidsDepois.length ? 'ALERTA' : 'SUCESSO',
      mensagem: pidsAntes.length
        ? pidsDepois.length
          ? 'Parada solicitada, mas ainda existem processos ativos.'
          : 'ServiÃƒÂ§o parado com sucesso.'
        : 'Nenhum processo ativo encontrado para parar.',
      detalhe: {
        target,
        porta: servico.porta,
        servidor: servidorServico(chave),
        pidsAntes,
        pidsEncerrados,
        pidsDepois,
      },
      pid: pidsEncerrados,
    }));

    if (ALERT_EMAIL_ON_MANUAL_STOP && pidsAntes.length > 0) {
      enviarAlertaOperacional({
        servico: servico.nome,
        tipo: 'SERVICO_PARADO_MANUALMENTE',
        severidade: 'INFO',
        mensagem: `ServiÃƒÂ§o ${servico.nome} parado manualmente pelo painel.`,
        detalhe: `PIDs antes: ${pidsAntes.join(', ') || '-'} | PIDs encerrados: ${
          (pidsEncerrados || []).join(', ') || '-'
        } | PIDs depois: ${pidsDepois.join(', ') || '-'}`,
        servidor: servidorServico(chave),
        porta: servico.porta,
        assunto: `ServiÃƒÂ§o parado manualmente - ${servico.nome}`,
      }).catch((error) => {
        console.error('Falha ao registrar/enviar alerta de parada manual:', error.message);
      });
    }

    return res.json({
      success: true,
      message: pidsAntes.length
        ? pidsDepois.length
          ? 'Parada solicitada, mas ainda existem processos ativos. Aguarde e atualize novamente.'
          : 'ServiÃƒÂ§o parado com sucesso.'
        : 'Nenhum processo ativo encontrado para parar.',
      data: {
        servico: chave,
        porta: servico.porta,
        servidor: servidorServico(chave),
        pidsAntes,
        pidsEncerrados: pidsEncerrados || [],
        pidsDepois,
        online: pidsDepois.length > 0,
      },
    });
  } catch (error) {
    registrarAcaoPainelSeguro({
      req,
      acao: 'PARAR_SERVICO',
      alvo: req.params.servico,
      status: 'ERRO',
      mensagem: 'Erro ao parar serviÃƒÂ§o.',
      detalhe: error.stack || error.message,
    });
    registrarServicoLogSeguro(eventoServicoPayload(req.params.servico, {
      req,
      tipo: 'PARAR_SERVICO',
      status: 'ERRO',
      mensagem: 'Erro ao parar serviÃƒÂ§o.',
      detalhe: error.stack || error.message,
    }));

    return erroResponse(res, 500, 'Erro ao parar serviÃƒÂ§o', error);
  }
});

app.get('/servicos/:servico/script', authMiddleware, async (req, res) => {
  try {
    const chave = req.params.servico;
    const servico = SERVICOS[chave];

    if (!servico) {
      return erroResponse(res, 400, 'Servico invalido.');
    }

    if (!servico.script) {
      return erroResponse(res, 400, 'Servico sem script editavel.');
    }

    const target = alvoServico(chave);
    const data = await lerArquivoScript(servico.script, target);

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao ler script do servico', error);
  }
});

app.post('/servicos/:servico/script', authMiddleware, async (req, res) => {
  try {
    const chave = req.params.servico;
    const servico = SERVICOS[chave];
    const content = String(req.body?.content ?? '');

    if (!servico) {
      return erroResponse(res, 400, 'Servico invalido.');
    }

    if (!servico.script) {
      return erroResponse(res, 400, 'Servico sem script editavel.');
    }

    if (!content.trim()) {
      return erroResponse(res, 400, 'Conteudo do script nao pode ficar vazio.');
    }

    const target = alvoServico(chave);
    const data = await salvarArquivoScript(servico.script, content, target);

    registrarAcaoPainelSeguro({
      req,
      acao: 'EDITAR_SCRIPT_SERVICO',
      alvo: chave,
      mensagem: `Script do servico ${chave} atualizado pelo painel.`,
      detalhe: {
        script: servico.script,
        path: data.path,
        backupPath: data.backupPath,
        target,
      },
    });
    registrarServicoLogSeguro(eventoServicoPayload(chave, {
      req,
      tipo: 'EDITAR_SCRIPT',
      status: 'SUCESSO',
      mensagem: `Script ${servico.script} atualizado pelo painel.`,
      detalhe: {
        path: data.path,
        backupPath: data.backupPath,
        target,
      },
    }));

    return res.json({
      success: true,
      message: 'Script salvo com sucesso.',
      data,
    });
  } catch (error) {
    registrarAcaoPainelSeguro({
      req,
      acao: 'EDITAR_SCRIPT_SERVICO',
      alvo: req.params.servico,
      status: 'ERRO',
      mensagem: 'Erro ao salvar script do servico.',
      detalhe: error.stack || error.message,
    });

    return erroResponse(res, 500, 'Erro ao salvar script do servico', error);
  }
});

app.get('/servicos/:servico/logs', authMiddleware, async (req, res) => {
  try {
    const servico = req.params.servico;
    const limit = Number(req.query.limit || req.query.linhas || 300);
    const force = String(req.query.force || 'false') === 'true';
    const dias = Math.min(Math.max(Number(req.query.dias || 0), 0), 30);
    const search = String(req.query.search || req.query.q || '').trim();
    const contextoExecucao = contextoLogServico(req, servico);
    const executionId = contextoExecucao?.executionId || 'ultimo';
    const cacheKey = `${servico}:${limit}:${executionId}:${dias}:${search}`;
    const cache = logsServicosCache[cacheKey];

    let scriptName;

    if (servico === 'geracao') {
      scriptName = process.env.SCRIPT_GERACAO || 'executa_script.sh';
    } else if (servico === 'exclusao') {
      scriptName = process.env.SCRIPT_EXCLUSAO || 'executa_exclusao_script.sh';
    } else if (servico === 'pedidos') {
      scriptName = SERVICOS.pedidos.jar;
    } else {
      return res.status(400).json({
        success: false,
        message: 'ServiÃƒÂ§o invÃƒÂ¡lido',
      });
    }

    const target = servico === 'pedidos' ? 'pedidos' : 'files';
    const agora = Date.now();

    if (!force && cache?.content && agora - cache.updatedAt < LOGS_CACHE_TTL_MS) {
      registrarServicoLogSeguro(eventoServicoPayload(servico, {
        req,
        tipo: 'CONSULTA_LOG',
        status: 'INFO',
        mensagem: `Log do serviÃƒÂ§o consultado pelo painel a partir do cache (${limit} linhas).`,
        detalhe: {
          linhas: cache.content.split('\n').filter(Boolean).length,
          target,
          limit,
          cache: true,
          cacheAgeMs: agora - cache.updatedAt,
        },
      }));

      return res.json({
        success: true,
        data: cache.content.split('\n'),
        content: cache.content,
        meta: {
          cache: true,
          cacheAgeMs: agora - cache.updatedAt,
          atualizadoEm: cache.atualizadoEm,
          executionId: contextoExecucao?.executionId || null,
          marker: contextoExecucao?.marker || null,
          logPath: contextoExecucao?.logPath || null,
          logSource: contextoExecucao?.logSource || null,
          dias,
          search: search || null,
        },
      });
    }

    const content = await lerLogRemoto(scriptName, limit, target, {
      ...(contextoExecucao || {}),
      dias,
      search,
    });
    registrarServicoLogSeguro(eventoServicoPayload(servico, {
      req,
      tipo: 'CONSULTA_LOG',
      status: detectarErroLog(content) ? 'ALERTA' : 'SUCESSO',
      mensagem: `Log do serviÃƒÂ§o consultado pelo painel (${limit} linhas).`,
      detalhe: {
        linhas: content.split('\n').filter(Boolean).length,
        target,
        limit,
        contemErro: detectarErroLog(content),
      },
    }));
    logsServicosCache[cacheKey] = {
      content,
      updatedAt: Date.now(),
      atualizadoEm: new Date().toISOString(),
    };

    return res.json({
      success: true,
      data: content.split('\n'),
      content,
      meta: {
        cache: false,
        cacheAgeMs: 0,
        atualizadoEm: logsServicosCache[cacheKey].atualizadoEm,
        executionId: contextoExecucao?.executionId || null,
        marker: contextoExecucao?.marker || null,
        logPath: contextoExecucao?.logPath || null,
        logSource: contextoExecucao?.logSource || null,
        dias,
        search: search || null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao ler log do serviÃƒÂ§o',
      error: error.message,
    });
  }
});

app.get('/servicos/logs/eventos', authMiddleware, async (req, res) => {
  try {
    const payload = await listarServicosLogs({
      page: req.query.page,
      limit: req.query.limit,
      servico: req.query.servico,
      tipo: req.query.tipo,
      status: req.query.status,
      search: req.query.search,
      dataInicio: req.query.dataInicio || req.query.dataInicial || req.query.inicio,
      dataFim: req.query.dataFim || req.query.dataFinal || req.query.fim,
    });

    return res.json({
      success: true,
      data: payload.rows,
      meta: payload.meta,
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao buscar eventos dos serviÃƒÂ§os', error);
  }
});

app.get('/pedidos/log-erros', authMiddleware, async (req, res) => {
  try {
    const linhas = Math.min(Math.max(Number(req.query.linhas || req.query.limit || 300), 50), 1000);
    const force = String(req.query.force || 'false') === 'true';
    const somenteErros = String(req.query.somenteErros ?? 'true').toLowerCase() !== 'false';
    const search = String(req.query.search || '').trim();
    const rastreio = String(req.query.rastreio || '').trim();
    const cacheKey = JSON.stringify({ linhas, somenteErros, search, rastreio });
    const cache = pedidosApiLogsCache[cacheKey];
    const agora = Date.now();

    if (!force && cache?.data && agora - cache.updatedAt < LOGS_CACHE_TTL_MS) {
      return res.json({
        success: true,
        data: cache.data.linhas,
        content: cache.data.content,
        arquivo: cache.data.arquivo,
        meta: {
          ...cache.data.meta,
          cache: true,
          atualizadoEm: cache.atualizadoEm,
          cacheAgeMs: agora - cache.updatedAt,
        },
      });
    }

    const payload = await lerLogErrosPedidos({
      linhas,
      somenteErros,
      search,
      rastreio,
    });

    pedidosApiLogsCache[cacheKey] = {
      data: payload,
      updatedAt: agora,
      atualizadoEm: new Date().toISOString(),
    };

    registrarServicoLogSeguro(eventoServicoPayload('pedidos', {
      req,
      tipo: 'CONSULTA_LOG_API_PEDIDOS',
      status: payload.arquivo?.existe ? 'INFO' : 'ALERTA',
      mensagem: payload.arquivo?.existe
        ? `Log de erros da API de pedidos consultado (${payload.linhas.length} linhas).`
        : 'Log de erros da API de pedidos nao encontrado.',
      detalhe: {
        arquivo: payload.arquivo,
        linhas: payload.linhas.length,
        somenteErros,
        search: search || null,
        rastreio: rastreio || null,
      },
    }));

    return res.json({
      success: true,
      data: payload.linhas,
      content: payload.content,
      arquivo: payload.arquivo,
      meta: {
        ...payload.meta,
        cache: false,
        atualizadoEm: pedidosApiLogsCache[cacheKey].atualizadoEm,
      },
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao ler log de erros da API de pedidos', error);
  }
});

app.get('/servicos/:servico/logs/stream', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const payload = validarToken(token);

  if (!payload) {
    return erroResponse(res, 401, 'Acesso nao autorizado. Faca login novamente.');
  }

  const chave = req.params.servico;

  if (!SERVICOS[chave]) {
    return erroResponse(res, 400, 'ServiÃƒÂ§o invÃƒÂ¡lido.');
  }

  const scriptName = scriptOuJarServico(chave);

  if (!scriptName) {
    return erroResponse(res, 400, 'ServiÃƒÂ§o sem script ou JAR configurado.');
  }

  const target = targetServicoLog(chave);
  const linhasStream = Math.min(Math.max(Number(req.query.linhas || 300), 80), 800);
  const contextoExecucao = contextoLogServico(req, chave);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let fechado = false;
  let linhasAnteriores = [];

  const enviar = (data) => {
    if (!fechado) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  const lerEnviar = async (tipo = 'append') => {
    try {
      const content = await lerLogRemoto(scriptName, linhasStream, target, contextoExecucao || {});
      const linhasAtuais = String(content || '').split(/\r?\n/).filter(Boolean);

      if (tipo === 'init') {
        linhasAnteriores = linhasAtuais;
        enviar({
          tipo: 'init',
          linhas: linhasAtuais,
          meta: {
            target,
            linhas: linhasAtuais.length,
            atualizadoEm: new Date().toISOString(),
            executionId: contextoExecucao?.executionId || null,
            marker: contextoExecucao?.marker || null,
            logPath: contextoExecucao?.logPath || null,
            logSource: contextoExecucao?.logSource || null,
          },
        });
        return;
      }

      const assinaturaAnterior = linhasAnteriores.join('\n');
      const assinaturaAtual = linhasAtuais.join('\n');

      if (assinaturaAtual && assinaturaAtual !== assinaturaAnterior) {
        const novasLinhas = calcularNovasLinhas(linhasAnteriores, linhasAtuais);
        linhasAnteriores = linhasAtuais;

        enviar({
          tipo: 'append',
          novasLinhas: novasLinhas.length === linhasAtuais.length ? [] : novasLinhas,
          linhas: novasLinhas.length === linhasAtuais.length ? linhasAtuais : undefined,
          meta: {
            target,
            linhas: linhasAtuais.length,
            atualizadoEm: new Date().toISOString(),
            executionId: contextoExecucao?.executionId || null,
            marker: contextoExecucao?.marker || null,
            logPath: contextoExecucao?.logPath || null,
            logSource: contextoExecucao?.logSource || null,
          },
        });
      }
    } catch (error) {
      enviar({
        tipo: 'erro',
        mensagem: error.message,
      });
    }
  };

  await lerEnviar('init');

  const interval = setInterval(() => {
    lerEnviar().catch((error) => {
      enviar({
        tipo: 'erro',
        mensagem: error.message,
      });
    });
  }, Number(process.env.LOG_STREAM_INTERVAL_MS || 1200));

  req.on('close', () => {
    fechado = true;
    clearInterval(interval);
  });
});

/* =========================
   CRONTAB
========================= */

app.get('/cron', authMiddleware, async (req, res) => {
  try {
    const data = await lerCrontab();

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao ler crontab',
      error: error.message,
    });
  }
});

app.get('/cron/logs/diagnostico', authMiddleware, async (req, res) => {
  try {
    const data = await diagnosticarLogsCrontab(SERVICOS);

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao diagnosticar logs do crontab', error);
  }
});

app.get('/cron/logs', authMiddleware, async (req, res) => {
  try {
    const linhas = Number(req.query.linhas || req.query.limit || 200);
    const force = String(req.query.force || 'false') === 'true';
    const dias = Math.min(Math.max(Number(req.query.dias || 0), 0), 30);
    const search = String(req.query.search || req.query.q || '').trim();
    const cacheKey = `cron:${linhas}:${dias}:${search}`;
    const cache = logsCronCache[cacheKey];
    const agora = Date.now();

    if (!force && cache?.data && agora - cache.updatedAt < CRON_LOGS_CACHE_TTL_MS) {
      return res.json({
        success: true,
        data: cache.data,
        meta: {
          cache: true,
          cacheAgeMs: agora - cache.updatedAt,
          atualizadoEm: cache.atualizadoEm,
        },
      });
    }

    const data = await lerLogsCrontab(SERVICOS, linhas, { dias, search });
    logsCronCache[cacheKey] = {
      data,
      updatedAt: Date.now(),
      atualizadoEm: new Date().toISOString(),
    };

    return res.json({
      success: true,
      data,
      meta: {
        cache: false,
        cacheAgeMs: 0,
        atualizadoEm: logsCronCache[cacheKey].atualizadoEm,
      },
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao ler logs do crontab', error);
  }
});

app.post('/cron', authMiddleware, async (req, res) => {
  try {
    const content = req.body.content ?? req.body.crontab ?? '';

    await salvarCrontab(content);
    registrarAcaoPainelSeguro({
      req,
      acao: 'SALVAR_CRON',
      alvo: 'crontab',
      mensagem: 'Crontab salvo pelo painel.',
      detalhe: {
        linhas: String(content || '').split(/\r?\n/).length,
      },
    });

    return res.json({
      success: true,
      message: 'Crontab salvo com sucesso',
    });
  } catch (error) {
    registrarAcaoPainelSeguro({
      req,
      acao: 'SALVAR_CRON',
      alvo: 'crontab',
      status: 'ERRO',
      mensagem: 'Erro ao salvar crontab.',
      detalhe: error.stack || error.message,
    });

    return res.status(500).json({
      success: false,
      message: 'Erro ao salvar crontab',
      error: error.message,
    });
  }
});

app.get('/painel/acoes', authMiddleware, async (req, res) => {
  try {
    const data = await listarAcoesPainel({
      limit: req.query.limit,
      acao: req.query.acao,
      status: req.query.status,
    });

    return res.json({
      success: true,
      data,
      meta: {
        total: data.length,
      },
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao listar aÃƒÂ§ÃƒÂµes do painel', error);
  }
});

/* =========================
   DASHBOARD
========================= */

const REDES_ALIAS = {
  redecomprecerto: 'Grupo Compre Certo',
  drogarede: 'Droga Rede',
  nossarede: 'Nossa Rede',
  farmelhor: 'FarMelhor',
  redefarma: 'RedeFarma',
  redemgfarma: 'Rede MG Farma',
  mercaweb: 'Merca Web',
  vidafarmacias: 'Vida FarmÃƒÂ¡cias',
  grupoadmpharma: 'Grupo ADM Pharma',
};

function agruparPedidosPorRede(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const alias = row.rede_alias;
    const nome = row.rede_nome;

    if (!alias || !nome) continue;

    const atual = map.get(alias) || {
      alias,
      rede: nome,
      total: 0,
    };

    atual.total += Number(row.total || 0);
    map.set(alias, atual);
  }

  return Array.from(map.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

function agruparPedidosPorLoja(rows = []) {
  return rows
    .map((row) => ({
      alias: row.rede_alias,
      rede: row.rede_nome,
      farCodigo: row.far_codigo,
      loja: row.loja,
      cnpj: row.cnpj,
      total: Number(row.total || 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

app.get('/dashboard', async (req, res) => {
  try {
    const force = String(req.query.force || 'false') === 'true';
    const pedidoDatas = filtrosData(req, 'dataPedido');
    const logDatas = filtrosData(req, 'criado_em');
    const dataInicial = pedidoDatas.inicio;
    const dataFinal = pedidoDatas.fim;
    const params = pedidoDatas.params;
    const where = pedidoDatas.where.length ? `WHERE ${pedidoDatas.where.join(' AND ')}` : '';
    const whereLogs = logDatas.where.length ? `AND ${logDatas.where.join(' AND ')}` : '';

    const bucketPromise = !force && cacheValido(dashboardCache.bucket)
      ? Promise.resolve(dashboardCache.bucket.data)
      : listarArquivosBucket()
          .then((arquivos) => {
            const data = {
              bucketOnline: true,
              bucketErro: null,
              totalArquivos: Array.isArray(arquivos) ? arquivos.length : 0,
            };

            return salvarCache(dashboardCache.bucket, data);
          })
          .catch((error) => ({
            bucketOnline: false,
            bucketErro: error.message,
            totalArquivos: dashboardCache.bucket.data?.totalArquivos || 0,
          }));

    const redeLojaCacheKey = `${dataInicial || ''}:${dataFinal || ''}`;
    const redeLojaPromise = !force && cacheValido(dashboardCache.redeLoja) && dashboardCache.redeLoja.key === redeLojaCacheKey
      ? Promise.resolve(dashboardCache.redeLoja.data)
      : queryComTimeout(
          `
          SELECT
            base.rede_alias,
            base.rede_nome,
            base.far_codigo,
            base.loja,
            p.CnpjCliente AS cnpj,
            COUNT(*) AS total
          FROM pedidoconfirmaintegracao p
          INNER JOIN (
            SELECT 'redecomprecerto' AS rede_alias, 'Grupo Compre Certo' AS rede_nome, FAR_CODIGO AS far_codigo, FAR_NOME AS loja, FAR_CNPJ AS cnpj
            FROM redecomprecerto.farmacias

            UNION ALL
            SELECT 'drogarede', 'Droga Rede', FAR_CODIGO, FAR_NOME, FAR_CNPJ
            FROM drogarede.farmacias

            UNION ALL
            SELECT 'nossarede', 'Nossa Rede', FAR_CODIGO, FAR_NOME, FAR_CNPJ
            FROM nossarede.farmacias

            UNION ALL
            SELECT 'farmelhor', 'FarMelhor', FAR_CODIGO, FAR_NOME, FAR_CNPJ
            FROM farmelhor.farmacias

            UNION ALL
            SELECT 'redefarma', 'RedeFarma', FAR_CODIGO, FAR_NOME, FAR_CNPJ
            FROM redefarma.farmacias

            UNION ALL
            SELECT 'redemgfarma', 'Rede MG Farma', FAR_CODIGO, FAR_NOME, FAR_CNPJ
            FROM redemgfarma.farmacias

            UNION ALL
            SELECT 'mercaweb', 'Merca Web', FAR_CODIGO, FAR_NOME, FAR_CNPJ
            FROM mercaweb.farmacias

            UNION ALL
            SELECT 'vidafarmacias', 'Vida FarmÃƒÂ¡cias', FAR_CODIGO, FAR_NOME, FAR_CNPJ
            FROM vidafarmacias.farmacias

            UNION ALL
            SELECT 'grupoadmpharma', 'Grupo ADM Pharma', FAR_CODIGO, FAR_NOME, FAR_CNPJ
            FROM grupoadmpharma.farmacias
          ) base
            ON REPLACE(REPLACE(REPLACE(base.cnpj, '.', ''), '/', ''), '-', '') =
               REPLACE(REPLACE(REPLACE(p.CnpjCliente, '.', ''), '/', ''), '-', '')
          ${where}
          GROUP BY
            base.rede_alias,
            base.rede_nome,
            base.far_codigo,
            base.loja,
            p.CnpjCliente
          ORDER BY total DESC
          LIMIT 200
          `,
          params
        )
          .then((result) => {
            const linhas = Array.isArray(result?.[0]) ? result[0] : result;

            const data = {
              porRede: agruparPedidosPorRede(linhas || []),
              porLoja: agruparPedidosPorLoja(linhas || []),
            };

            return salvarCache(dashboardCache.redeLoja, data, { key: redeLojaCacheKey });
          })
          .catch(() => {
            return dashboardCache.redeLoja.data || {
              porRede: [],
              porLoja: [],
            };
          });

    const [
      bucketResult,
      redeLojaResult,
      totalPedidosResult,
      pedidosHojeResult,
      ultimaMovimentacaoResult,
      porIntegradoraResult,
      logsErroResult,
      alertasRecentesResult,
    ] = await Promise.allSettled([
      bucketPromise,
      redeLojaPromise,

      queryComTimeout(
        `SELECT COUNT(*) AS total FROM pedidoconfirmaintegracao ${where}`,
        params
      ),

      queryComTimeout(`
        SELECT COUNT(*) AS total
        FROM pedidoconfirmaintegracao
        WHERE DATE(dataPedido) = CURDATE()
      `),

      queryComTimeout(
        `SELECT MAX(dataPedido) AS ultimaData FROM pedidoconfirmaintegracao ${where}`,
        params
      ),

      queryComTimeout(
        `
        SELECT integradora, COUNT(*) AS total
        FROM pedidoconfirmaintegracao
        ${where}
        GROUP BY integradora
        ORDER BY total DESC
        LIMIT 6
        `,
        params
      ),

      queryComTimeout(`
        SELECT COUNT(*) AS total
        FROM log_integracao_pedidos
        WHERE status = 'ERRO'
        ${whereLogs}
      `, logDatas.params),

      listarAlertas({ limit: 8 }),
    ]);

    const linhasQuery = (result) => {
      if (result.status !== 'fulfilled') return [];

      if (Array.isArray(result.value?.[0])) {
        return result.value[0];
      }

      if (Array.isArray(result.value)) {
        return result.value;
      }

      return [];
    };

    const primeiraLinha = (result) => linhasQuery(result)[0] || {};

    const bucketData =
      bucketResult.status === 'fulfilled'
        ? bucketResult.value
        : {
            bucketOnline: false,
            bucketErro: bucketResult.reason?.message || 'Erro bucket',
            totalArquivos: 0,
          };

    const redeLojaData =
      redeLojaResult.status === 'fulfilled'
        ? redeLojaResult.value
        : {
            porRede: [],
            porLoja: [],
          };

    const statusServicosPayload = await consultarStatusServicos({
      force: false,
      detectarQueda: false,
    });
    const servicosLista = Object.values(statusServicosPayload.data || {});
    const totalServicos = servicosLista.length;
    const servicosOnline = servicosLista.filter((servico) => servico?.online).length;
    const totalPedidos = Number(primeiraLinha(totalPedidosResult).total || 0);
    const totalErros = Number(primeiraLinha(logsErroResult).total || 0);

    return res.json({
      success: true,
      data: {
        status: 'Online',
        bucket: BUCKET_NAME,
        bucketOnline: bucketData.bucketOnline,
        bucketErro: bucketData.bucketErro,
        totalArquivos: bucketData.totalArquivos,

        totalPedidos,
        pedidosHoje: primeiraLinha(pedidosHojeResult).total || 0,
        ultimaMovimentacao: primeiraLinha(ultimaMovimentacaoResult).ultimaData || null,
        totalErros,
        taxaErro: totalPedidos ? Number(((totalErros / totalPedidos) * 100).toFixed(2)) : 0,
        servicosOnline,
        totalServicos,

        porIntegradora: linhasQuery(porIntegradoraResult),
        porRede: redeLojaData.porRede,
        porLoja: redeLojaData.porLoja,

        alertasRecentes:
          alertasRecentesResult.status === 'fulfilled'
            ? alertasRecentesResult.value || []
            : [],

        servicos: statusServicosPayload.data,

        filtros: {
          dataInicial,
          dataFinal,
        },
      },
    });
  } catch (error) {
    console.error('Erro na rota /dashboard:', error);
    return erroResponse(res, 500, 'Erro ao carregar dashboard', error);
  }
});

/* =========================
   ARQUIVOS DO BUCKET
========================= */

app.get('/arquivos', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req, 20, 200);
    const arquivos = filtrarArquivos(
      await listarArquivosBucketCached({ force: String(req.query.force || 'false') === 'true' }),
      req.query.search
    );

    return res.json({
      success: true,
      data: arquivos.slice(offset, offset + limit),
      meta: {
        page,
        limit,
        total: arquivos.length,
        totalPages: Math.max(1, Math.ceil(arquivos.length / limit)),
      },
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao listar arquivos do bucket', error);
  }
});

app.get('/arquivos/:nomeArquivo/preview', async (req, res) => {
  try {
    const nomeArquivo = decodeURIComponent(req.params.nomeArquivo || '');

    if (!nomeArquivo.toLowerCase().endsWith('.json')) {
      return erroResponse(res, 400, 'Arquivo invÃƒÂ¡lido');
    }

    const file = storage.bucket(BUCKET_NAME).file(nomeArquivo);
    const [exists] = await file.exists();

    if (!exists) {
      return erroResponse(res, 404, 'Arquivo nÃƒÂ£o encontrado no bucket');
    }

    const [buffer] = await file.download();
    const conteudo = buffer.toString('utf8');

    let json;

    try {
      json = JSON.parse(conteudo);
    } catch {
      json = conteudo;
    }

    return res.json({
      success: true,
      data: {
        nomeArquivo,
        conteudo: json,
      },
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao visualizar arquivo', error);
  }
});

app.delete('/arquivos/:nomeArquivo', async (req, res) => {
  try {
    const nomeArquivo = decodeURIComponent(req.params.nomeArquivo || '');

    if (!nomeArquivo.toLowerCase().endsWith('.json')) {
      return erroResponse(res, 400, 'Arquivo invÃƒÂ¡lido');
    }

    const file = storage.bucket(BUCKET_NAME).file(nomeArquivo);
    const [exists] = await file.exists();

    if (!exists) {
      return erroResponse(res, 404, 'Arquivo nÃƒÂ£o encontrado no bucket');
    }

    await file.delete();
    registrarAcaoPainelSeguro({
      req,
      acao: 'EXCLUIR_ARQUIVO',
      alvo: nomeArquivo,
      mensagem: 'Arquivo excluÃƒÂ­do pelo painel.',
      detalhe: {
        bucket: BUCKET_NAME,
        nomeArquivo,
      },
    });

    return res.json({
      success: true,
      message: 'Arquivo excluÃƒÂ­do com sucesso',
      data: {
        nomeArquivo,
      },
    });
  } catch (error) {
    registrarAcaoPainelSeguro({
      req,
      acao: 'EXCLUIR_ARQUIVO',
      alvo: req.params.nomeArquivo,
      status: 'ERRO',
      mensagem: 'Erro ao excluir arquivo.',
      detalhe: error.stack || error.message,
    });

    return erroResponse(res, 500, 'Erro ao excluir arquivo');
  }
});

/* =========================
   PEDIDOS INSERIDOS
========================= */

app.get('/pedidos', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req, 20, 200);
    const params = [];
    const where = [];
    const datas = filtrosData(req, 'data_hora');

    if (req.query.search) {
      const like = `%${req.query.search}%`;
      where.push(`(
        numero_carrinho LIKE ? OR pedido_integrador LIKE ? OR cotacao_integrador LIKE ? OR pedido_cliente LIKE ? OR
        cnpj_cliente LIKE ? OR cnpj_distribuidor LIKE ? OR id_campanha LIKE ? OR id_ol LIKE ? OR
        integradora LIKE ? OR rastreio LIKE ? OR motivo LIKE ? OR mensagem LIKE ?
      )`);
      params.push(like, like, like, like, like, like, like, like, like, like, like, like);
    }

    if (req.query.campanha) {
      where.push('(id_campanha = ? OR id_ol = ?)');
      params.push(req.query.campanha, req.query.campanha);
    }

    if (req.query.cnpj) {
      where.push('(cnpj_cliente LIKE ? OR cnpj_distribuidor LIKE ?)');
      params.push(`%${req.query.cnpj}%`, `%${req.query.cnpj}%`);
    }

    if (req.query.integradora) {
      where.push('LOWER(integradora) = LOWER(?)');
      params.push(req.query.integradora);
    }

    if (req.query.status) {
      where.push('status = ?');
      params.push(String(req.query.status).toUpperCase());
    }

    where.push(...datas.where);
    params.push(...datas.params);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [totalRows] = await queryComTimeout(
      `SELECT COUNT(*) AS total FROM integracao_pedido_evento ${whereSql}`,
      params
    );

    const [rows] = await queryComTimeout(
      `
        SELECT
          id,
          id AS codigo,
          data_hora AS dataHora,
          DATE_FORMAT(data_hora, '%Y-%m-%d %H:%i:%s') AS dataPedidoFormatada,
          rastreio,
          integradora,
          username,
          pedido_integrador AS pedidoIntegrador,
          pedido_integrador AS pedidoIntegradora,
          cotacao_integrador AS cotacaoIntegrador,
          pedido_cliente AS pedidoCliente,
          cnpj_cliente AS cnpjCliente,
          cnpj_cliente AS CnpjCliente,
          cnpj_distribuidor AS cnpjDistribuidor,
          cnpj_distribuidor AS CnpjDistribuidor,
          id_campanha AS idCampanha,
          id_campanha AS IdCampanha,
          id_ol AS idOl,
          id_ol AS IdOL,
          itens,
          status,
          motivo,
          mensagem,
          numero_carrinho AS numeroCarrinho,
          numero_carrinho AS numeroCarrinhoDeCompras
        FROM integracao_pedido_evento
        ${whereSql}
        ORDER BY data_hora DESC, id DESC
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return res.json({
      success: true,
      data: rows,
      meta: {
        origem: 'integracao_pedido_evento',
        page,
        limit,
        total: totalRows[0]?.total || 0,
        totalPages: Math.max(1, Math.ceil((totalRows[0]?.total || 0) / limit)),
      },
    });
  } catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') {
      return erroResponse(res, 500, 'Erro ao buscar eventos de pedidos', error);
    }

    try {
      const { page, limit, offset } = parsePagination(req, 20, 200);
      const params = [];
      const where = [];
      const datas = filtrosData(req, 'dataPedido');

      if (req.query.search) {
        const like = `%${req.query.search}%`;
        where.push('(numeroCarrinhoDeCompras LIKE ? OR CnpjDistribuidor LIKE ? OR CnpjCliente LIKE ? OR IdCampanha LIKE ? OR NomeCampanha LIKE ? OR pedidoIntegradora LIKE ? OR integradora LIKE ?)');
        params.push(like, like, like, like, like, like, like);
      }

      if (req.query.campanha) {
        where.push('IdCampanha = ?');
        params.push(req.query.campanha);
      }

      if (req.query.cnpj) {
        where.push('(CnpjCliente LIKE ? OR CnpjDistribuidor LIKE ?)');
        params.push(`%${req.query.cnpj}%`, `%${req.query.cnpj}%`);
      }

      if (req.query.integradora) {
        where.push('integradora = ?');
        params.push(req.query.integradora);
      }

      where.push(...datas.where);
      params.push(...datas.params);
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const [totalRows] = await queryComTimeout(`SELECT COUNT(*) AS total FROM pedidoconfirmaintegracao ${whereSql}`, params);
      const [rows] = await queryComTimeout(
        `
          SELECT codigo, numeroCarrinhoDeCompras, CnpjDistribuidor, CnpjCliente, IdCampanha, NomeCampanha, pedidoIntegradora, integradora, dataPedido, DATE_FORMAT(dataPedido, '%Y-%m-%d %H:%i:%s') AS dataPedidoFormatada, 'INSERIDO' AS status
          FROM pedidoconfirmaintegracao
          ${whereSql}
          ORDER BY codigo DESC
          LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      return res.json({
        success: true,
        data: rows,
        meta: {
          origem: 'pedidoconfirmaintegracao',
          page,
          limit,
          total: totalRows[0]?.total || 0,
          totalPages: Math.max(1, Math.ceil((totalRows[0]?.total || 0) / limit)),
        },
      });
    } catch (fallbackError) {
      return erroResponse(res, 500, 'Erro ao buscar pedidos', fallbackError);
    }
  }
});

app.get('/pedidos/:codigo', async (req, res) => {
  try {
    const [rows] = await queryComTimeout(
      `
        SELECT
          id,
          id AS codigo,
          data_hora AS dataHora,
          DATE_FORMAT(data_hora, '%Y-%m-%d %H:%i:%s') AS dataPedidoFormatada,
          rastreio,
          integradora,
          username,
          pedido_integrador AS pedidoIntegrador,
          pedido_integrador AS pedidoIntegradora,
          cotacao_integrador AS cotacaoIntegrador,
          pedido_cliente AS pedidoCliente,
          cnpj_cliente AS cnpjCliente,
          cnpj_cliente AS CnpjCliente,
          cnpj_distribuidor AS cnpjDistribuidor,
          cnpj_distribuidor AS CnpjDistribuidor,
          id_campanha AS idCampanha,
          id_campanha AS IdCampanha,
          id_ol AS idOl,
          id_ol AS IdOL,
          itens,
          status,
          motivo,
          mensagem,
          numero_carrinho AS numeroCarrinho,
          numero_carrinho AS numeroCarrinhoDeCompras,
          payload_recebido AS payloadRecebido,
          payload_sigrede AS payloadSigrede,
          payload_retorno AS payloadRetorno
        FROM integracao_pedido_evento
        WHERE id = ?
        LIMIT 1
      `,
      [req.params.codigo]
    );

    return res.json({ success: true, data: rows[0] || null });
  } catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') {
      return erroResponse(res, 500, 'Erro ao buscar detalhe do evento do pedido', error);
    }

    try {
      const [rows] = await queryComTimeout('SELECT *, \'INSERIDO\' AS status FROM pedidoconfirmaintegracao WHERE codigo = ? LIMIT 1', [req.params.codigo]);
      return res.json({ success: true, data: rows[0] || null });
    } catch (fallbackError) {
      return erroResponse(res, 500, 'Erro ao buscar detalhe do pedido', fallbackError);
    }
  }
});


/* =========================
   LOGS OPERACIONAIS
========================= */

app.get('/logs', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req, 30, 200);
    const force = String(req.query.force || 'false') === 'true';
    const search = String(req.query.search || '').trim().toLowerCase();
    const datasPedidos = filtrosData(req, 'dataPedido');
    const datasLogs = filtrosData(req, 'criado_em');
    const wherePedidos = datasPedidos.where.length ? `WHERE ${datasPedidos.where.join(' AND ')}` : '';
    const whereLogs = datasLogs.where.length ? `WHERE ${datasLogs.where.join(' AND ')}` : '';

    const arquivos = (await listarArquivosBucketCached({ force })).slice(0, 100).map((arquivo) => ({
      tipo: 'ARQUIVO_GERADO',
      status: 'SUCESSO',
      descricao: `Arquivo ${arquivo.nomeArquivo} disponÃƒÂ­vel no bucket`,
      origem: 'BUCKET',
      pedidoIntegrador: null,
      campanha: arquivo.campanha,
      cnpjCliente: null,
      payload: null,
      erro: null,
      data: arquivo.atualizadoEm || arquivo.criadoEm,
      referencia: arquivo.nomeArquivo,
    }));

    const [pedidos] = await queryComTimeout(`
      SELECT codigo, numeroCarrinhoDeCompras, IdCampanha, NomeCampanha, pedidoIntegradora, integradora, CnpjCliente, dataPedido
      FROM pedidoconfirmaintegracao
      ${wherePedidos}
      ORDER BY codigo DESC
      LIMIT 100
    `, datasPedidos.params);

    const logsPedidos = pedidos.map((pedido) => ({
      tipo: 'PEDIDO_INSERIDO',
      status: 'SUCESSO',
      descricao: `Pedido ${
        pedido.pedidoIntegradora || pedido.numeroCarrinhoDeCompras || pedido.codigo
      } inserido pela integradora ${pedido.integradora || '-'}`,
      origem: pedido.integradora || null,
      pedidoIntegrador: pedido.pedidoIntegradora || pedido.numeroCarrinhoDeCompras || null,
      campanha: pedido.IdCampanha,
      cnpjCliente: pedido.CnpjCliente,
      payload: null,
      erro: null,
      data: pedido.dataPedido,
      referencia: pedido.codigo,
    }));

    const [tentativas] = await queryComTimeout(`
      SELECT id, origem, pedido_integrador, id_campanha, cnpj_cliente, status, mensagem, payload, erro, criado_em
      FROM log_integracao_pedidos
      ${whereLogs}
      ORDER BY id DESC
      LIMIT 200
    `, datasLogs.params);

    const logsTentativas = tentativas.map((log) => ({
      tipo: 'TENTATIVA_ENVIO_PEDIDO',
      status: log.status,
      descricao: log.mensagem,
      origem: log.origem,
      pedidoIntegrador: log.pedido_integrador,
      campanha: log.id_campanha,
      cnpjCliente: log.cnpj_cliente,
      payload: log.payload,
      erro: log.erro,
      data: log.criado_em,
      referencia: log.id,
    }));

    const eventosServicosPayload = bancoConfigurado()
      ? await listarServicosLogs({
          page: 1,
          limit: 200,
          servico: req.query.servico,
          tipo: req.query.tipo,
          status: req.query.status,
          search,
          dataInicio: req.query.dataInicio || req.query.dataInicial || req.query.inicio,
          dataFim: req.query.dataFim || req.query.dataFinal || req.query.fim,
        })
      : { rows: [] };

    const eventosServicosFiltrados = eventosServicosPayload.rows.filter((log) =>
      req.query.tipo ? true : log.tipo !== 'STREAM_LOG'
    );

    const logsServicos = eventosServicosFiltrados.map((log) => ({
      tipo: log.tipo,
      status: log.status,
      descricao: log.mensagem,
      origem: log.origem,
      servico: log.servico,
      nomeServico: log.nome_servico,
      pedidoIntegrador: null,
      campanha: null,
      cnpjCliente: null,
      payload: null,
      erro: log.status === 'ERRO' ? log.detalhe : null,
      detalhe: log.detalhe,
      data: log.criado_em,
      referencia: `servico-log-${log.id}`,
      usuario: log.usuario,
      arquivoLog: log.arquivo_log,
      pid: log.pid,
    }));

    let logs = [...logsServicos, ...logsTentativas, ...logsPedidos, ...arquivos];

    if (req.query.servico) {
      logs = logs.filter((log) => log.servico === req.query.servico);
    }

    if (req.query.tipo) {
      logs = logs.filter((log) => log.tipo === req.query.tipo);
    }

    if (req.query.status) {
      logs = logs.filter((log) => log.status === req.query.status);
    }

    if (search) {
      logs = logs.filter((log) =>
        Object.values(log).some((valor) => String(valor ?? '').toLowerCase().includes(search))
      );
    }

    logs = logs.sort((a, b) => new Date(b.data || 0).getTime() - new Date(a.data || 0).getTime());

    return res.json({
      success: true,
      data: logs.slice(offset, offset + limit),
      meta: {
        page,
        limit,
        total: logs.length,
        totalPages: Math.max(1, Math.ceil(logs.length / limit)),
      },
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao buscar logs', error);
  }
});

/* =========================
   PROXY ENVIA PEDIDO
========================= */

app.post('/proxy/enviapedido', async (req, res) => {
  const payload = req.body;
  const urlDestino = process.env.PEDIDOS_API_URL || 'http://35.215.217.184:8080/estoque/enviapedido';
  const dados = extrairDadosPedido(payload);

  try {
    const response = await postJson(
      urlDestino,
      payload,
      req.headers.authorization ? { Authorization: req.headers.authorization } : {}
    );
    const textoResposta = response.text;

    let respostaFormatada;

    try {
      respostaFormatada = JSON.parse(textoResposta);
    } catch {
      respostaFormatada = textoResposta;
    }

    await pool.query(
      `
        INSERT INTO log_integracao_pedidos (origem, pedido_integrador, id_campanha, cnpj_cliente, status, mensagem, payload, erro)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        dados.origem,
        dados.pedidoIntegrador,
        dados.idCampanha,
        dados.cnpjCliente,
        response.ok ? 'SUCESSO' : 'ERRO',
        response.ok ? 'Pedido enviado com sucesso' : `Erro ao enviar pedido. Status ${response.status}`,
        JSON.stringify(payload),
        response.ok ? null : JSON.stringify(respostaFormatada),
      ]
    );

    return res.status(response.status).json(respostaFormatada);
  } catch (error) {
    try {
      await pool.query(
        `
          INSERT INTO log_integracao_pedidos (origem, pedido_integrador, id_campanha, cnpj_cliente, status, mensagem, payload, erro)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          dados.origem,
          dados.pedidoIntegrador,
          dados.idCampanha,
          dados.cnpjCliente,
          'ERRO',
          'Erro ao comunicar com endpoint externo',
          JSON.stringify(payload),
          error.stack || error.message,
        ]
      );
    } catch (logError) {
      console.error('Falha ao gravar log de erro:', logError);
    }

    return res.status(500).json({
      success: false,
      message: 'Erro ao comunicar com endpoint externo',
      error: error.message,
    });
  }
});

/* =========================
   VALIDADOR DE PEDIDO
========================= */

app.post('/validador/pedido', authMiddleware, async (req, res) => {
  try {
    const payload = req.body?.payload ?? req.body?.pedido ?? req.body;
    const rede = req.body?.rede || req.query?.rede || process.env.VALIDADOR_REDE_DEFAULT || 'redecomprecerto';
    const validarBanco = req.body?.validarBanco !== false;

    const resultado = await validarPedido(payload, {
      pool,
      rede,
      validarBanco,
    });

    return res.json({
      success: true,
      data: resultado,
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao validar pedido', error);
  }
});

/* =========================
   DEBUG
========================= */

app.get('/debug/colunas/:tabela', async (req, res) => {
  try {
    const tabelasPermitidas = ['pedidoconfirmaintegracao', 'criafilecampanha', 'log_integracao_pedidos'];

    if (!tabelasPermitidas.includes(req.params.tabela)) {
      return erroResponse(res, 400, 'Tabela nÃƒÂ£o permitida');
    }

    const [rows] = await queryComTimeout(`SHOW COLUMNS FROM ${req.params.tabela}`);

    return res.json(rows);
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao buscar colunas', error);
  }
});

app.get('/debug/logs-integracao', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM log_integracao_pedidos ORDER BY id DESC LIMIT 20');

    return res.json({
      total: rows.length,
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Erro ao consultar log_integracao_pedidos',
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
  console.log(`SIG_FOLDER=${SIG_FOLDER}`);

  if (bancoConfigurado()) {
    garantirTabelaAlertas().catch((e) => console.error('Falha ao garantir tabela de alertas:', e.message));
    garantirTabelaAcoesPainel().catch((e) => console.error('Falha ao garantir tabela de acoes do painel:', e.message));
    garantirTabelaServicosLogs().catch((e) => console.error('Falha ao garantir tabela de logs de servicos:', e.message));
  } else {
    console.warn('Tabela de alertas nao verificada: configure DB_HOST, DB_USER e DB_DATABASE para habilitar banco.');
  }

  iniciarMonitoramento(SERVICOS);
});
