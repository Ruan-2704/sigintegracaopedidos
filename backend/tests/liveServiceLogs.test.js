const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname,'../..');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function testSharedStream() {
  let handlers, opened=0, closed=0;
  const timers = new Set();
  const mock = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'backend/liveServiceLogs.js'),'utf8'),{
    module:mock,Buffer,Date,console,
    setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),
    require:name=>name==='./sshClient'?{streamSshCommand:(cmd,target,h)=>{opened++;handlers=h;return{close(){closed++;}};}}:
      name==='./pedidosSystemd'?{estado:async()=>({MainPID:'42',InvocationID:'a'.repeat(32),ExecStart:'-jar /app/envia-cotacao-current.jar'})}:
      name==='./remoteExecution'?{isSshMode:()=>true,isWindowsLocalMode:()=>false,executarComando:async()=>'/app/envia-cotacao-0.0.9.jar'}:require(name)
  });
  const one=[],two=[];
  const off1=mock.exports.subscribe('pedidos',{},event=>one.push(event));
  const off2=mock.exports.subscribe('pedidos',{},event=>two.push(event));
  await tick();await tick();assert.equal(opened,1);
  const emit=(inv,text,time=Date.now())=>handlers.data(Buffer.from(JSON.stringify({_SYSTEMD_INVOCATION_ID:inv,__REALTIME_TIMESTAMP:String(time*1000),MESSAGE:text,_PID:'42'})+'\n'));
  emit('old','historico antigo',1);
  emit('a'.repeat(32),'INFO Started CotacaoApplication');
  timers.forEach(fn=>fn());
  assert.equal(one[one.length-1].novasLinhas[0],'INFO Started CotacaoApplication');
  assert(!JSON.stringify(one).includes('historico antigo'));
  emit('b'.repeat(32),'INFO Starting CotacaoApplication v0.0.10');
  timers.forEach(fn=>fn());
  assert(one.some(e=>e.tipo==='init'&&e.meta.invocationId==='b'.repeat(32)));
  assert.equal(one[one.length-1].meta.versao,'0.0.10');
  off1();assert.equal(closed,0);off2();assert.equal(closed,1);assert.equal(timers.size,0);
}
async function testTerminalControls() {
  const ts=require(path.join(root,'frontend/node_modules/typescript'));
  const source=ts.transpileModule(fs.readFileSync(path.join(root,'frontend/src/app/pages/servicos/servicos.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,experimentalDecorators:true}}).outputText;
  const streams=[],timers=[];const exports={};
  const sandbox={exports,console,Date,confirm:()=>true,
    window:{setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},setInterval:()=>99,clearInterval(){},requestAnimationFrame:fn=>fn()},
    require:()=>({Component:()=>()=>{},ViewChild:()=>()=>{}})};
  vm.runInNewContext(source,sandbox);
  for(const key of ['pedidos','geracao','exclusao']){
    const component=new exports.ServicosComponent({streamLogsServico:()=>{const stream={close(){}};streams.push(stream);return stream;}},{detectChanges(){}});
    component.selecionarLog(key);
    let stream=streams[streams.length-1];
    stream.onmessage({data:JSON.stringify({tipo:'init',linhas:['INFO mensagem normal'],meta:{pid:42}})});
    assert.equal(component.conexaoLog,'Conectado');assert.equal(component.seguirTerminal,true);
    component.pausarRolagem();stream.onmessage({data:JSON.stringify({tipo:'append',novasLinhas:['ERROR falha real']})});
    assert.equal(component.logs.length,2);assert.equal(component.seguirTerminal,false);
    assert.equal(component.linhaErro('INFO sem erro'),false);assert.equal(component.linhaErro('ERROR falha'),true);
    component.acompanharTerminal();assert.equal(component.seguirTerminal,true);
    stream.onmessage({data:JSON.stringify({tipo:'erro',mensagem:'SSH caiu'})});
    assert.equal(component.conexaoLog,'Reconectando');assert.equal(component.erroTerminal,'SSH caiu');
    timers[timers.length-1]();stream=streams[streams.length-1];
    stream.onmessage({data:JSON.stringify({tipo:'init',linhas:['INFO retomado']})});
    assert.equal(component.conexaoLog,'Conectado');assert.equal(component.logs.length,1);
    component.ngOnDestroy();assert.equal(component.conexaoLog,'Desconectado');
  }
}
(async()=>{await testSharedStream();await testTerminalControls();console.log('OK: fluxo compartilhado, troca de execucao, encerramento, reconexao e rolagem dos tres servicos.');})().catch(error=>{console.error(error);process.exitCode=1;});
