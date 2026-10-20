const assert=require('assert');const {interpretar,agruparDiagnosticos,criarDiagnostico}=require('../campanhaDiagnostico');
const base={ativa:1,vigente:1,lojas:1,produtos:1,ativos:1,origem:2,edi:1,representante:474,fornecedorEdi:115,fornecedorRep:null,ufValida:1,produtosUf:1,fabricanteUf:1,fornecedorDiretoUf:0};
assert.deepStrictEqual(interpretar(base,'MG'),[]);
assert(interpretar({...base,fabricanteUf:0},'MG')[0].includes('fabricante'));
assert(interpretar({...base,produtosUf:0},'MG')[0].includes('Sem produtos ativos'));
assert(interpretar({...base,fornecedorEdi:null},'MG')[0].includes('Fornecedor EDI'));
assert(interpretar({...base,lojas:0,produtos:0},null).length===2);
assert(interpretar({...base,origem:1},'MG')[0].includes('fornecedor direto'));
assert.strictEqual(agruparDiagnosticos([{uf:'SP',motivos:['Sem fabricante.']},{uf:'MG',motivos:['Sem fabricante.']},{uf:'RS',motivos:[]}])[0].uf,'MG, SP');
(async()=>{let chamadas=0;const d=criarDiagnostico({query:async()=>{chamadas++;return [[]];}});await assert.rejects(d.consultar('1;DROP'));assert.strictEqual(chamadas,0);console.log('OK diagnostico: fabricante, UF, EDI integrado, lojas, fornecedor direto, agrupamento e rejeicao de entrada invalida.');})().catch(e=>{console.error(e);process.exitCode=1});

const {motivoProduto}=require('../campanhaDiagnostico');
assert(motivoProduto({codigo:123,cadastro:123,ativo:1,fabricanteCodigo:98},'mercaweb').includes('mercaweb.fabricante'));
assert(motivoProduto({codigo:123,cadastro:123,ativo:1,fabricanteCodigo:null},'mercaweb').includes('FAB_CODIGO não preenchido'));
assert(motivoProduto({codigo:123,cadastro:null},'mercaweb').includes('sem cadastro'));
assert(motivoProduto({codigo:123,cadastro:123,ativo:0},'mercaweb').includes('inativo'));
console.log('OK causas por produto: cadastro, ativo, fabricante ausente e codigo sem correspondente na base.');
