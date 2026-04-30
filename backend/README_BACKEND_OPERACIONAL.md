# Backend SIG Integração Pedidos — Operacional

## O que foi adicionado

- Login por token: `POST /auth/login`
- Middleware protegendo as rotas internas
- Status de serviços: `GET /servicos/status`
- Iniciar geração: `POST /servicos/geracao/start`
- Iniciar exclusão: `POST /servicos/exclusao/start`
- Parar processo por porta: `POST /servicos/:servico/stop`
- Ler logs: `GET /servicos/:servico/logs`
- Stream SSE dos logs: `GET /servicos/:servico/logs/stream`
- Ler crontab: `GET /cron`
- Salvar crontab: `POST /cron` somente com `ALLOW_CRON_WRITE=true`

## Instalação

```bash
cd backend
npm install
cp .env.example .env
nano .env
npm run dev
```

## Teste rápido

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"token":"SEU_PANEL_TOKEN"}' | jq -r '.data.accessToken')

curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/servicos/status
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3001/servicos/geracao/start
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/servicos/geracao/logs
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/cron
```

## Observação importante

A lógica dos scripts foi mantida. Se o script já verifica porta e mata processo, o backend apenas executa o `.sh` e captura o log.
