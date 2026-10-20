const assert=require('assert');
const {resumirResultados}=require('../geracaoResultados');
const linha=(campanha,status,problemas=[])=>'[CAMPANHA_RESULTADO] '+JSON.stringify({campanha,status,arquivo:campanha+'.json',data:'2026-10-20T16:00:00-03:00',problemas});
let r=resumirResultados([linha('1','NAO_GERADA',[{rede:'7',uf:'MG',motivos:['Sem produtos.']}]),linha('2','ATUALIZADA'),linha('3','LOCAL_SEM_UPLOAD'),linha('4','GERADA'),linha('5','PARCIAL',[{motivos:['Sem fabricante.']}])].join('\n'));
assert.deepStrictEqual(r.arquivos.sort(),['4.json','5.json']);assert.strictEqual(r.pendencias.length,2);
r=resumirResultados([linha('1','NAO_GERADA'),linha('1','GERADA')].join('\n'));assert.strictEqual(r.pendencias.length,0);assert.strictEqual(r.arquivos.length,1);
r=resumirResultados(linha('1','GERADA')+'\n[CAMPANHA_RESULTADO] {');assert.strictEqual(r.invalidos,1);assert.strictEqual(r.arquivos.length,1);
r=resumirResultados(linha('abc','GERADA')+'\n'+linha('2','INVALIDO'));assert.strictEqual(r.invalidos,2);assert.strictEqual(r.arquivos.length,0);
assert.strictEqual(resumirResultados('').resultados.length,0);
console.log('OK: gerada, parcial, atualizada, local, resolucao de pendencia, JSON truncado e estado desconhecido.');

r=resumirResultados([linha('1','PARCIAL',[{motivos:['Sem fabricante.']}]),linha('1','ATUALIZADA')].join('\n'));
assert.strictEqual(r.pendencias.length,1);assert.strictEqual(r.pendencias[0].status,'PARCIAL');
console.log('OK: bucket atualizado nao apaga pendencia sem reprocessar.');
