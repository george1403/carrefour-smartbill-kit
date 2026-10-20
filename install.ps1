# Windows: instalare fara drepturi de administrator. Pornit de install.bat (ExecutionPolicy Bypass doar pentru acest proces).
# Node.js portabil in .runtime\ (daca lipseste/e vechi), biblioteci (npm ci), browser Chromium in .runtime\browsers. Idempotent.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
try { [System.Net.WebRequest]::DefaultWebProxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials } catch {}

$Kit = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Kit
$NodeVersion = (Get-Content -LiteralPath (Join-Path $Kit '.node-version') -Raw).Trim()
$Rt = Join-Path $Kit '.runtime'
function Fail($m) {
  Write-Host ""; Write-Host "EROARE: $m" -ForegroundColor Red
  Write-Host "Verifica legatura la internet. Daca firma foloseste proxy, seteaza variabila HTTPS_PROXY si ruleaza din nou install.bat."
  Write-Host "Daca tot nu merge, fa o poza acestei ferestre si trimite-o persoanei de contact tehnic."
  exit 1
}
function Dl($url, $out) { for ($i = 1; $i -le 3; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out; return } catch { if ($i -eq 3) { throw } Start-Sleep 3 } } }

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
Write-Host "== Instalare Carrefour -> SmartBill (win-$arch) in: $Kit"

$useSystem = $false
if ($env:KIT_FORCE_PORTABLE_NODE -ne '1') {
  $sys = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($sys) { try { $maj = [int]((& $sys.Source -p "process.versions.node.split('.')[0]") 2>$null); if ($maj -ge 20) { $useSystem = $true } } catch {} }
}
if (-not $useSystem) {
  $name = "node-v$NodeVersion-win-$arch"
  $nd = Join-Path $Rt $name
  if (-not (Test-Path -LiteralPath (Join-Path $nd 'node.exe'))) {
    New-Item -ItemType Directory -Force -Path $Rt | Out-Null
    $zip = Join-Path $Rt "$name.zip"
    Write-Host "Descarc Node.js $NodeVersion (o singura data, ~30 MB)..."
    try { Dl "https://nodejs.org/dist/v$NodeVersion/$name.zip" $zip; Dl "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" (Join-Path $Rt 'SHASUMS256.txt') } catch { Fail "Nu pot descarca Node.js. ($($_.Exception.Message))" }
    $exp = (Select-String -LiteralPath (Join-Path $Rt 'SHASUMS256.txt') -Pattern " $name.zip$" | Select-Object -First 1).Line.Split(' ')[0]
    $act = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
    if (-not $exp -or $exp -ne $act) { Remove-Item -LiteralPath $zip -Force; Fail "Fisierul Node.js descarcat e incomplet/corupt." }
    try { Expand-Archive -LiteralPath $zip -DestinationPath $Rt -Force } catch { Fail "Nu pot dezarhiva Node.js." }
    Remove-Item -LiteralPath $zip -Force
  }
  $env:PATH = "$nd;$env:PATH"
}
$node = (Get-Command node.exe).Source
$npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'; if (-not (Test-Path -LiteralPath $npm)) { $npm = (Get-Command npm.cmd).Source }
$npx = Join-Path (Split-Path -Parent $node) 'npx.cmd'; if (-not (Test-Path -LiteralPath $npx)) { $npx = (Get-Command npx.cmd).Source }
Write-Host "Node.js: $(& $node -v)"

$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Rt 'browsers'
Write-Host "Instalez bibliotecile (npm ci)..."
& $npm ci --no-audit --no-fund --loglevel=error; if ($LASTEXITCODE -ne 0) { Fail "npm ci a esuat." }
Write-Host "Instalez browserul Chromium (o singura data, ~150 MB)..."
& $npx --no-install playwright install chromium; if ($LASTEXITCODE -ne 0) { Fail "Nu pot descarca browserul Chromium." }
& $node (Join-Path $Kit 'bin\kit.js') selftest; if ($LASTEXITCODE -ne 0) { Fail "Testul de verificare a esuat." }
Write-Host "== Instalare reusita." -ForegroundColor Green
if (-not (Test-Path (Join-Path $Kit '.env'))) { & $node (Join-Path $Kit 'bin\kit.js') import-config --auto }
if ((Test-Path (Join-Path $Kit '.env')) -and $env:KIT_FORCE_SETUP -ne '1') { Write-Host 'Configurarea exista deja (.env). Pentru a o reface: run.bat setup'; exit 0 }
if ($env:KIT_NO_SETUP -ne '1') { & $node (Join-Path $Kit 'bin\kit.js') setup }
