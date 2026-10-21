const crypto = require('crypto');
function resumoMonitoramento(data) {
  const disponivel = !!data.arquivoEncontrado && !data.invalidos && !!data.resultados?.length;
  const pendencias = (data.pendencias || []).filter(e => ['NAO_GERADA', 'ERRO'].includes(e.status));
  const itens = pendencias.map(e => ({ campanha:String(e.campanha), status:e.status, data:e.data, problemas:e.problemas })).sort((a,b)=>a.campanha.localeCompare(b.campanha));
  return { status:disponivel ? 'DISPONIVEL' : 'INDISPONIVEL', verificadoEm:data.consultadoEm,
    quantidade:disponivel ? pendencias.length : null,
    ultimaOcorrencia:disponivel && pendencias.length ? pendencias.reduce((a,b)=>Date.parse(a.data)>Date.parse(b.data)?a:b).data : null,
    assinatura:disponivel && pendencias.length ? crypto.createHash('sha256').update(JSON.stringify(itens)).digest('hex') : null,
    escopo:'RESULTADOS_RECENTES' };
}
module.exports={resumoMonitoramento};
