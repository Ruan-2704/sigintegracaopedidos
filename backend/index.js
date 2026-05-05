const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Storage } = require('@google-cloud/storage');

require('dotenv').config();

const ultimoErroDetectado = {};
const ultimoStatusServicos = {};
const ultimoEventoManual = {};
const statusServicosCache = {
  data: null,
  updatedAt: 0,
};

const STATUS_CACHE_TTL_MS = Number(process.env.STATUS_CACHE_TTL_MS || 8000);
const SSH_STATUS_TIMEOUT_MS = Number(process.env.SSH_STATUS_TIMEOUT_MS || 6000);
const IGNORAR_ALERTA_APOS_STOP_MS = Number(process.env.IGNORAR_ALERTA_APOS_STOP_MS || 45000);
const ALERT_EMAIL_ON_MANUAL_STOP =
  String(process.env.ALERT_EMAIL_ON_MANUAL_STOP || 'false').toLowerCase() === 'true';

const {
  executarScript,
  lerCrontab,
  salvarCrontab,
  listarPidsPorPorta,
  listarPidsPorNome,
  matarPidsPorPorta,
  lerLogRemoto,
} = require('./remoteExecution');

const { iniciarMonitoramento } = require('./serviceMonitor');
const { enviarEmailAlerta } = require('./mailer');
const { enviarAlertaOperacional, listarAlertas, garantirTabelaAlertas } = require('./alertService');
const { detectarErroLog } = require('./serviceMonitor');

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
const dashboardCache = {
  bucket: {
    data: null,
    updatedAt: 0,
    ttl: 60000,
  },
  redeLoja: {
    data: null,
    updatedAt: 0,
    ttl: 60000,
  },
};

function cacheValido(cacheItem) {
  return cacheItem.data && Date.now() - cacheItem.updatedAt < cacheItem.ttl;
}

const SERVICOS = {
  geracao: {
    chave: 'geracao',
    nome: 'Geração de arquivos',
    script: process.env.SCRIPT_GERACAO || 'executa_script.sh',
    porta: Number(process.env.GERACAO_PORT || 8080),
  },
  exclusao: {
    chave: 'exclusao',
    nome: 'Exclusão de arquivos',
    script: process.env.SCRIPT_EXCLUSAO || 'executa_exclusao_script.sh',
    porta: Number(process.env.EXCLUSAO_PORT || 8081),
  },
  pedidos: {
    chave: 'pedidos',
    nome: 'API inserção de pedidos',
    jar: process.env.JAR_PEDIDOS || 'envia-cotacao-0.0.3.jar',
    porta: Number(process.env.PEDIDOS_PORT || 8080),
    healthUrl:
      process.env.PEDIDOS_HEALTH_URL ||
      `http://localhost:${Number(process.env.PEDIDOS_PORT || 8080)}/actuator/health`,
  },
};

function timeoutPromise(promise, ms, label = 'operação') {
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
    console.error(`Erro ao listar PIDs do serviço ${chave}:`, error.message);
    return [];
  }
}

