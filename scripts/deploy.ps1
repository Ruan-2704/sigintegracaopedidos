param(
  [string]$SshHost = "sigrede@sigpharma.com.br",
  [string]$BackendDir = "/home/sigrede/domains/api.sigcotacao.sigrede.com.br/API",
  [string]$FrontendDir = "/home/sigrede/apps/sigcotacao/web/dist/frontend",
  [string]$Pm2Name = "api.sigcotacao",
  [switch]$SkipBuild,
  [switch]$SkipConfirm
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Comando obrigatorio nao encontrado no PATH: $Name"
  }
}

function Copy-DirectoryContent {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$Exclude = @()
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null

  Get-ChildItem -LiteralPath $Source -Force | Where-Object {
    $Exclude -notcontains $_.Name
  } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

$Root = Split-Path -Parent $PSScriptRoot
$BackendSource = Join-Path $Root "backend"
$FrontendSource = Join-Path $Root "frontend"
$FrontendDist = Join-Path $FrontendSource "dist\frontend"
$DeployRoot = Join-Path $Root ".deploy"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Stage = Join-Path $DeployRoot $Stamp
$BackendStage = Join-Path $Stage "backend"
$FrontendStage = Join-Path $Stage "frontend"
$BackendArchive = Join-Path $Stage "backend.tar.gz"
$FrontendArchive = Join-Path $Stage "frontend.tar.gz"
$RemoteTmp = "/tmp/sigcotacao-deploy-$Stamp"

Require-Command "ssh"
Require-Command "scp"
Require-Command "tar"
Require-Command "npm"

Write-Host "Deploy SIG Cotacao" -ForegroundColor Green
Write-Host "SSH:       $SshHost"
Write-Host "Backend:   $BackendDir"
Write-Host "Frontend:  $FrontendDir"
Write-Host "PM2:       $Pm2Name"

if (-not $SkipConfirm) {
  $confirm = Read-Host "Continuar com o deploy? Digite SIM"
  if ($confirm -ne "SIM") {
    Write-Host "Deploy cancelado."
    exit 0
  }
}

if (-not $SkipBuild) {
  Write-Step "Build do frontend"
  Push-Location $FrontendSource
  try {
    npm run build
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $FrontendDist)) {
  throw "Build do frontend nao encontrado em: $FrontendDist"
}

Write-Step "Preparando pacote local"
if (Test-Path $Stage) {
  Remove-Item -LiteralPath $Stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $BackendStage, $FrontendStage | Out-Null

Copy-DirectoryContent `
  -Source $BackendSource `
  -Destination $BackendStage `
  -Exclude @("node_modules", ".env", "runtime-logs")

Copy-DirectoryContent `
  -Source $FrontendDist `
  -Destination $FrontendStage

Write-Step "Compactando backend"
Push-Location $BackendStage
try {
  tar -czf $BackendArchive .
} finally {
  Pop-Location
}

Write-Step "Compactando frontend"
Push-Location $FrontendStage
try {
  tar -czf $FrontendArchive .
} finally {
  Pop-Location
}

Write-Step "Enviando pacotes para o servidor"
ssh $SshHost "mkdir -p '$RemoteTmp'"
scp $BackendArchive "${SshHost}:$RemoteTmp/backend.tar.gz"
scp $FrontendArchive "${SshHost}:$RemoteTmp/frontend.tar.gz"

$RemoteScript = @"
set -e

BACKEND_DIR='$BackendDir'
FRONTEND_DIR='$FrontendDir'
PM2_NAME='$Pm2Name'
REMOTE_TMP='$RemoteTmp'
STAMP='$Stamp'
BACKUP_ROOT="/home/sigrede/backups/sigcotacao"

echo "==> Conferindo diretorios"
test -d "`$BACKEND_DIR"
mkdir -p "`$FRONTEND_DIR"
mkdir -p "`$BACKUP_ROOT/`$STAMP"

echo "==> Backup backend"
tar --exclude='.env' --exclude='node_modules' --exclude='runtime-logs' -czf "`$BACKUP_ROOT/`$STAMP/backend.tar.gz" -C "`$BACKEND_DIR" .

echo "==> Backup frontend"
if [ -d "`$FRONTEND_DIR" ]; then
  tar -czf "`$BACKUP_ROOT/`$STAMP/frontend.tar.gz" -C "`$FRONTEND_DIR" .
fi

echo "==> Atualizando backend preservando .env, node_modules e runtime-logs"
find "`$BACKEND_DIR" -mindepth 1 \
  \( -name '.env' -o -name 'node_modules' -o -name 'runtime-logs' \) -prune \
  -o -exec rm -rf {} +
tar -xzf "`$REMOTE_TMP/backend.tar.gz" -C "`$BACKEND_DIR"

echo "==> Instalando dependencias backend"
cd "`$BACKEND_DIR"
npm install --production

echo "==> Atualizando frontend"
find "`$FRONTEND_DIR" -mindepth 1 -exec rm -rf {} +
tar -xzf "`$REMOTE_TMP/frontend.tar.gz" -C "`$FRONTEND_DIR"

echo "==> Reiniciando PM2"
pm2 restart "`$PM2_NAME"
pm2 save

echo "==> Validando processo"
pm2 describe "`$PM2_NAME" | egrep "name|status|script path|exec cwd|node.js version" || true

echo "==> Limpando temporarios"
rm -rf "`$REMOTE_TMP"

echo "Deploy concluido. Backup: `$BACKUP_ROOT/`$STAMP"
"@

$RemoteScriptPath = Join-Path $Stage "remote-deploy.sh"
Set-Content -LiteralPath $RemoteScriptPath -Value $RemoteScript -Encoding UTF8

Write-Step "Executando deploy remoto"
scp $RemoteScriptPath "${SshHost}:$RemoteTmp/remote-deploy.sh"
ssh $SshHost "bash '$RemoteTmp/remote-deploy.sh'"

Write-Step "Concluido"
Write-Host "Deploy finalizado com sucesso." -ForegroundColor Green
