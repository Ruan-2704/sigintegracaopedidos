const { listarPidsPorPorta, listarPidsPorNome } = require('./remoteExecution');

let consulta;
let cache;
let cacheEm = 0;

function comPrazo(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), 6000); }),
  ]).finally(() => clearTimeout(timer));
}

async function verificar() {
  let status = 'INDISPONIVEL';
  try {
    const [porta, processo] = await comPrazo(Promise.all([
      listarPidsPorPorta(Number(process.env.PEDIDOS_PORT || 8080), 'pedidos'),
      listarPidsPorNome('java.*-jar .*envia-cotacao-[^ /]+[.]jar', 'pedidos'),
    ]));
    status = porta.some(pid => processo.includes(pid)) ? 'ONLINE' : 'OFFLINE';
  } catch (_) {
    // Falha de SSH nao comprova que a API parou.
  }
  cache = { status, verificadoEm: new Date().toISOString() };
  cacheEm = Date.now();
  return cache;
}

function consultar() {
  if (cache && Date.now() - cacheEm < 10000) return Promise.resolve(cache);
  if (!consulta) consulta = verificar().finally(() => { consulta = null; });
  return consulta;
}

module.exports = { consultar };
