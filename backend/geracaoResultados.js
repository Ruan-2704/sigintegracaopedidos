const MARCADOR = '[CAMPANHA_RESULTADO] ';
function resumirResultados(content) {
  const ultimos = new Map(); let invalidos = 0;
  for (const linha of String(content || '').split(/\r?\n/)) {
    const pos = linha.indexOf(MARCADOR); if (pos < 0) continue;
    try {
      const e = JSON.parse(linha.slice(pos + MARCADOR.length));
      if (!/^\d+$/.test(String(e.campanha)) || !['GERADA','PARCIAL','NAO_GERADA','ATUALIZADA','LOCAL_SEM_UPLOAD','ERRO'].includes(e.status)) { invalidos++; continue; }
      if (!Array.isArray(e.problemas)) e.problemas = [];
      const anterior = ultimos.get(String(e.campanha));
      if (['ATUALIZADA','LOCAL_SEM_UPLOAD'].includes(e.status) && anterior && ['PARCIAL','NAO_GERADA','ERRO'].includes(anterior.status)) {
        // Bucket atualizado nao revalida os dados que faltaram na tentativa anterior.
        ultimos.set(String(e.campanha), { ...anterior, ultimaVerificacao: e.data });
      } else ultimos.set(String(e.campanha), e);
    } catch (_) { invalidos++; }
  }
  const resultados = Array.from(ultimos.values()).sort((a,b)=>String(b.data).localeCompare(String(a.data)));
  return { resultados, invalidos, pendencias: resultados.filter(e=>['NAO_GERADA','ERRO'].includes(e.status)),
    arquivos: resultados.filter(e=>['GERADA','PARCIAL'].includes(e.status)).map(e=>String(e.campanha) + '.json'),
    escopo: 'Últimos resultados disponíveis (até 500 por arquivo de log). Não é uma auditoria completa do bucket.' };
}
// A configuracao atual limita os alertas; o historico de arquivos gerados permanece.
function filtrarPendenciasRedes(data, codigosHabilitados) {
  const habilitadas = new Set(codigosHabilitados.map(String));
  const codigos = valor => String(valor || '').split(/[,;\s]+/).filter(Boolean);
  const resultados = data.resultados.flatMap(evento => {
    if (!['NAO_GERADA', 'ERRO'].includes(evento.status)) return [evento];
    const redes = [...(evento.redes || []), ...(evento.problemas || []).flatMap(p => codigos(p.rede))].map(String);
    if (!habilitadas.size || (redes.length && !redes.some(r => habilitadas.has(r)))) return [];
    const problemas = (evento.problemas || []).filter(p => !p.rede || codigos(p.rede).some(r => habilitadas.has(r)));
    if (evento.problemas?.length && !problemas.length) return [];
    return [{ ...evento, problemas }];
  });
  return { ...data, resultados, pendencias: resultados.filter(e => ['NAO_GERADA', 'ERRO'].includes(e.status)) };
}
// Consulta apenas os cabecalhos das campanhas pendentes, em lote por rede.
async function filtrarCampanhasEncerradas(data, redes, pool) {
  const codigos = valor => String(valor || '').split(/[,;\s]+/).filter(Boolean);
  const campanhas = data.pendencias || [];
  const encerradas = new Set();
  for (const rede of redes) {
    if (!/^[a-z][a-z0-9_]*$/.test(String(rede.schemaNome || ''))) throw new Error('Base invalida na configuracao da geracao.');
    const codigo = String(rede.codigo);
    const ids = [...new Set(campanhas.filter(e => {
      const origem = [...(e.redes || []), ...(e.problemas || []).flatMap(p => codigos(p.rede))].map(String);
      return !origem.length || origem.includes(codigo);
    }).map(e => String(e.campanha)))];
    if (!ids.length) continue;
    if (ids.some(id => !/^\d{1,15}$/.test(id))) throw new Error('Codigo de campanha invalido no log.');
    const [rows] = await pool.query({
      sql: 'SELECT OPL_CODIGO AS campanha, OPL_ATIVO AS ativa, (OPL_DT_FIM > NOW()) AS vigente FROM '
        + rede.schemaNome + '.operacoes_logisticas WHERE OPL_CODIGO IN (' + ids.map(() => '?').join(',') + ')',
      timeout: 8000
    }, ids);
    for (const row of rows) {
      if (Number(row.ativa) === 0 || (row.vigente != null && Number(row.vigente) === 0)) encerradas.add(codigo + ':' + row.campanha);
    }
  }
  const resultados = data.resultados.flatMap(e => {
    if (!['NAO_GERADA', 'ERRO'].includes(e.status)) return [e];
    const redeEvento = [...new Set([...(e.redes || []), ...(e.problemas || []).flatMap(p => codigos(p.rede))].map(String))];
    if (redeEvento.length && redeEvento.every(r => encerradas.has(r + ':' + e.campanha))) return [];
    const problemas = (e.problemas || []).filter(p => {
      const origem = p.rede ? codigos(p.rede) : redeEvento;
      return !origem.length || origem.some(r => !encerradas.has(r + ':' + e.campanha));
    });
    if (e.problemas?.length && !problemas.length) return [];
    return [{ ...e, problemas }];
  });
  return { ...data, resultados, pendencias: resultados.filter(e => ['NAO_GERADA', 'ERRO'].includes(e.status)), campanhasEncerradas: [...encerradas] };
}
module.exports = { resumirResultados, filtrarPendenciasRedes, filtrarCampanhasEncerradas };
