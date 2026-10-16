# SIG Integração Pedidos

Painel operacional com frontend Angular e backend Node/Express para acompanhar integrações Cotefácil / SmartPed.

## Subir localmente

Backend:

```powershell
cd backend
npm start
```

Frontend:

```powershell
cd frontend
npx ng serve --host 0.0.0.0 --port 4300
```

API padrão local: `http://localhost:3300`.

## Configuração

Use `backend/.env.example` como base para criar `backend/.env`.

Nunca versionar:

- `backend/.env`
- arquivo JSON de chave GCP
- `node_modules`
- logs runtime

## Migrations auxiliares

Alertas:

```sql
backend/MIGRACAO_ALERTAS_INTEGRACAO.sql
```

Ações do painel:

```sql
backend/MIGRACAO_ACOES_PAINEL.sql
```

Índices recomendados para performance:

```sql
backend/MIGRACAO_INDICES_PERFORMANCE.sql
```

Antes de aplicar índices em produção, conferir se já existem índices equivalentes.

## Cache

O backend usa cache em memória para consultas caras:

- status de serviços: `STATUS_CACHE_TTL_MS`
- status antigo aceito enquanto atualiza em background: `STATUS_STALE_TTL_MS`
- logs de serviços: `LOGS_CACHE_TTL_MS`
- logs do crontab: `CRON_LOGS_CACHE_TTL_MS`
- bucket: `BUCKET_CACHE_TTL_MS`

No frontend, as principais telas salvam o último resultado no `localStorage` para abrir rápido e atualizar em seguida:

- dashboard
- serviços
- arquivos
- pedidos
- logs
- ações do painel

O botão `Atualizar` força nova consulta.

## Logs dos Serviços

A leitura dos logs de geração, exclusão e pedidos segue esta prioridade:

1. variável explícita no `.env`;
2. arquivo redirecionado na linha correspondente do crontab;
3. fallback `runtime-<script>.log`;
4. fallback extra para pedidos: `api-pedidos.log` e `nohup.out`.

Variáveis opcionais:

```text
LOG_GERACAO_FILE=
LOG_EXCLUSAO_FILE=
LOG_PEDIDOS_FILE=
```

A tela `Crontab` interpreta as últimas linhas dos logs operacionais de cada job agendado e mostra um resumo por eventos, como arquivos processados, pedidos, campanhas, alertas e erros. O botão `Visualizar log completo` abre a saída bruta quando for necessário investigar linha por linha. O backend também mantém uma rota de diagnóstico para conferir origem, caminho, existência e tamanho dos arquivos detectados.

## Deploy

Servidor:

```text
sigrede@sigpharma.com.br
```

Alvos atuais:

```text
Backend:  /home/sigrede/domains/api.sigcotacao.sigrede.com.br/API
Frontend: /home/sigrede/apps/sigcotacao/web/dist/frontend
PM2:      api.sigcotacao
Node:     14.21.3
NPM:      6.14.18
```

Rodar deploy a partir da raiz do projeto:

```powershell
.\scripts\deploy.ps1
```

O script:

- executa `npm run build` no frontend;
- empacota backend sem `.env`, `node_modules` e `runtime-logs`;
- empacota o build do frontend;
- envia os pacotes por SSH/SCP;
- cria backup remoto em `/home/sigrede/backups/sigcotacao/<data-hora>`;
- atualiza backend preservando `.env`, `node_modules` e `runtime-logs`;
- roda `npm install --production` no backend remoto;
- atualiza o frontend;
- reinicia `pm2 restart api.sigcotacao`;
- executa uma checagem básica com `pm2 describe`.

Opções úteis:

```powershell
.\scripts\deploy.ps1 -SkipBuild
.\scripts\deploy.ps1 -SkipConfirm
```


### Status da API na Central de Bases

A Central de Bases consulta GET /monitoramento/pedidos neste backend. A rota publica,
assim como /health, retorna somente success e data com status (ONLINE, OFFLINE ou
INDISPONIVEL) e verificadoEm em ISO UTC. Nao retorna hosts, PIDs ou comandos.
ONLINE exige que o mesmo PID ocupe PEDIDOS_PORT (padrao 8080) e corresponda ao
processo Java executando envia-cotacao-*.jar. Falhas de consulta retornam INDISPONIVEL.
A verificacao reaproveita o alvo SSH pedidos, tem prazo de 6 segundos e cache de
10 segundos com compartilhamento de consultas simultaneas. Nao inicia nem para processos.

No APISig, CENTRAL_BASES_SIG_COTACAO_STATUS_URL pode substituir o endereco padrao
https://api.sigcotacao.sigrede.com.br/monitoramento/pedidos. A Central rejeita
respostas com verificacao anterior a 90 segundos e conserva os alertas de pedidos.
Publicar primeiro este backend e depois o APISig e o frontend SIGREDE. Antes da
publicacao desta rota, o card mostrara Status indisponivel. Nao ha migracao de banco.


### Botoes iniciar/parar da API de pedidos com systemd

