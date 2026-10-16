const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.resolve(__dirname,'..');
const calls=[];const moduleMock={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'auditService.js'),'utf8'),{module:moduleMock,require:()=>({query:async(sql,params)=>{calls.push({sql,params});return [{insertId:1}];}})});
const source=fs.readFileSync(path.join(root,'index.js'),'utf8');
const begin=source.indexOf("app.post('/auth/login',");const end=source.indexOf('app.use(authMiddleware)',begin);
let handler;const pending=[];
vm.runInNewContext(source.slice(begin,end),{app:{post:(route,fn)=>{handler=fn;}},PANEL_TOKEN:'fixture-password',Date,TOKEN_TTL_SECONDS:100,
 registrarAcaoPainelSeguro:payload=>pending.push(moduleMock.exports.registrarAcaoPainel(payload)),
 criarToken:()=> 'fixture-access-token',erroResponse:(res,status)=>{res.code=status;}});
(async()=>{
 for(const token of ['wrong-password','fixture-password']){
  const req={body:{token},headers:{},socket:{remoteAddress:'127.0.0.1'}};
  const res={json:value=>{res.body=value;}};
  handler(req,res);await Promise.all(pending);
 }
 const inserts=calls.filter(call=>call.sql.includes('INSERT INTO'));
 assert.equal(inserts.length,2);
 assert.equal(inserts[0].params[1],'LOGIN_RECUSADO');assert.equal(inserts[1].params[1],'LOGIN_ACEITO');
 assert.equal(inserts[0].params[6],'127.0.0.1');
 assert(!JSON.stringify(inserts).includes('fixture-password'));assert(!JSON.stringify(inserts).includes('wrong-password'));
 await moduleMock.exports.listarAcoesPainel({acao:'LOGIN_ACEITO,LOGIN_RECUSADO',status:'ERRO,SUCESSO'});
 assert(calls[calls.length-1].sql.includes('acao IN (?,?)'));assert(calls[calls.length-1].sql.includes('status IN (?,?)'));
 console.log('OK: login aceito/recusado com IP, sem credenciais e filtros SQL parametrizados multiplos.');
})().catch(error=>{console.error(error);process.exitCode=1;});
