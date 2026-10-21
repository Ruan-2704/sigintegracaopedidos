export interface PendenciaGeracao { campanha: string; status: string; rede: string; uf: string; motivos: string[]; data?: string; nomeRede?: string; ufs?: string[]; }
export function analisarResultadosGeracao(linhas: string[]): { arquivos: string[]; pendencias: PendenciaGeracao[]; redesPorArquivo: Record<string, string[]> } {
  const eventos = new Map<string, any>();
  const legados = new Set<string>();
  const contextos = new Map<string, { redes: string[]; semLojas: string[]; consultas: { rede: string; uf: string; tipo: string }[] }>();
  const contexto = () => { if (!contextos.has(campanha)) contextos.set(campanha, { redes: [], semLojas: [], consultas: [] }); return contextos.get(campanha)!; };
  let redeAtual = '';
  let campanha = ''; let uploadSucesso = false;
  for (const linha of linhas) {
    const pos = linha.indexOf('[CAMPANHA_RESULTADO] ');
    if (pos >= 0) {
      try { const e = JSON.parse(linha.slice(pos + '[CAMPANHA_RESULTADO] '.length));
        if (/^\d+$/.test(String(e.campanha))) {
          const anterior = eventos.get(String(e.campanha));
          if (!(['ATUALIZADA','LOCAL_SEM_UPLOAD'].includes(e.status) && anterior && ['PARCIAL','NAO_GERADA','ERRO'].includes(anterior.status))) eventos.set(String(e.campanha), { ...e, estruturado: true });
        }
      } catch { /* Linha incompleta durante escrita: aguardar proxima leitura. */ }
      continue;
    }
    const ol = linha.match(/(?:INICIO PROCESSAMENTO OL(?: MULTI-REDE)?|FIM PROCESSAMENTO OL|Concluindo OL|An[áa]lise OL|Campanha)\s*:?\s*(\d+)/i);
    if (ol) { if (campanha !== ol[1]) { redeAtual = ''; uploadSucesso = false; } campanha = ol[1]; }
    if (campanha) {
      const redes = linha.match(/[Rr]edes:\s*\[([\d,\s]+)\]/);
      if (redes) contexto().redes = redes[1].split(',').map(r => r.trim()).filter(Boolean);
      const rede = linha.match(/rede=(\d+)/i);
      if (rede) { redeAtual = rede[1]; if (!contexto().redes.includes(redeAtual)) contexto().redes.push(redeAtual); }
      const lojas = linha.match(/findFarmaciasCampanha rede (\d+).*?\|\s*(\d+) farmacias/i);
      if (lojas) {
        redeAtual = lojas[1]; if (!contexto().redes.includes(redeAtual)) contexto().redes.push(redeAtual);
        if (Number(lojas[2]) === 0) contexto().semLojas.push(redeAtual);
      }
      const consulta = linha.match(/(findCampanhaCompletaNovaEdi|findCampanhaCompletaNova|findCampanhaCompletaRep).*?rede=(\d+),\s*UF=([^)]*).*?retornados:\s*(\d+)/i);
      if (consulta && Number(consulta[4]) === 0) contexto().consultas.push({ rede: consulta[2], uf: consulta[3].trim(), tipo: /Edi/i.test(consulta[1]) ? 'EDI' : (/Rep/i.test(consulta[1]) ? 'representante' : 'fornecedor direto') });
    }
    if (/UPLOAD FINALIZADO COM SUCESSO/.test(linha)) uploadSucesso = true;
    const arquivo = linha.match(/Arquivo:\s*(\d+\.json)\b/i);
    if (uploadSucesso && arquivo) { legados.add(arquivo[1]); uploadSucesso = false; }
    if (campanha && /Status:\s*GERADA(?:_MULTI_REDE)?\b/.test(linha)) legados.add(campanha + '.json');
    if (campanha && /Status:\s*VAZIA_SEM_PRODUTOS/.test(linha) && !eventos.get(campanha)?.estruturado) {
      const c = contexto();
      const problemas: { rede: string; uf: string; motivos: string[] }[] = [];
      c.semLojas.forEach(rede => problemas.push({ rede, uf: '', motivos: ['O log registrou zero lojas vinculadas retornadas pela consulta da campanha.'] }));
      c.consultas.forEach(q => problemas.push({ rede: q.rede, uf: q.uf, motivos: [`A consulta por ${q.tipo} não retornou produtos elegíveis para a UF ${q.uf}.`, 'O log antigo não detalha qual vínculo impediu o resultado. A conferência abaixo consulta os dados atuais.'] }));
      if (!problemas.length) (c.redes.length ? c.redes : ['']).forEach(rede => problemas.push({ rede, uf: '', motivos: ['A execução terminou sem dados elegíveis para gerar o arquivo. O log antigo não registrou a causa específica.'] }));
      eventos.set(campanha, { campanha, status: 'NAO_GERADA', problemas });
    }
  }
  const pendencias: PendenciaGeracao[] = [];
  for (const e of eventos.values()) {
    // Evento estruturado prevalece sobre inferencias do log antigo.
    legados.delete(e.campanha + '.json');
    if (['GERADA','PARCIAL'].includes(e.status)) legados.add(e.campanha + '.json');
    if (['NAO_GERADA','ERRO'].includes(e.status)) {
      const problemas = e.problemas?.length ? e.problemas : [{ motivos: ['Sem motivo detalhado no log.'] }];
      for (const p of problemas) pendencias.push({ campanha:String(e.campanha), status:e.status, rede:p.rede || '', uf:p.uf || '', motivos:p.motivos || [], data:e.data });
    }
  }
  const redesPorArquivo: Record<string, string[]> = {};
  for (const arquivo of legados) {
    const codigo = arquivo.replace(/\.json$/, '');
    const evento = eventos.get(codigo);
    const codigos = [
      ...(Array.isArray(evento?.redes) ? evento.redes : []),
      ...(evento?.problemas || []).map((p: any) => p.rede),
      ...(contextos.get(codigo)?.redes || [])
    ].map(String).filter(rede => /^\d+$/.test(rede));
    redesPorArquivo[arquivo] = Array.from(new Set(codigos));
  }
  return { arquivos: Array.from(legados).sort(), pendencias, redesPorArquivo };
}

// Uma linha por campanha/rede. A UF permanece apenas como contexto nos detalhes.
export function agruparPendenciasGeracao(itens: PendenciaGeracao[], nomes: Record<string, string> = {}): PendenciaGeracao[] {
  const grupos = new Map<string, PendenciaGeracao>();
  for (const item of itens) {
    const chave = item.campanha + ':' + item.rede;
    let grupo = grupos.get(chave);
    if (!grupo) {
      grupo = { ...item, nomeRede: nomes[item.rede] || item.nomeRede || 'Rede não identificada', uf: '', ufs: [], motivos: [] };
      grupos.set(chave, grupo);
    }
    const ufs = item.ufs || (item.uf ? item.uf.split(',').map(v => v.trim()).filter(Boolean) : []);
    for (const uf of ufs) if (!grupo.ufs!.includes(uf)) grupo.ufs!.push(uf);
    for (const motivo of item.motivos) if (!grupo.motivos.includes(motivo)) grupo.motivos.push(motivo);
  }
  for (const grupo of grupos.values()) { grupo.ufs!.sort(); grupo.uf = grupo.ufs!.join(', '); }
  return Array.from(grupos.values());
}
