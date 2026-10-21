# Windows: instalare fara drepturi de administrator. Pornit de install.bat (ExecutionPolicy Bypass doar pentru acest proces).
# Node.js portabil in .runtime\ (daca lipseste/e vechi), biblioteci (npm ci), browser Chromium in .runtime\browsers. Idempotent.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
try { [System.Net.WebRequest]::DefaultWebProxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials } catch {}

# stale test hooks (mock/demo variables inherited by Explorer) never reach a real install
if ($env:KIT_TEST_MODE -ne '1') { foreach ($v in @('KIT_SETUP_MOCK','KIT_CARREFOUR_DOCS_URL','KIT_DEMO_MOCK_MODE','KIT_STOP_BEFORE_FINAL','KIT_BULK_CONFIRM','KIT_IMPORT_CONFIRM','KIT_RATE_MS','KIT_RETRY_MS','KIT_SUBMIT_WAIT','KIT_NAV_TIMEOUT','KIT_MANUAL_TIMEOUT_MS','KIT_SLOW','KIT_SUPPORT_NO_SELFTEST','KIT_TEST_CLOSE_MS','KIT_TEST_HEADLESS','KIT_TEST_DESKTOPS','KIT_TEST_DIALOG','KIT_TEST_SAC')) { Remove-Item -LiteralPath ("Env:" + $v) -ErrorAction SilentlyContinue } }
$Kit = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Kit
$NodeVersion = (Get-Content -LiteralPath (Join-Path $Kit '.node-version') -Raw).Trim()
$Rt = Join-Path $Kit '.runtime'
function Fail($m, [switch]$Local) {
  Write-Host ""; Write-Host "EROARE: $m" -ForegroundColor Red
  if (-not $Local) { Write-Host "Verifica legatura la internet. Daca firma foloseste proxy, cere ajutor persoanei tehnice a firmei, apoi da din nou dublu-click pe install.bat." }
  Write-Host "Daca tot nu merge, fa o poza acestei ferestre si trimite-o lui George (WhatsApp/email)."
  exit 1
}
function Dl($url, $out) { for ($i = 1; $i -le 3; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out; return } catch { if ($i -eq 3) { throw } Start-Sleep 3 } } }

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
Write-Host "== Instalare Carrefour -> SmartBill (win-$arch) in: $Kit"
# common traps, checked before downloading anything (plain Romanian, nothing changed yet)
if ($Kit -match '\\AppData\\Local\\Temp\\' -and $Kit -match '(\.zip|Temp\d+_)') { Fail "Ati pornit install.bat direct din ZIP, fara sa-l dezarhivati. Inchideti fereastra, click dreapta pe ZIP > Extrage tot > Extragere, apoi dublu-click pe install.bat din folderul extras." -Local }
try { $probe = Join-Path $Kit ('.scriere-test-' + $PID); [IO.File]::WriteAllText($probe, 'ok'); Remove-Item -LiteralPath $probe -Force } catch { Fail "Nu pot scrie in folderul programului ($Kit). Mutati folderul in Documente (sau pe Desktop) si porniti din nou install.bat." -Local }
try { $free = (Get-PSDrive -Name ($Kit.Substring(0,1))).Free; if ($free -and $free -lt 1GB) { Fail ("Pe disc mai sunt doar {0:N0} MB liberi; programul are nevoie de aproximativ 1 GB. Eliberati spatiu, apoi porniti din nou install.bat." -f ($free / 1MB)) -Local } } catch {}
foreach ($od in @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial)) { if ($od -and $Kit.ToLower().StartsWith($od.ToLower())) { Write-Host "ATENTIE: folderul programului este in OneDrive ($od). OneDrive poate bloca sau dubla fisierele programului (jurnalele facturilor). Recomandat: mutati folderul in C:\Users\$env:USERNAME\ (in afara OneDrive) si porniti din nou install.bat." -ForegroundColor Yellow; break } }

