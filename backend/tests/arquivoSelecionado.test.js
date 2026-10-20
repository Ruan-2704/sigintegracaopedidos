const assert=require('assert');const {criarConsultaArquivo}=require('../arquivoSelecionado');
(async()=>{
 let leituras=0;let modo='ok';
 const bucket={file:nome=>({getMetadata:async()=>{leituras++;await new Promise(r=>setTimeout(r,5));if(modo==='404')throw Object.assign(new Error('missing'),{code:404});if(modo==='erro')throw Object.assign(new Error('network'),{code:503});return [{size:'123',updated:'2026-10-20'}];}})};
 const s=criarConsultaArquivo(bucket,f=>({nomeArquivo:f.name,tamanho:Number(f.metadata.size)}));
 const [a,b]=await Promise.all([s.buscar('14186.json'),s.buscar('14186.json')]);assert.strictEqual(leituras,1);assert.strictEqual(a[0].nomeArquivo,'14186.json');assert.strictEqual(b[0].tamanho,123);
 await s.buscar('14186.json');assert.strictEqual(leituras,1);
 await s.buscar('14186.json',true);assert.strictEqual(leituras,2);
 s.invalidar('14186.json');await s.buscar('14186.json');assert.strictEqual(leituras,3);
 await assert.rejects(s.buscar('../arquivo.json'),e=>e.status===400);
 modo='404';assert.deepStrictEqual(await s.buscar('99999.json'),[]);
 modo='erro';await assert.rejects(s.buscar('123.json'),e=>e.code===503);
 console.log('OK arquivo direto: consulta unica por nome, cache, concorrencia, refresh, exclusao, 404 e erro real. Nenhuma listagem global.');
})().catch(e=>{console.error(e);process.exitCode=1});
