const assert=require('assert');const {resumoMonitoramento}=require('../geracaoMonitorResumo');
const e={campanha:'123',status:'NAO_GERADA',data:'2026-10-20T12:00:00Z',problemas:[{rede:'73',motivos:['Produto interno sem fabricante.']}]};
const d={arquivoEncontrado:true,invalidos:0,resultados:[e],pendencias:[e],consultadoEm:new Date().toISOString()};
const a=resumoMonitoramento(d);assert.strictEqual(a.status,'DISPONIVEL');assert.strictEqual(a.quantidade,1);assert(/^[a-f0-9]{64}$/.test(a.assinatura));
assert(!JSON.stringify(a).includes('Produto interno'));assert(!Object.prototype.hasOwnProperty.call(a,'campanha'));
assert.strictEqual(resumoMonitoramento({...d,consultadoEm:'outro'}).assinatura,a.assinatura);
assert.notStrictEqual(resumoMonitoramento({...d,pendencias:[{...e,data:'2026-10-20T13:00:00Z'}]}).assinatura,a.assinatura);
assert.strictEqual(resumoMonitoramento({...d,pendencias:[]}).quantidade,0);
for(const x of [{...d,arquivoEncontrado:false},{...d,invalidos:1},{...d,resultados:[]}]){assert.strictEqual(resumoMonitoramento(x).status,'INDISPONIVEL');assert.strictEqual(resumoMonitoramento(x).quantidade,null);}
console.log('OK monitor de geracao: resumo sem detalhes internos, assinatura por resultado, falha/arquivo ausente nao viram zero pendencias.');
