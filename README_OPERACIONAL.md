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
