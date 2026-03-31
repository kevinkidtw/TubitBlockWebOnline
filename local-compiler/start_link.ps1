# =====================================================================
# TubitBlockWeb 本地編譯器啟動腳本 (Windows PowerShell)
# 功能：自動安裝 Node.js 與 arduino-cli，安裝 ESP32 核心，
#       啟動 compiler-server 在 localhost:3000。
#
# 所有工具鏈統一安裝至固定目錄 C:\TubitBlock\（Windows）或 ~/.tubitblock（Mac/Linux）。
# 使用 C:\ 根目錄以確保路徑全為 ASCII，避免中文使用者名稱導致 arduino-cli toolchain panic。
# =====================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$osArch = $env:PROCESSOR_ARCHITECTURE
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 固定 app 資料目錄（與腳本位置無關）
# Windows 使用 C:\TubitBlock 確保 ASCII 路徑，避免中文路徑導致 ESP32 toolchain wrapper crash
if ($env:OS -eq 'Windows_NT') {
    $appDir = "C:\TubitBlock"
} else {
    $appDir = Join-Path $env:HOME ".tubitblock"
}
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  TubitBlockWeb 本地編譯器安裝與啟動工具" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  CPU 架構 : $osArch" -ForegroundColor DarkGray
Write-Host "  資料目錄 : $appDir" -ForegroundColor DarkGray
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

    $wingetOk = $false
    $wingetPath = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetPath) {
        Write-Host "  嘗試使用 winget 安裝 Node.js..." -ForegroundColor Cyan
        Write-Host "  更新 winget 來源索引..." -ForegroundColor DarkGray
        winget source update 2>&1 | Out-Null
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -eq 0) { $wingetOk = $true }
        else { Write-Host "  winget 失敗 (exit $LASTEXITCODE)，改用直接下載..." -ForegroundColor Yellow }
    }
    if (-not $wingetOk) {
        $msiPath = Join-Path $env:TEMP "nodejs_setup.msi"
        if ($osArch -eq "ARM64") {
            $nodeMsiUrl = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-arm64.msi"
        } else {
            $nodeMsiUrl = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"
        }
        Receive-FileSimple -Url $nodeMsiUrl -OutFile $msiPath -DisplayName "Node.js LTS"
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

# ---- 第二步：定位 compiler-server ----
Write-Host "[2/4] 正在準備編譯伺服器..." -ForegroundColor Yellow

# 優先順序：
#   1. 專案根目錄 ..\compiler-server\（開發者模式，與 NAS Docker 同步）
#   2. 固定 app 目錄 %APPDATA%\TubitBlock\compiler-server\（已下載過）
#   3. 從 GitHub 下載至固定 app 目錄
$parentCompilerDir = Join-Path (Split-Path $scriptDir -Parent) "compiler-server"
$appCompilerDir = Join-Path $appDir "compiler-server"
$compilerDir = ""

if ((Test-Path (Join-Path $parentCompilerDir "server.js")) -and (Test-Path (Join-Path $parentCompilerDir "custom_libraries"))) {
    $compilerDir = $parentCompilerDir
    $libCount = (Get-ChildItem -Path (Join-Path $compilerDir "custom_libraries") -Directory -ErrorAction SilentlyContinue).Count
    Write-Host "  [OK] 使用專案內建 compiler-server（$libCount 個函式庫）" -ForegroundColor Green
} elseif ((Test-Path (Join-Path $appCompilerDir "server.js")) -and (Test-Path (Join-Path $appCompilerDir "custom_libraries"))) {
    $compilerDir = $appCompilerDir
    $libCount = (Get-ChildItem -Path (Join-Path $compilerDir "custom_libraries") -Directory -ErrorAction SilentlyContinue).Count
    Write-Host "  [OK] 使用已安裝的 compiler-server（$libCount 個函式庫）" -ForegroundColor Green
} else {
    Write-Host "  未找到 compiler-server，正在從 GitHub 下載至 $appCompilerDir ..." -ForegroundColor Cyan

    $repoZip = Join-Path $env:TEMP "tubitblock-repo-$(Get-Random).zip"
    $repoExtract = Join-Path $env:TEMP "tubitblock-extract-$(Get-Random)"
    Receive-FileSimple `
        -Url "https://github.com/kevinkidtw/TubitBlockWebOnline/archive/refs/heads/main.zip" `
        -OutFile $repoZip `
        -DisplayName "TubitBlockWeb compiler-server"

    New-Item -ItemType Directory -Path $repoExtract -Force | Out-Null
    Write-Host "    正在解壓縮..." -ForegroundColor DarkGray
    $ProgressPreference = 'SilentlyContinue'
    Expand-Archive -Path $repoZip -DestinationPath $repoExtract -Force
    $ProgressPreference = 'Continue'
    Write-Host "    解壓縮完成" -ForegroundColor DarkGray
    Remove-Item $repoZip -Force -ErrorAction SilentlyContinue

    $srcDir = Join-Path $repoExtract "TubitBlockWebOnline-main\compiler-server"
    New-Item -ItemType Directory -Path $appCompilerDir -Force | Out-Null
    Copy-Item -Path (Join-Path $srcDir "\*") -Destination $appCompilerDir -Recurse -Force
    Remove-Item $repoExtract -Recurse -Force -ErrorAction SilentlyContinue

    $compilerDir = $appCompilerDir
    $libCount = (Get-ChildItem -Path (Join-Path $compilerDir "custom_libraries") -Directory -ErrorAction SilentlyContinue).Count
    Write-Host "  [OK] 已下載 $libCount 個自訂函式庫" -ForegroundColor Green
}
# 每次啟動都從 GitHub 下載最新 server.js（只更新這一個檔案，libraries 快取保留）
Write-Host "  更新 server.js 至最新版本..." -ForegroundColor DarkGray
try {
    Invoke-WebRequest `
        -Uri "https://raw.githubusercontent.com/kevinkidtw/TubitBlockWebOnline/main/compiler-server/server.js" `
        -OutFile (Join-Path $compilerDir "server.js") `
        -UseBasicParsing
    Write-Host "  [OK] server.js 已更新" -ForegroundColor Green
} catch {
    Write-Host "  [警告] server.js 更新失敗，使用本地快取版本" -ForegroundColor Yellow
}

Write-Host "  [OK] compiler-server 已就緒: $compilerDir" -ForegroundColor Green

# ---- 第三步：安裝 arduino-cli + ESP32 核心 ----
Write-Host "[3/4] 正在檢查 arduino-cli 與 ESP32 核心..." -ForegroundColor Yellow

# 優先順序：
#   1. 系統全域 arduino-cli（PATH 中）
#   2. 固定 app 目錄 %APPDATA%\TubitBlock\arduino-cli.exe（已下載過）
#   3. 下載至固定 app 目錄
$arduinoCliBin = ""
$globalCli = Get-Command arduino-cli -ErrorAction SilentlyContinue
if ($globalCli) {
    $arduinoCliBin = $globalCli.Source
    Write-Host "  [OK] 已找到全域 arduino-cli" -ForegroundColor Green
} else {
    $appCliBin = Join-Path $appDir "arduino-cli.exe"
    if (Test-Path $appCliBin) {
        $arduinoCliBin = $appCliBin
        Write-Host "  [OK] 已找到已安裝的 arduino-cli" -ForegroundColor Green
    } else {
        Write-Host "  正在下載 arduino-cli v0.35.3 至 $appDir ..." -ForegroundColor Cyan
        $cliZip = Join-Path $env:TEMP "arduino-cli_$(Get-Random).zip"
        $cliTemp = Join-Path $env:TEMP "arduino-cli_extract_$(Get-Random)"

        if ($osArch -eq "ARM64") {
            $cliUrl = "https://github.com/arduino/arduino-cli/releases/download/v0.35.3/arduino-cli_0.35.3_Windows_ARM64.zip"
        } else {
            $cliUrl = "https://github.com/arduino/arduino-cli/releases/download/v0.35.3/arduino-cli_0.35.3_Windows_64bit.zip"
        }

        Receive-FileSimple `
            -Url $cliUrl `
            -OutFile $cliZip `
            -DisplayName "arduino-cli"

        New-Item -ItemType Directory -Path $cliTemp -Force | Out-Null
        & tar.exe -xf $cliZip -C $cliTemp

        $cliExe = Get-ChildItem -Path $cliTemp -Filter "arduino-cli.exe" -Recurse | Select-Object -First 1
        if ($cliExe) {
            Move-Item -Path $cliExe.FullName -Destination $appCliBin -Force
        }

        Remove-Item $cliZip -Force -ErrorAction SilentlyContinue
        Remove-Item $cliTemp -Recurse -Force -ErrorAction SilentlyContinue
        $arduinoCliBin = $appCliBin
        Write-Host "  [OK] arduino-cli 已下載至 $appDir" -ForegroundColor Green
    }
}

# Windows 上強制設定 arduino-cli 所有資料目錄到 ASCII 路徑（C:\TubitBlock\arduino-*）
# 防止 ESP32 core 3.1.x 的 Rust toolchain wrapper 在中文路徑下 panic（Error code 123）
if ($env:OS -eq 'Windows_NT') {
    $arduinoDataDir      = Join-Path $appDir "arduino-data"
    $arduinoDownloadsDir = Join-Path $appDir "arduino-downloads"
    $arduinoUserDir      = Join-Path $appDir "arduino-user"
    & $arduinoCliBin config set directories.data      $arduinoDataDir      | Out-Null
    & $arduinoCliBin config set directories.downloads $arduinoDownloadsDir | Out-Null
    & $arduinoCliBin config set directories.user      $arduinoUserDir      | Out-Null
    $env:ARDUINO_DATA_DIR = $arduinoDataDir
    Write-Host "  [OK] arduino-cli 資料目錄設定至 $arduinoDataDir" -ForegroundColor Green
}

# 安裝 ESP32 核心（必須是 3.1.3，預編譯函式庫僅與此版本相容）
$requiredEsp32Ver = "3.1.3"
$coreList = & $arduinoCliBin core list 2>&1
$esp32Line = $coreList | Where-Object { $_ -match "esp32:esp32" } | Select-Object -First 1
$currentEsp32Ver = if ($esp32Line -match "esp32:esp32\s+(\S+)") { $Matches[1] } else { "" }

if ($currentEsp32Ver -eq $requiredEsp32Ver) {
    Write-Host "  [OK] ESP32 核心已安裝 (v$requiredEsp32Ver)" -ForegroundColor Green
} elseif ($currentEsp32Ver -ne "") {
    Write-Host "  偵測到 ESP32 核心版本 v$currentEsp32Ver，但預編譯函式庫需要 v$requiredEsp32Ver" -ForegroundColor Yellow
    Write-Host "  正在切換至 v$requiredEsp32Ver..." -ForegroundColor Cyan
    & $arduinoCliBin core update-index --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    & $arduinoCliBin core install "esp32:esp32@$requiredEsp32Ver" --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    Write-Host "  [OK] ESP32 核心已切換至 v$requiredEsp32Ver" -ForegroundColor Green
} else {
    Write-Host "  正在安裝 ESP32 核心 (esp32:esp32@$requiredEsp32Ver)，首次約需 3-5 分鐘..." -ForegroundColor Cyan
    & $arduinoCliBin core update-index --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    & $arduinoCliBin core install "esp32:esp32@$requiredEsp32Ver" --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    Write-Host "  [OK] ESP32 核心安裝完成 (v$requiredEsp32Ver)" -ForegroundColor Green
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