# Desktop shortcuts are made FIRST (before any download), so the producer always gets them, even if a later step fails;
# run.bat explains in Romanian if the install is not finished. Desktop = the real one (also when OneDrive redirects it).
# Another kit's shortcut is never overwritten ("Carrefour SmartBill (<folder>)").
$uiLnk = $null; $scMsg = $null
if ($env:KIT_NO_SHORTCUT -ne '1') {
  try {
    $ws = New-Object -ComObject WScript.Shell
    $cands = @($env:KIT_DESKTOP, [Environment]::GetFolderPath('Desktop'), $(if ($env:OneDrive) { Join-Path $env:OneDrive 'Desktop' }), (Join-Path $env:USERPROFILE 'Desktop')) | Where-Object { $_ }
    $desk = $cands | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -First 1
    if (-not $desk) { $desk = $cands[0]; New-Item -ItemType Directory -Force -Path $desk | Out-Null }
    function ScName($b) { $p = Join-Path $desk ($b + '.lnk'); if (-not (Test-Path -LiteralPath $p)) { return $b }
      try { if ($ws.CreateShortcut($p).TargetPath.StartsWith($Kit, [StringComparison]::OrdinalIgnoreCase)) { return $b } } catch {}
      $t = ((Split-Path -Leaf $Kit) -replace '[\\/:*?"<>|()]', ' ').Trim(); return "$b ($t)" }
    $uiName = ScName 'Carrefour SmartBill'; $mnName = ScName 'Carrefour SmartBill - Meniu text'
    $lnk = $ws.CreateShortcut((Join-Path $desk ($uiName + '.lnk'))); $lnk.TargetPath = (Join-Path $Kit 'run.bat'); $lnk.Arguments = 'ui'; $lnk.WorkingDirectory = $Kit; $lnk.WindowStyle = 7; $lnk.Save()
    $m = $ws.CreateShortcut((Join-Path $desk ($mnName + '.lnk'))); $m.TargetPath = (Join-Path $Kit 'run.bat'); $m.WorkingDirectory = $Kit; $m.Save()
    $uiLnk = Join-Path $desk ($uiName + '.lnk')
    if (Test-Path -LiteralPath $uiLnk) { $scMsg = "Scurtatura programului este pe Desktop: ""$uiName""   (folderul $desk)"; Write-Host $scMsg -ForegroundColor Green } else { throw 'nu exista dupa salvare' }
  } catch { $uiLnk = $null; Write-Host "ATENTIE: nu am putut pune scurtatura pe Desktop ($($_.Exception.Message)). Programul se porneste si cu dublu-click pe run.bat (folderul $Kit)" -ForegroundColor Yellow }
}

# Smart App Control (Windows 11) blocks the program's files: it must be OFF before installing
$sac = $null; try { $sac = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState -ErrorAction Stop).VerifiedAndReputablePolicyState } catch {}
if ($env:KIT_TEST_SAC) { $sac = [int]$env:KIT_TEST_SAC }
if ($sac -eq 1) {
  Write-Host ""
  Write-Host "Pe acest calculator este PORNIT Smart App Control (Control inteligent al aplicatiilor). El blocheaza programul." -ForegroundColor Yellow
  Write-Host "Opriti-l INAINTE de instalare:"
  Write-Host "  1. Start > Securitate Windows"
  Write-Host "  2. Control aplicatii si browser > Setari Smart App Control"
  Write-Host "  3. Alegeti Dezactivat (Off)."
  Write-Host "Windows va avertizeaza ca nu il mai puteti porni din nou fara o resetare a calculatorului: este in regula, apasati Da."
  Fail "Smart App Control este pornit. Dupa ce il opriti, dati din nou dublu-click pe install.bat." -Local
}

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
Write-Host "Instalez bibliotecile programului..."
& $npm ci --no-audit --no-fund --loglevel=error; if ($LASTEXITCODE -ne 0) { Fail "Nu pot instala bibliotecile programului." }
Write-Host "Instalez browserul Chromium (o singura data, ~150 MB)..."
& $npx --no-install playwright install chromium; if ($LASTEXITCODE -ne 0) { Fail "Nu pot descarca browserul Chromium." }
& $node (Join-Path $Kit 'bin\kit.js') selftest; if ($LASTEXITCODE -ne 0) { Fail "Testul de verificare a esuat." }
Write-Host "== Instalare reusita." -ForegroundColor Green
# files from a downloaded ZIP carry the "from internet" mark (SmartScreen asks each time): remove it inside the kit folder only
try { Get-ChildItem -LiteralPath $Kit -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notlike '*\node_modules\*' -and $_.FullName -notlike '*\.runtime\*' } | Unblock-File -ErrorAction SilentlyContinue } catch {}
if ($scMsg) { Write-Host $scMsg -ForegroundColor Green }
if ((Test-Path (Join-Path $Kit '.env')) -and $env:KIT_FORCE_SETUP -ne '1') { Write-Host 'Configurarea exista deja. Pentru a o schimba: dublu-click pe scurtatura Carrefour SmartBill de pe Desktop (sau pe run.bat), apoi apasa Configurare.'; exit 0 }
if ($env:KIT_NO_SETUP -ne '1' -and $uiLnk) { Write-Host 'Se deschide programul in browser: apasa Configurare.'; Start-Process -FilePath $uiLnk; exit 0 }
if ($env:KIT_NO_SETUP -ne '1') { & $node (Join-Path $Kit 'bin\kit.js') setup }