async function consultarStatusServicos({ force = false, detectarQueda = true } = {}) {
  const agora = Date.now();

  if (!force && statusServicosCache.data && agora - statusServicosCache.updatedAt < STATUS_CACHE_TTL_MS) {
    return {
      ...statusServicosCache.data,
      cache: true,
      cacheAgeMs: agora - statusServicosCache.updatedAt,
    };
  }

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
  statusOperacional: geracaoPids.length > 0 ? 'executando' : 'aguardando execução',
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
  statusOperacional: exclusaoPids.length > 0 ? 'executando' : 'aguardando execução',
  pids: exclusaoPids,
  target: 'files',
},
  pedidos: {
  nome: SERVICOS.pedidos.nome,
  jar: SERVICOS.pedidos.jar,
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
        mensagem: `O serviço ${data[key].nome} ficou offline.`,
        servidor: data[key].servidor,
        porta: data[key].porta,
        assunto: `🚨 Serviço offline - ${data[key].nome}`,
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

function invalidarCacheStatusServicos() {
  statusServicosCache.data = null;
  statusServicosCache.updatedAt = 0;
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
  const publicPaths = ['/health', '/auth/login'];

  if (publicPaths.includes(req.path)) {
    return next();
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = validarToken(token);

  if (!payload) {
    return erroResponse(res, 401, 'Acesso não autorizado. Faça login novamente.');
  }

  req.usuario = payload;
  return next();
}

app.post('/auth/login', (req, res) => {
  const tokenInformado = String(req.body?.token || req.body?.password || '').trim();

  if (!tokenInformado || tokenInformado !== PANEL_TOKEN) {
    return erroResponse(res, 401, 'Token inválido.');
  }

  const now = Math.floor(Date.now() / 1000);
  const accessToken = criarToken({
    sub: 'painel-sig-integracao',
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
    throw new Error('Serviço inválido para execução de script.');
  }

  const scriptPath = path.join(SIG_FOLDER, servico.script);

  if (!fs.existsSync(SIG_FOLDER)) {
    throw new Error(`Diretório não encontrado: ${SIG_FOLDER}`);
  }

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script não encontrado: ${scriptPath}`);
  }

  return { servico, scriptPath };
}

function iniciarScript(chave) {
  const { servico, scriptPath } = validarServicoScript(chave);

  if (processos.has(chave)) {
    const atual = processos.get(chave);

    if (!atual.killed) {
      throw new Error(`${servico.nome} já está em execução pelo painel. PID: ${atual.pid}`);
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
   OPERACIONAL / SERVIÇOS
========================= */

app.get('/servicos/status', authMiddleware, async (req, res) => {
  try {
    const payload = await consultarStatusServicos({
      force: true,
      detectarQueda: false,
    });

    return res.json({
      success: true,
      data: payload.data,
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao consultar status dos serviços', error);
  }
});

app.post('/servicos/geracao/start', authMiddleware, async (req, res) => {
  try {
    const result = await executarScript(process.env.SCRIPT_GERACAO || 'executa_script.sh');

    return res.json({
      success: true,
      message: 'Geração iniciada com sucesso',
      data: result,
    });
  } catch (error) {
    

    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar geração',
      error: error.message,
    });
  }
});

app.post('/servicos/geracao/iniciar', authMiddleware, async (req, res) => {
  try {
    const result = await executarScript(process.env.SCRIPT_GERACAO || 'executa_script.sh');

    return res.json({
      success: true,
      message: 'Geração iniciada com sucesso',
      data: result,
    });
  } catch (error) {
  

    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar geração',
      error: error.message,
    });
  }
});

app.post('/servicos/exclusao/start', authMiddleware, async (req, res) => {
  try {
    const result = await executarScript(process.env.SCRIPT_EXCLUSAO || 'executa_exclusao_script.sh');

    return res.json({
      success: true,
      message: 'Exclusão iniciada com sucesso',
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar exclusão',
      error: error.message,
    });
  }
});

app.post('/servicos/exclusao/iniciar', authMiddleware, async (req, res) => {
  try {
    const result = await executarScript(process.env.SCRIPT_EXCLUSAO || 'executa_exclusao_script.sh');

    return res.json({
      success: true,
      message: 'Exclusão iniciada com sucesso',
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar exclusão',
      error: error.message,
    });
  }
});

app.post('/servicos/:servico/stop', authMiddleware, async (req, res) => {
  try {
    const chave = req.params.servico;
    const servico = SERVICOS[chave];

    if (!servico) {
      return erroResponse(res, 400, 'Serviço inválido.');
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
      `Parada solicitada pelo painel. Serviço=${chave}, target=${target}, porta=${servico.porta}, PIDs antes=${
        pidsAntes.join(', ') || '-'
      }, PIDs encerrados=${(pidsEncerrados || []).join(', ') || '-'}, PIDs depois=${
        pidsDepois.join(', ') || '-'
      }`
    );

    if (ALERT_EMAIL_ON_MANUAL_STOP && pidsAntes.length > 0) {
      enviarAlertaOperacional({
        servico: servico.nome,
        tipo: 'SERVICO_PARADO_MANUALMENTE',
        severidade: 'INFO',
        mensagem: `Serviço ${servico.nome} parado manualmente pelo painel.`,
        detalhe: `PIDs antes: ${pidsAntes.join(', ') || '-'} | PIDs encerrados: ${
          (pidsEncerrados || []).join(', ') || '-'
        } | PIDs depois: ${pidsDepois.join(', ') || '-'}`,
        servidor: servidorServico(chave),
        porta: servico.porta,
        assunto: `Serviço parado manualmente - ${servico.nome}`,
      }).catch((error) => {
        console.error('Falha ao registrar/enviar alerta de parada manual:', error.message);
      });
    }

    return res.json({
      success: true,
      message: pidsAntes.length
        ? pidsDepois.length
          ? 'Parada solicitada, mas ainda existem processos ativos. Aguarde e atualize novamente.'
          : 'Serviço parado com sucesso.'
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
    return erroResponse(res, 500, 'Erro ao parar serviço', error);
  }
});

app.get('/servicos/:servico/logs', authMiddleware, async (req, res) => {
  try {
    const servico = req.params.servico;
    const limit = Number(req.query.limit || req.query.linhas || 300);

    let scriptName;

    if (servico === 'geracao') {
      scriptName = process.env.SCRIPT_GERACAO || 'executa_script.sh';
    } else if (servico === 'exclusao') {
      scriptName = process.env.SCRIPT_EXCLUSAO || 'executa_exclusao_script.sh';
    } else if (servico === 'pedidos') {
      scriptName = process.env.JAR_PEDIDOS || 'envia-cotacao-0.0.3.jar';
    } else {
      return res.status(400).json({
        success: false,
        message: 'Serviço inválido',
      });
    }

    const target = servico === 'pedidos' ? 'pedidos' : 'files';
    const content = await lerLogRemoto(scriptName, limit, target);

    return res.json({
      success: true,
      data: content.split('\n'),
      content,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao ler log do serviço',
      error: error.message,
    });
  }
});

app.get('/servicos/:servico/logs/stream', (req, res) => {
  const chave = req.params.servico;

  if (!SERVICOS[chave]) {
    return erroResponse(res, 400, 'Serviço inválido.');
  }

  const filePath = caminhoLog(chave);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let position = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

  const enviar = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  enviar({
    tipo: 'init',
    linhas: lerUltimasLinhas(filePath, 80),
  });

  const interval = setInterval(() => {
    try {
      if (!fs.existsSync(filePath)) return;

      const stat = fs.statSync(filePath);

      if (stat.size < position) {
        position = 0;
      }

      if (stat.size > position) {
        const stream = fs.createReadStream(filePath, {
          start: position,
          end: stat.size,
        });

        let chunk = '';

        stream.on('data', (data) => {
          chunk += data.toString('utf8');
        });

        stream.on('end', () => {
          position = stat.size;

          enviar({
            tipo: 'append',
            linhas: chunk.split(/\r?\n/).filter(Boolean),
          });
        });
      }
    } catch (error) {
      enviar({
        tipo: 'erro',
        mensagem: error.message,
      });
    }
  }, 1500);

  req.on('close', () => clearInterval(interval));
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

app.post('/cron', authMiddleware, async (req, res) => {
  try {
    const content = req.body.content ?? req.body.crontab ?? '';

    await salvarCrontab(content);

    return res.json({
      success: true,
      message: 'Crontab salvo com sucesso',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao salvar crontab',
      error: error.message,
    });
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
  vidafarmacias: 'Vida Farmácias',
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
    const dataInicial = req.query.dataInicial || req.query.inicio || null;
    const dataFinal = req.query.dataFinal || req.query.fim || null;

    const filtros = [];
    const params = [];

    if (dataInicial) {
      filtros.push('DATE(dataPedido) >= ?');
      params.push(dataInicial);
    }

    if (dataFinal) {
      filtros.push('DATE(dataPedido) <= ?');
      params.push(dataFinal);
    }

    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

    const bucketPromise = cacheValido(dashboardCache.bucket)
      ? Promise.resolve(dashboardCache.bucket.data)
      : listarArquivosBucket()
          .then((arquivos) => {
            const data = {
              bucketOnline: true,
              bucketErro: null,
              totalArquivos: Array.isArray(arquivos) ? arquivos.length : 0,
            };

            dashboardCache.bucket = {
              ...dashboardCache.bucket,
              data,
              updatedAt: Date.now(),
            };

            return data;
          })
          .catch((error) => ({
            bucketOnline: false,
            bucketErro: error.message,
            totalArquivos: dashboardCache.bucket.data?.totalArquivos || 0,
          }));

    const redeLojaPromise = cacheValido(dashboardCache.redeLoja)
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
            SELECT 'vidafarmacias', 'Vida Farmácias', FAR_CODIGO, FAR_NOME, FAR_CNPJ
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

            dashboardCache.redeLoja = {
              ...dashboardCache.redeLoja,
              data,
              updatedAt: Date.now(),
            };

            return data;
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
      `),

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

    return res.json({
      success: true,
      data: {
        status: 'Online',
        bucket: BUCKET_NAME,
        bucketOnline: bucketData.bucketOnline,
        bucketErro: bucketData.bucketErro,
        totalArquivos: bucketData.totalArquivos,

        totalPedidos: primeiraLinha(totalPedidosResult).total || 0,
        pedidosHoje: primeiraLinha(pedidosHojeResult).total || 0,
        ultimaMovimentacao: primeiraLinha(ultimaMovimentacaoResult).ultimaData || null,
        totalErros: primeiraLinha(logsErroResult).total || 0,

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
    const arquivos = filtrarArquivos(await listarArquivosBucket(), req.query.search);

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
      return erroResponse(res, 400, 'Arquivo inválido');
    }

    const file = storage.bucket(BUCKET_NAME).file(nomeArquivo);
    const [exists] = await file.exists();

    if (!exists) {
      return erroResponse(res, 404, 'Arquivo não encontrado no bucket');
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
      return erroResponse(res, 400, 'Arquivo inválido');
    }

    const file = storage.bucket(BUCKET_NAME).file(nomeArquivo);
    const [exists] = await file.exists();

    if (!exists) {
      return erroResponse(res, 404, 'Arquivo não encontrado no bucket');
    }

    await file.delete();

    return res.json({
      success: true,
      message: 'Arquivo excluído com sucesso',
      data: {
        nomeArquivo,
      },
    });
  } catch (error) {
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

    if (req.query.search) {
      const like = `%${req.query.search}%`;

      where.push(
        '(numeroCarrinhoDeCompras LIKE ? OR CnpjDistribuidor LIKE ? OR CnpjCliente LIKE ? OR IdCampanha LIKE ? OR NomeCampanha LIKE ? OR pedidoIntegradora LIKE ? OR integradora LIKE ?)'
      );

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

    if (req.query.dataInicio) {
      where.push('DATE(dataPedido) >= ?');
      params.push(req.query.dataInicio);
    }

    if (req.query.dataFim) {
      where.push('DATE(dataPedido) <= ?');
      params.push(req.query.dataFim);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [totalRows] = await queryComTimeout(
      `SELECT COUNT(*) AS total FROM pedidoconfirmaintegracao ${whereSql}`,
      params
    );

    const [rows] = await queryComTimeout(
      `
        SELECT codigo, numeroCarrinhoDeCompras, CnpjDistribuidor, CnpjCliente, IdCampanha, NomeCampanha, pedidoIntegradora, integradora, dataPedido
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
        page,
        limit,
        total: totalRows[0]?.total || 0,
        totalPages: Math.max(1, Math.ceil((totalRows[0]?.total || 0) / limit)),
      },
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao buscar pedidos', error);
  }
});

app.get('/pedidos/:codigo', async (req, res) => {
  try {
    const [rows] = await queryComTimeout('SELECT * FROM pedidoconfirmaintegracao WHERE codigo = ? LIMIT 1', [
      req.params.codigo,
    ]);

    return res.json({
      success: true,
      data: rows[0] || null,
    });
  } catch (error) {
    return erroResponse(res, 500, 'Erro ao buscar detalhe do pedido', error);
  }
});



/* =========================
   LOGS OPERACIONAIS
========================= */

app.get('/logs', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req, 30, 200);
    const search = String(req.query.search || '').trim().toLowerCase();

    const arquivos = (await listarArquivosBucket()).slice(0, 100).map((arquivo) => ({
      tipo: 'ARQUIVO_GERADO',
      status: 'SUCESSO',
      descricao: `Arquivo ${arquivo.nomeArquivo} disponível no bucket`,
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
      ORDER BY codigo DESC
      LIMIT 100
    `);

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
      ORDER BY id DESC
      LIMIT 200
    `);

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

    let logs = [...logsTentativas, ...logsPedidos, ...arquivos];

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
    const response = await fetch(urlDestino, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      },
      body: JSON.stringify(payload),
    });

    const textoResposta = await response.text();

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
      return erroResponse(res, 400, 'Tabela não permitida');
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
  garantirTabelaAlertas().catch((e) => console.error('Falha ao garantir tabela de alertas:', e.message));
  iniciarMonitoramento(SERVICOS);
});