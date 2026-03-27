# =====================================================================
# TubitBlockWeb 本地編譯器啟動腳本 (Windows PowerShell)
# 功能：自動安裝 Node.js 與 arduino-cli，安裝 ESP32 核心，
#       啟動 compiler-server 在 localhost:3000。
# =====================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$osArch = $env:PROCESSOR_ARCHITECTURE
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  TubitBlockWeb 本地編譯器安裝與啟動工具" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  CPU 架構 : $osArch" -ForegroundColor DarkGray
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

# ---- 統一下載函數 ----
function Receive-FileSimple {
    param([string]$Url, [string]$OutFile, [string]$DisplayName)
    Write-Host "    正在下載: $DisplayName" -ForegroundColor DarkGray
    $oldPref = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
        $sizeMB = [math]::Round((Get-Item $OutFile).Length / 1MB, 1)
        Write-Host "    下載完成 (${sizeMB} MB)" -ForegroundColor Green
    } finally {
        $ProgressPreference = $oldPref
    }
}

# ---- 第一步：檢查 Node.js ----
Write-Host "[1/4] 正在檢查 Node.js 環境..." -ForegroundColor Yellow

$npmPath = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmPath) {
    Write-Host "  找不到 Node.js，正在自動安裝..." -ForegroundColor Red
    
    $wingetPath = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetPath) {
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    } else {
        $msiPath = Join-Path $env:TEMP "nodejs_setup.msi"
        Receive-FileSimple -Url "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi" -OutFile $msiPath -DisplayName "Node.js LTS"
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qb" -Wait
        Remove-Item $msiPath -ErrorAction SilentlyContinue
    }

    # 重新載入 PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    
    $npmPath = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmPath) {
        Write-Host "  Node.js 安裝完成！請關閉此視窗後重新執行。" -ForegroundColor Green
        pause
        exit 0
    }
}
Write-Host "  [OK] Node.js 已就緒" -ForegroundColor Green

# ---- 第二步：下載 compiler-server ----
Write-Host "[2/4] 正在準備編譯伺服器..." -ForegroundColor Yellow

$compilerDir = Join-Path $scriptDir "compiler-server"

if (-not (Test-Path (Join-Path $compilerDir "server.js"))) {
    Write-Host "  正在從 GitHub 下載 compiler-server..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $compilerDir -Force | Out-Null
    
    Receive-FileSimple `
        -Url "https://raw.githubusercontent.com/kevinkidtw/TubitBlockWebOnline/main/compiler-server/server.js" `
        -OutFile (Join-Path $compilerDir "server.js") `
        -DisplayName "server.js"
    
    Receive-FileSimple `
        -Url "https://raw.githubusercontent.com/kevinkidtw/TubitBlockWebOnline/main/compiler-server/package.json" `
        -OutFile (Join-Path $compilerDir "package.json") `
        -DisplayName "package.json"
}
Write-Host "  [OK] compiler-server 已就緒" -ForegroundColor Green

# ---- 第三步：安裝 arduino-cli + ESP32 核心 ----
Write-Host "[3/4] 正在檢查 arduino-cli 與 ESP32 核心..." -ForegroundColor Yellow

$arduinoCliBin = Join-Path $scriptDir "arduino-cli.exe"

if (-not (Test-Path $arduinoCliBin)) {
    # 檢查全域 arduino-cli
    $globalCli = Get-Command arduino-cli -ErrorAction SilentlyContinue
    if ($globalCli) {
        $arduinoCliBin = $globalCli.Source
        Write-Host "  [OK] 已找到全域 arduino-cli" -ForegroundColor Green
    } else {
        Write-Host "  正在下載 arduino-cli v0.35.3..." -ForegroundColor Cyan
        $cliZip = Join-Path $env:TEMP "arduino-cli_$(Get-Random).zip"
        $cliTemp = Join-Path $env:TEMP "arduino-cli_extract_$(Get-Random)"
        
        Receive-FileSimple `
            -Url "https://github.com/arduino/arduino-cli/releases/download/v0.35.3/arduino-cli_0.35.3_Windows_64bit.zip" `
            -OutFile $cliZip `
            -DisplayName "arduino-cli"
        
        New-Item -ItemType Directory -Path $cliTemp -Force | Out-Null
        & tar.exe -xf $cliZip -C $cliTemp
        
        $cliExe = Get-ChildItem -Path $cliTemp -Filter "arduino-cli.exe" -Recurse | Select-Object -First 1
        if ($cliExe) {
            Move-Item -Path $cliExe.FullName -Destination $arduinoCliBin -Force
        }
        
        Remove-Item $cliZip -Force -ErrorAction SilentlyContinue
        Remove-Item $cliTemp -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] arduino-cli 已下載" -ForegroundColor Green
    }
} else {
    Write-Host "  [OK] arduino-cli 已存在" -ForegroundColor Green
}

# 安裝 ESP32 核心
$coreList = & $arduinoCliBin core list 2>&1
if ($coreList -notmatch "esp32:esp32") {
    Write-Host "  正在安裝 ESP32 核心 (esp32:esp32@3.1.3)，首次約需 3-5 分鐘..." -ForegroundColor Cyan
    & $arduinoCliBin core update-index --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    & $arduinoCliBin core install esp32:esp32@3.1.3 --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    Write-Host "  [OK] ESP32 核心安裝完成" -ForegroundColor Green
} else {
    Write-Host "  [OK] ESP32 核心已安裝" -ForegroundColor Green
}

# ---- 第四步：安裝 npm 依賴並啟動 ----
Write-Host "[4/4] 正在啟動本地編譯伺服器..." -ForegroundColor Yellow

Set-Location $compilerDir
if (-not (Test-Path "node_modules")) {
    Write-Host "  正在安裝 npm 依賴..." -ForegroundColor Cyan
    npm install
}

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "  ✅ 本地編譯伺服器啟動中！" -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "  API 端點: http://localhost:3000/compile" -ForegroundColor Green
Write-Host "  健康檢查: http://localhost:3000/" -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "  請勿關閉此視窗！把它最小化即可。" -ForegroundColor Green
Write-Host "  在瀏覽器中切換到「💻 本地」模式即可使用。" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host ""

$env:ARDUINO_CLI_PATH = $arduinoCliBin
node server.js
