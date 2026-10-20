const { schemaValido } = require('./redesService');
function erro(message, status=400) { return Object.assign(new Error(message),{status}); }
function interpretar(d, uf) {
  const motivos=[];
  if (!Number(d.ativa)) motivos.push('Campanha inativa.');
  if (Number(d.vigente) === 0) motivos.push('Vigência encerrada.');
  if (!Number(d.lojas)) motivos.push('Sem lojas válidas vinculadas à campanha.');
  if (!Number(d.produtos)) motivos.push('Sem produtos vinculados à campanha.');
  else if (!Number(d.ativos)) motivos.push('Os produtos vinculados não possuem cadastro ativo.');
  else if (uf !== null && !Number(d.ufValida)) motivos.push('UF da loja sem correspondência na integração: ' + (uf || 'não preenchida') + '.');
  else if (uf !== null && !Number(d.produtosUf)) motivos.push('Sem produtos ativos cadastrados para esta UF.');
  else if (uf !== null && !Number(d.fabricanteUf)) motivos.push('Nenhum produto ativo desta UF possui fabricante cadastrado.');
  if (Number(d.origem) === 1) {
    if (uf !== null && !Number(d.fornecedorDiretoUf)) motivos.push('Sem fornecedor direto vinculado que atenda a esta UF.');
  } else if (d.representante == null) motivos.push('Representante da campanha não encontrado.');
  else if (Number(d.edi) === 1 && d.fornecedorEdi == null) motivos.push('Fornecedor EDI vinculado ao representante não encontrado no cadastro integrado.');
  else if (Number(d.edi) !== 1 && d.fornecedorRep == null) motivos.push('Fornecedor vinculado ao representante não encontrado.');
  return motivos;
}
function agruparDiagnosticos(diagnosticos) {
  const grupos = new Map();
  for (const d of diagnosticos) {
    const chave = JSON.stringify(d.motivos);
    if (!grupos.has(chave)) grupos.set(chave, { ufs: [], motivos: d.motivos });
    if (d.uf) grupos.get(chave).ufs.push(d.uf);
  }
  return Array.from(grupos.values()).map(g => ({ ...g, uf: g.ufs.sort().join(', ') }));
}
function motivoProduto(produto, base) {
  if (produto.cadastro == null) return `Produto ${produto.codigo} sem cadastro correspondente em ${base}.medicamentos.`;
  if (Number(produto.ativo) !== 1) return `Produto ${produto.codigo} inativo em ${base}.medicamentos; a geração aceita somente produtos ativos.`;
  if (produto.fabricanteCodigo == null) return `Produto ${produto.codigo} sem fabricante vinculado em ${base}.medicamentos (FAB_CODIGO não preenchido).`;
  return `Produto ${produto.codigo} referencia o fabricante ${produto.fabricanteCodigo}, que não foi encontrado em ${base}.fabricante.`;
}
function criarDiagnostico(pool) {
  const cache=new Map(), pendentes=new Map();
  async function query(sql, params=[]) { const [rows]=await pool.query({sql,timeout:8000},params); return rows; }
  async function consultar(campanha, rede='') {
    campanha=String(campanha || ''); rede=String(rede || '');
    if (!/^\d{1,15}$/.test(campanha) || (rede && !/^\d{1,10}$/.test(rede))) throw erro('Campanha/rede inválida.');
    const key=campanha+':'+rede, existente=cache.get(key);
    if (existente && Date.now()-existente.ts < 60000) return existente.data;
    if (pendentes.has(key)) return pendentes.get(key);
    const consulta=(async()=>{
      const views=await query("SELECT VIEW_DEFINITION AS definicao FROM information_schema.VIEWS WHERE TABLE_SCHEMA='integracaopedidos' AND TABLE_NAME='vw_farmacias_operacoeslogistica_integra'");
      const definicao=String(views[0]?.definicao || '').replace(/`/g,'').toLowerCase();
      if (!definicao) throw erro('Definição da view indisponível para confirmar as bases da integração.',503);
      const bases=new Set(Array.from(definicao.matchAll(/\b([a-z][a-z0-9_]*)\.operacoes_logisticas\b/g),m=>m[1]));
      const catalogo=await query('SELECT CODIGO AS codigo, NOME AS nome, BANCO_DADOS_NOME AS base FROM gestao.redes');
      const candidatas=catalogo.filter(r=>schemaValido(r.base) && bases.has(r.base) && (!rede || String(r.codigo)===rede));
      const resultado=[];
      for (const r of candidatas) {
        const s=r.base;
        const metas=await query("SELECT TABLE_NAME AS nome FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='fornecedor_edi'",[s]);
        const ediLocal=metas.length ? `EXISTS(SELECT 1 FROM ${s}.fornecedor_edi el WHERE el.FOR_CODIGO=r.FOR_EDI_CODIGO)` : '0';
        const cab=await query(`SELECT ol.OPL_DESCRICAO AS descricao, ol.OPL_ATIVO AS ativa,
          (ol.OPL_DT_FIM>NOW()) AS vigente, ol.OPL_ORIGEM AS origem, ol.UTILIZA_EDI AS edi,
          r.REP_CODIGO AS representante, r.FOR_EDI_CODIGO AS codigoEdi,
          e.FOR_CODIGO AS fornecedorEdi, f.FOR_CODIGO AS fornecedorRep, ${ediLocal} AS ediLocal,
          (SELECT COUNT(*) FROM ${s}.farmacias_opl fo JOIN ${s}.farmacias fa ON fa.FAR_CODIGO=fo.FAR_CODIGO WHERE fo.OPL_CODIGO=ol.OPL_CODIGO) AS lojas,
          (SELECT COUNT(*) FROM ${s}.medicamentos_opl mo WHERE mo.OPL_CODIGO=ol.OPL_CODIGO) AS produtos,
          EXISTS(SELECT 1 FROM ${s}.medicamentos_opl mo JOIN ${s}.medicamentos m ON m.MED_CODIGO=mo.MED_CODIGO AND m.MED_ATIVO=1 WHERE mo.OPL_CODIGO=ol.OPL_CODIGO) AS ativos
          FROM ${s}.operacoes_logisticas ol LEFT JOIN ${s}.representantes r ON r.REP_CODIGO=ol.REP_CODIGO
          LEFT JOIN integracaopedidos.vw_fornecedor_edi_integra e ON e.FOR_CODIGO=r.FOR_EDI_CODIGO
          LEFT JOIN ${s}.fornecedores f ON f.FOR_CODIGO=r.FOR_CODIGO WHERE ol.OPL_CODIGO=?`,[campanha]);
        if (!cab.length) continue;
        const d=cab[0];
        const ufs=await query(`SELECT DISTINCT fa.FAR_UF AS uf FROM ${s}.farmacias_opl fo JOIN ${s}.farmacias fa ON fa.FAR_CODIGO=fo.FAR_CODIGO WHERE fo.OPL_CODIGO=? LIMIT 28`,[campanha]);
        const diagnosticos=[];
        if (!ufs.length) diagnosticos.push({uf:'',motivos:interpretar(d,null)});
        for (const item of ufs) {
          const uf=item.uf || '';
          const [flags]=await query(`SELECT
            EXISTS(SELECT 1 FROM integracaopedidos.vw_estado_temp_integra u WHERE u.uf=?) AS ufValida,
            EXISTS(SELECT 1 FROM ${s}.medicamentos_opl mo JOIN ${s}.medicamentos m ON m.MED_CODIGO=mo.MED_CODIGO AND m.MED_ATIVO=1 JOIN integracaopedidos.vw_estado_temp_integra u ON u.id=mo.UF_CODIGO WHERE mo.OPL_CODIGO=? AND u.uf=?) AS produtosUf,
            EXISTS(SELECT 1 FROM ${s}.medicamentos_opl mo JOIN ${s}.medicamentos m ON m.MED_CODIGO=mo.MED_CODIGO AND m.MED_ATIVO=1 JOIN ${s}.fabricante fab ON fab.FAB_CODIGO=m.FAB_CODIGO JOIN integracaopedidos.vw_estado_temp_integra u ON u.id=mo.UF_CODIGO WHERE mo.OPL_CODIGO=? AND u.uf=?) AS fabricanteUf,
            EXISTS(SELECT 1 FROM ${s}.fornecedores_participa_operacao_logistica fp JOIN ${s}.fornecedores fd ON fd.FOR_CODIGO=fp.FOR_CODIGO WHERE fp.OPL_CODIGO=? AND fd.FOR_UF=?) AS fornecedorDiretoUf`,[uf,campanha,uf,campanha,uf,campanha,uf]);
          diagnosticos.push({uf,motivos:interpretar({...d,...flags},uf)});
        }
        const produtosProblema = await query(`SELECT mo.MED_CODIGO AS codigo, m.MED_CODIGO AS cadastro,
          m.MED_NOME AS nome, m.MED_COD_BARRAS AS ean, m.MED_ATIVO AS ativo, m.FAB_CODIGO AS fabricanteCodigo,
          GROUP_CONCAT(DISTINCT COALESCE(u.uf, CAST(mo.UF_CODIGO AS CHAR)) ORDER BY u.uf SEPARATOR ', ') AS ufs
          FROM ${s}.medicamentos_opl mo
          LEFT JOIN ${s}.medicamentos m ON m.MED_CODIGO=mo.MED_CODIGO
          LEFT JOIN ${s}.fabricante fab ON fab.FAB_CODIGO=m.FAB_CODIGO
          LEFT JOIN integracaopedidos.vw_estado_temp_integra u ON u.id=mo.UF_CODIGO
          WHERE mo.OPL_CODIGO=? AND (m.MED_CODIGO IS NULL OR COALESCE(m.MED_ATIVO,0)<>1 OR m.FAB_CODIGO IS NULL OR fab.FAB_CODIGO IS NULL)
          AND (u.uf IS NULL OR EXISTS(SELECT 1 FROM ${s}.farmacias_opl fo JOIN ${s}.farmacias fa ON fa.FAR_CODIGO=fo.FAR_CODIGO WHERE fo.OPL_CODIGO=mo.OPL_CODIGO AND fa.FAR_UF=u.uf))
          GROUP BY mo.MED_CODIGO,m.MED_CODIGO,m.MED_NOME,m.MED_COD_BARRAS,m.MED_ATIVO,m.FAB_CODIGO ORDER BY mo.MED_CODIGO LIMIT 201`,[campanha]);
        const produtosPendentes = produtosProblema.slice(0,200).map(produto => ({...produto, motivo:motivoProduto(produto,s)}));
        const observacoes=[];
        if (Number(d.edi)===1 && d.fornecedorEdi!=null && !Number(d.ediLocal)) observacoes.push(`Fornecedor EDI ${d.codigoEdi} encontrado no cadastro integrado, mas ausente na tabela local. A versão antiga do gerador consulta essa tabela local e pode não encontrá-lo.`);
        resultado.push({...r,descricao:d.descricao,lojas:Number(d.lojas),produtos:Number(d.produtos),diagnosticos:agruparDiagnosticos(diagnosticos),produtosPendentes,produtosPendentesLimitados:produtosProblema.length>200,observacoes});
      }
      const data={campanha,consultadoEm:new Date().toISOString(),redes:resultado,
        aviso:'Conferência dos dados atuais. Não comprova a causa histórica, não verifica o arquivo no bucket e não regenera a campanha.'};
      if(cache.size>=150) cache.delete(cache.keys().next().value);
      cache.set(key,{ts:Date.now(),data});return data;
    })();
    pendentes.set(key,consulta);try{return await consulta;}finally{pendentes.delete(key);}
  }
  return {consultar};
}
module.exports={criarDiagnostico,interpretar,agruparDiagnosticos,motivoProduto};
