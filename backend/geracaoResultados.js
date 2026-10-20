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
  return { resultados, invalidos, pendencias: resultados.filter(e=>['PARCIAL','NAO_GERADA','ERRO'].includes(e.status)),
    arquivos: resultados.filter(e=>['GERADA','PARCIAL'].includes(e.status)).map(e=>String(e.campanha) + '.json'),
    escopo: 'Últimos resultados disponíveis (até 500 por arquivo de log). Não é uma auditoria completa do bucket.' };
}
module.exports = { resumirResultados };
