const fs = require('fs');
const path = require('path');
const { executarComando, isWindowsLocalMode } = require('./remoteExecution');
const script = fs.readFileSync(path.join(__dirname, 'pedidoLogHistory.py')).toString('base64');
const cache = new Map();
function filters(query) {
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : '';
  return {
    page: Math.max(1,Math.min(Number(query.page)||1,10000)), limit: Math.max(1,Math.min(Number(query.limit)||50,200)),
    dataInicio: date(query.dataInicio), dataFim: date(query.dataFim),
    niveis: String(query.niveis || query.nivel || '').split(',').filter(item=>['INFO','WARN','ERROR','DEBUG','TRACE'].includes(item)),
    categorias: String(query.categorias || '').split(',').filter(item=>['PEDIDOS','CAMPANHAS_ARQUIVOS','AUTENTICACAO_API','REQUISICOES_API','INFRAESTRUTURA','APLICACAO'].includes(item)),
    search: String(query.search || '').slice(0,500), rastreio: String(query.rastreio || '').slice(0,200),
    pedido: String(query.pedido || '').slice(0,120), campanha: String(query.campanha || '').slice(0,120)
  };
}
async function consultar(query) {
  if (isWindowsLocalMode()) throw new Error('Configure SSH para consultar o historico no servidor.');
  const args = filters(query);
  const key = JSON.stringify(args);
  const previous = cache.get(key);
  if (String(query.force) !== 'true' && previous && Date.now()-previous.at < 30000) return previous.value;
  const folder = process.env.SSH_PEDIDOS_WORKDIR || process.env.SIGCOTEFACIL_FOLDER || '/home/sigpedidos/sigcotefacil';
  const configured = process.env.LOG_PEDIDOS_ERROS_FILE || process.env.PEDIDOS_API_LOG_FILE || 'logs/integracao-pedidos.log';
  args.path = path.posix.isAbsolute(configured) ? configured : path.posix.join(folder,configured);
  const encoded = Buffer.from(JSON.stringify(args)).toString('base64');
  const command = "printf '%s' '"+script+"' | base64 -d | python3 - \"$(printf '%s' '"+encoded+"' | base64 -d)\"";
  const stdout = await executarComando(command,'pedidos');
  const value = JSON.parse(stdout);
  value.meta.atualizadoEm = new Date().toISOString();
  if (cache.size >= 50) cache.delete(cache.keys().next().value);
  cache.set(key,{at:Date.now(),value});
  return value;
}
module.exports = { consultar, filters };
