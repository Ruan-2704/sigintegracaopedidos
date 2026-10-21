const assert=require('assert');
const {resumirResultados}=require('../geracaoResultados');
const linha=(campanha,status,problemas=[])=>'[CAMPANHA_RESULTADO] '+JSON.stringify({campanha,status,arquivo:campanha+'.json',data:'2026-10-20T16:00:00-03:00',problemas});
let r=resumirResultados([linha('1','NAO_GERADA',[{rede:'7',uf:'MG',motivos:['Sem produtos.']}]),linha('2','ATUALIZADA'),linha('3','LOCAL_SEM_UPLOAD'),linha('4','GERADA'),linha('5','PARCIAL',[{motivos:['Sem fabricante.']}])].join('\n'));
assert.deepStrictEqual(r.arquivos.sort(),['4.json','5.json']);assert.strictEqual(r.pendencias.length,1);
r=resumirResultados([linha('1','NAO_GERADA'),linha('1','GERADA')].join('\n'));assert.strictEqual(r.pendencias.length,0);assert.strictEqual(r.arquivos.length,1);
r=resumirResultados(linha('1','GERADA')+'\n[CAMPANHA_RESULTADO] {');assert.strictEqual(r.invalidos,1);assert.strictEqual(r.arquivos.length,1);
r=resumirResultados(linha('abc','GERADA')+'\n'+linha('2','INVALIDO'));assert.strictEqual(r.invalidos,2);assert.strictEqual(r.arquivos.length,0);
assert.strictEqual(resumirResultados('').resultados.length,0);
console.log('OK: gerada, parcial, atualizada, local, resolucao de pendencia, JSON truncado e estado desconhecido.');

r=resumirResultados([linha('1','PARCIAL',[{motivos:['Sem fabricante.']}]),linha('1','ATUALIZADA')].join('\n'));
assert.strictEqual(r.pendencias.length,0);assert.strictEqual(r.resultados[0].status,'PARCIAL');assert.deepStrictEqual(r.arquivos,['1.json']);
console.log('OK: arquivo parcial permanece em gerados, sem pendencia ou alerta.');

const { filtrarPendenciasRedes } = require('../geracaoResultados');
const fonte = resumirResultados([
  '[CAMPANHA_RESULTADO] '+JSON.stringify({campanha:'50247',status:'NAO_GERADA',redes:['75'],problemas:[{rede:'75',motivos:['Sem produtos.']}]}),
  '[CAMPANHA_RESULTADO] '+JSON.stringify({campanha:'40870',status:'NAO_GERADA',redes:['73'],problemas:[{rede:'73',motivos:['Sem fabricante.']}]}),
  '[CAMPANHA_RESULTADO] '+JSON.stringify({campanha:'40868',status:'GERADA',redes:['73'],problemas:[]})
].join('\n'));
assert.deepStrictEqual(filtrarPendenciasRedes(fonte,[73]).pendencias.map(e=>e.campanha),['40870']);
assert.deepStrictEqual(filtrarPendenciasRedes(fonte,[]).pendencias,[]);
assert.deepStrictEqual(filtrarPendenciasRedes(fonte,[]).arquivos,['40868.json']);
assert.strictEqual(fonte.pendencias.length,2);
console.log('OK: redes desativadas fora das pendencias sem apagar historico ou cache original.');