As duas rotas de inicio (/servicos/pedidos/start e /servicos/pedidos/iniciar)
e /servicos/pedidos/stop controlam exclusivamente sigcotacao.service no alvo
SSH pedidos. Nao executam mais nohup/java diretamente nem matam o PID pela porta.
O JAR e o diretorio usados sao os configurados no servico e seus drop-ins.
A consulta de status aceita envia-cotacao-*.jar, sem fixar uma versao antiga.
O start confirma estado ativo/MainPID; a disponibilidade HTTP segue sendo
verificada por processo/porta. O stop confirma estado inativo e MainPID zero.
Erros de sudo nao causam fallback para execucao manual.

No servidor da API, um administrador deve liberar apenas start/stop dessa unidade
para o usuario definido em SSH_PEDIDOS_USER no backend. Se for sigpedidos, usar
visudo -f /etc/sudoers.d/sigcotacao-painel e a regra:

    sigpedidos ALL=(root) NOPASSWD: /usr/bin/systemctl start sigcotacao.service, /usr/bin/systemctl stop sigcotacao.service

Validar com visudo -cf /etc/sudoers.d/sigcotacao-painel. Nao liberar sudo generico.
A parada pelo painel permanece intencional ate novo start; Restart=always continua
valendo para quedas do processo enquanto o servico estiver iniciado.


Para migrar a unidade existente preservando o JAR e os drop-ins, copiar
scripts/migrar-servico-sigcotacao.sh para o servidor da API e executar com sudo bash.
O script salva backup em /var/backups/sigcotacao, desabilita o nome anterior,
habilita sigcotacao.service e configura sudo start/stop para sigpedidos.
Mantem o estado anterior (API parada continua parada). Reiniciar o backend local
apos atualizar o codigo. A migracao nao atualiza a versao do JAR.

A referencia local JAR_PEDIDOS e o padrao do backend usam envia-cotacao-current.jar.
O link no servidor define a versao (0.0.9 na atualizacao solicitada). O painel
continua iniciando via sigcotacao.service; seu ExecStart deve usar esse mesmo link.
Reiniciar o backend local apos alterar o .env.

O terminal da API de pedidos (consulta e stream) le o journal de sigcotacao.service.
Por padrao filtra InvocationID da execucao atual para nao mostrar falhas antigas.
O filtro de dias consulta o historico da unidade. Erros de leitura sao apresentados
sem fallback para runtime-*.log. O usuario SSH precisa de leitura dos logs de sua
propria unidade; essa leitura foi verificada em sigpedidos sem sudo.


### Terminal ao vivo e historico de pedidos

Servicos usa SSE com uma conexao SSH continua compartilhada por servico. A API
acompanha journalctl -f da unidade sigcotacao.service e filtra a execucao atual;
geracao/exclusao acompanham tail -F da saida real da rotina. O backend libera a
conexao quando o ultimo usuario sai. Ha heartbeat, reconexao com espera progressiva,
limite de 1.000 linhas em tela e controles de rolagem que nao interrompem a coleta.
A origem, PID, versao e inicio da API sao informados pelo servidor.

GET /pedidos/log-historico (autenticado) consulta o arquivo atual e rotacoes
.log/.log.gz da API, sem utilizar logs de nohup. Os filtros aceitos sao dataInicio,
dataFim, nivel, pedido, campanha, rastreio e search. Page/limit paginam eventos
(50 por pagina por padrao, maximo 200), e uma stack trace pertence ao evento
que a iniciou. Mensagem resumida e detalhes completos sao retornados separados.
O scanner percorre os arquivos disponiveis sem tail limitado e informa falhas
parciais. O historico usa Python 3 no alvo SSH, ja verificado nesse servidor.
A retencao continua sendo definida no JAR: a tela nao apaga logs nem muda o prazo.

Logs e Auditoria permite expandir detalhes e baixar a pagina consultada em JSON.
O endpoint anterior /pedidos/log-erros permanece para compatibilidade; a nova
tela usa exclusivamente /pedidos/log-historico para os eventos persistidos.

Validacao sem build:
- node backend/tests/liveServiceLogs.test.js
- python3 backend/tests/pedidoLogHistory.test.py
- node frontend/node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js --noEmit -p frontend/tsconfig.app.json

Reiniciar o backend local e atualizar o frontend para carregar as alteracoes.
Para publicar, seguir scripts/deploy.ps1; nenhuma migracao SQL e necessaria.


### Categorias e auditoria de acessos

O login do painel registra LOGIN_ACEITO e LOGIN_RECUSADO em painel_acoes, com
horario/IP e sem persistir a credencial. A identidade continua compartilhada:
admin em sucesso; nao_identificado em tentativa recusada. Nao ha novo login individual.
O historico da API aceita niveis e categorias separados por virgula. Multiplos
valores sao combinados por OU dentro do filtro e por E entre filtros diferentes.
Campanhas/arquivos nao sao classificados automaticamente como falha de pedido.
A auditoria aceita varias acoes/status com parametros SQL. Os filtros de supressao
de infraestrutura do monitor foram preservados ate decisao do usuario.
Teste adicional: node backend/tests/auditLogin.test.js
