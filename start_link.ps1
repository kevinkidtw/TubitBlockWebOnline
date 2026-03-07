# =====================================================================
# TubitBlockWeb 一鍵自動部署與啟動腳本 (Windows PowerShell)
# 功能：自動安裝 Node.js/Git、偵測 CPU 架構、下載對應的 ESP32 編譯器、
#       啟動 HTTP 靜態伺服器與 openblock-link 連線服務。
# =====================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ---- 系統環境偵測 ----
$osArch = $env:PROCESSOR_ARCHITECTURE
$osVersion = [System.Environment]::OSVersion.Version
$osName = "Windows"
try { $osName = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption } catch {}

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  TubitBlockWeb 一鍵自動部署與啟動工具" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  作業系統 : $osName" -ForegroundColor DarkGray
Write-Host "  CPU 架構 : $osArch" -ForegroundColor DarkGray
Write-Host "  系統版本 : $($osVersion.Major).$($osVersion.Minor).$($osVersion.Build)" -ForegroundColor DarkGray
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

# ---- 統一下載函數（穩定版，不依賴 BITS / WebClient 非同步）----
function Receive-FileWithProgress {
    param(
        [string]$Url,
        [string]$OutFile,
        [string]$DisplayName
    )

    Write-Host "    正在下載: $DisplayName" -ForegroundColor DarkGray

    # 確保目標檔案不存在（避免鎖定衝突）
    if (Test-Path $OutFile) {
        Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
    }

    # 使用 .NET HttpClient（同步下載，穩定處理 GitHub 302 重定向）
    try {
        Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
        $handler = New-Object System.Net.Http.HttpClientHandler
        $handler.AllowAutoRedirect = $true
        $client = New-Object System.Net.Http.HttpClient($handler)
        $client.Timeout = [TimeSpan]::FromMinutes(30)

        # 先發 HEAD 取得檔案大小
        $totalBytes = 0
        try {
            $headResp = $client.SendAsync((New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Head, $Url))).Result
            $totalBytes = $headResp.Content.Headers.ContentLength
        }
        catch {}
        $totalMB = if ($totalBytes -gt 0) { [math]::Round($totalBytes / 1MB, 1) } else { "?" }

        # 開始下載
        $response = $client.GetAsync($Url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
        $response.EnsureSuccessStatusCode() | Out-Null
        $stream = $response.Content.ReadAsStreamAsync().Result
        $fileStream = [System.IO.File]::Create($OutFile)
        $buffer = New-Object byte[] 131072  # 128KB buffer
        $downloaded = 0
        $lastReport = 0
        $sw = [System.Diagnostics.Stopwatch]::StartNew()

        while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $fileStream.Write($buffer, 0, $read)
            $downloaded += $read
            $downloadedMB = [math]::Round($downloaded / 1MB, 1)

            # 每秒最多更新一次進度
            if ($sw.ElapsedMilliseconds - $lastReport -ge 1000) {
                $lastReport = $sw.ElapsedMilliseconds
                $speedMB = [math]::Round($downloaded / 1MB / ($sw.ElapsedMilliseconds / 1000), 1)
                if ($totalBytes -gt 0) {
                    $pct = [math]::Min(100, [math]::Round($downloaded * 100 / $totalBytes))
                    Write-Host "`r    [$pct%] ${downloadedMB} MB / ${totalMB} MB  (${speedMB} MB/s)   " -NoNewline -ForegroundColor Cyan
                }
                else {
                    Write-Host "`r    ${downloadedMB} MB  (${speedMB} MB/s)   " -NoNewline -ForegroundColor Cyan
                }
            }
        }
        Write-Host ""  # 換行

        $fileStream.Close()
        $stream.Close()
        $client.Dispose()

        $fileSizeMB = [math]::Round((Get-Item $OutFile).Length / 1MB, 1)
        Write-Host "    下載完成 (${fileSizeMB} MB)" -ForegroundColor Green
    }
    catch {
        # 確保清理
        if ($fileStream) { $fileStream.Close() }
        if ($stream) { $stream.Close() }
        if ($client) { $client.Dispose() }

        Write-Host "    HttpClient 下載失敗: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "    改用 Invoke-WebRequest 備援下載..." -ForegroundColor Yellow

        # 備援：關閉進度條避免版面錯亂
        $oldPref = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        try {
            Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
            $fileSizeMB = [math]::Round((Get-Item $OutFile).Length / 1MB, 1)
            Write-Host "    下載完成 (${fileSizeMB} MB)" -ForegroundColor Green
        }
        finally {
            $ProgressPreference = $oldPref
        }
    }
}

# ---- 第一步：檢查 Node.js 環境 ----
Write-Host "[1/5] 正在檢查 Node.js 環境..." -ForegroundColor Yellow

$npmPath = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmPath) {
    Write-Host ""
    Write-Host "  找不到 Node.js，正在為您自動安裝..." -ForegroundColor Red

    $wingetPath = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetPath) {
        Write-Host "  偵測到 winget，正在安裝 Node.js LTS 版本..."
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    }
    else {
        Write-Host "  正在從 Node.js 官方網站下載安裝檔..."
        $msiPath = Join-Path $env:TEMP "nodejs_setup.msi"
        Receive-FileWithProgress -Url "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi" -OutFile $msiPath -DisplayName "Node.js LTS"
        Write-Host "  正在執行安裝程式，請在彈出的視窗中完成安裝..."
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qb" -Wait
        Remove-Item $msiPath -ErrorAction SilentlyContinue
    }

    Write-Host ""
    Write-Host "=======================================================" -ForegroundColor Green
    Write-Host "  Node.js 安裝完成！" -ForegroundColor Green
    Write-Host "  請先關閉此視窗，然後重新雙擊 start_link.bat" -ForegroundColor Green
    Write-Host "  讓系統載入新的環境變數後繼續執行。" -ForegroundColor Green
    Write-Host "=======================================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host "  [OK] 已找到 Node.js: $($npmPath.Source)" -ForegroundColor Green

# ---- 第二步：檢查並安裝 Git ----
Write-Host "[2/5] 正在檢查 Git 環境..." -ForegroundColor Yellow

$gitPath = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitPath) {
    Write-Host "  找不到 Git，正在為您自動安裝..." -ForegroundColor Red

    $wingetPath = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetPath) {
        Write-Host "  使用 winget 安裝 Git..." -ForegroundColor Cyan
        winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
    }
    else {
        Write-Host "  正在從 Git 官方網站下載安裝檔..." -ForegroundColor Cyan
        $gitInstaller = Join-Path $env:TEMP "Git-Setup.exe"
        Receive-FileWithProgress -Url "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe" -OutFile $gitInstaller -DisplayName "Git for Windows"
        Write-Host "  正在執行 Git 安裝程式（靜默安裝）..."
        Start-Process -FilePath $gitInstaller -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP-" -Wait
        Remove-Item $gitInstaller -ErrorAction SilentlyContinue
    }

    # 重新整理 PATH 環境變數
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    $gitPath = Get-Command git -ErrorAction SilentlyContinue

    if (-not $gitPath) {
        Write-Host "  [警告] Git 安裝後仍無法偵測，可能需要重啟終端。" -ForegroundColor Yellow
        Write-Host "  將改用壓縮包方式下載專案。" -ForegroundColor Yellow
    }
    else {
        Write-Host "  [OK] Git 安裝成功: $($gitPath.Source)" -ForegroundColor Green
    }
}
else {
    Write-Host "  [OK] 已找到 Git: $($gitPath.Source)" -ForegroundColor Green
}

# ---- 第三步：尋找或下載 Link 服務（僅下載編譯服務，不含網頁前端）----
# 說明：網頁前端 (www/) 和擴展包 (external-resources/) 由 GitHub Pages 提供，
#       本地端只需要 Link 服務 (openblock-link/) 進行編譯和燒錄。
#
# ESP32 Arduino Core v3.1.0+ 的 Rust GCC Wrapper 在路徑含有非 ASCII 字元
# （如中文使用者名稱「學生」）時會崩潰 (Error 123)。
# 因此我們將 Link 服務安裝至固定的全 ASCII 路徑 C:\TubitBlockWeb，
# 以確保編譯過程中所有路徑皆不含中文字元。
Write-Host "[3/5] 正在檢查 Link 硬體連線服務..." -ForegroundColor Yellow

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$safeRoot = "C:\TubitBlockWeb"   # 全 ASCII 路徑，避免 ESP32 編譯器路徑 Bug
$linkDir = $null

# 搜尋可能的 link 目錄位置（優先搜尋全 ASCII 路徑）
$linkDirNames = @("openblock-link", "tubitblock-link")
$searchRoots = @(
    $safeRoot,
    (Join-Path $safeRoot "TubitBlockWeb"),
    $scriptDir,
    (Join-Path $scriptDir "TubitBlockWeb"),
    (Join-Path $scriptDir "TubitBlockWeb-main")
)

foreach ($root in $searchRoots) {
    foreach ($dirName in $linkDirNames) {
        $testLink = Join-Path $root $dirName
        if (Test-Path (Join-Path $testLink "package.json")) {
            $linkDir = $testLink
            break
        }
    }
    if ($linkDir) { break }
}

if (-not $linkDir) {
    Write-Host "  找不到 Link 服務，正在從 GitHub 下載（僅下載編譯服務）..." -ForegroundColor Red
    Write-Host "  (不會下載網頁前端和擴展包，節省大量下載時間)" -ForegroundColor DarkGray
    Write-Host "  安裝位置: $safeRoot (全 ASCII 路徑，確保 ESP32 編譯成功)" -ForegroundColor DarkGray
    Write-Host ""

    # 確保安全根目錄存在
    if (-not (Test-Path $safeRoot)) {
        New-Item -ItemType Directory -Path $safeRoot -Force | Out-Null
    }

    $gitPath = Get-Command git -ErrorAction SilentlyContinue
    if ($gitPath) {
        # 使用 Git sparse-checkout 僅下載 openblock-link/ 目錄
        Write-Host "  使用 Git 稀疏檢出 (sparse-checkout)，僅下載 Link 服務..." -ForegroundColor Cyan
        Set-Location $safeRoot

        & git config --global core.longpaths true

        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"

        # 初始化空 repo，設定 sparse-checkout，然後 pull
        & cmd /c "git clone --filter=blob:none --no-checkout --depth 1 --progress https://github.com/kevinkidtw/TubitBlockWeb.git 2>&1"
        Set-Location (Join-Path $safeRoot "TubitBlockWeb")
        & git sparse-checkout init --cone
        & git sparse-checkout set openblock-link tubitblock-link
        & cmd /c "git checkout 2>&1"

        $ErrorActionPreference = $oldEAP
        Write-Host ""

    }
    else {
        # 無 Git 時，下載整個 ZIP 再只保留 link 目錄
        Write-Host "  Git 不可用，改用壓縮包下載..." -ForegroundColor Yellow
        $zipPath = Join-Path $safeRoot "TubitBlockWeb.zip"

        Receive-FileWithProgress -Url "https://github.com/kevinkidtw/TubitBlockWeb/archive/refs/heads/main.zip" -OutFile $zipPath -DisplayName "TubitBlockWeb 專案壓縮包"

        Write-Host ""
        Write-Host "  正在解壓縮檔案 (使用 tar)..." -ForegroundColor Yellow
        & tar.exe -xf $zipPath -C $safeRoot
        Remove-Item $zipPath -ErrorAction SilentlyContinue

        $extractedDir = Join-Path $safeRoot "TubitBlockWeb-main"
        $targetDir = Join-Path $safeRoot "TubitBlockWeb"
        if (Test-Path $extractedDir) {
            Rename-Item $extractedDir $targetDir -ErrorAction SilentlyContinue
        }
    }

    # 尋找下載後的 link 目錄
    $downloadedRoot = Join-Path $safeRoot "TubitBlockWeb"
    foreach ($dirName in $linkDirNames) {
        $testLink = Join-Path $downloadedRoot $dirName
        if (Test-Path (Join-Path $testLink "package.json")) {
            $linkDir = $testLink
            break
        }
    }

    if (-not $linkDir) {
        Write-Host ""
        Write-Host "  [錯誤] 下載失敗或專案結構異常。" -ForegroundColor Red
        Write-Host "  請手動前往 https://github.com/kevinkidtw/TubitBlockWeb 下載。" -ForegroundColor Red
        exit 1
    }

    Write-Host "  正在安裝 npm 套件..." -ForegroundColor Yellow
    Set-Location $linkDir
    npm install
}

Write-Host "  [OK] 已找到專案目錄: $linkDir" -ForegroundColor Green

# ---- 第四步：偵測系統架構並下載 ESP32 編譯器工具鏈 ----
Write-Host "[4/5] 正在檢查 ESP32 編譯器工具鏈..." -ForegroundColor Yellow

$toolsDir = Join-Path $linkDir "tools\Arduino\packages\esp32\tools"

if ($osArch -eq "ARM64") {
    Write-Host "  偵測到 Windows ARM64 系統" -ForegroundColor Cyan
    Write-Host "  注意: ESP32 工具鏈僅提供 x64 版本，將透過 x64 模擬層執行" -ForegroundColor Yellow
}
Write-Host "  對應平台: Windows x64" -ForegroundColor DarkGray

# 定義 6 個需要下載的工具
$toolList = @(
    @{
        Name        = "esp-x32 (Xtensa 編譯器, ~254MB)"
        Url         = "https://github.com/espressif/crosstool-NG/releases/download/esp-13.2.0_20240530/xtensa-esp-elf-13.2.0_20240530-x86_64-w64-mingw32.zip"
        DestDir     = "esp-x32\2405"
        StripPrefix = "xtensa-esp-elf"
    },
    @{
        Name        = "esp-rv32 (RISC-V 編譯器, ~350MB)"
        Url         = "https://github.com/espressif/crosstool-NG/releases/download/esp-13.2.0_20240530/riscv32-esp-elf-13.2.0_20240530-x86_64-w64-mingw32.zip"
        DestDir     = "esp-rv32\2405"
        StripPrefix = "riscv32-esp-elf"
    },
    @{
        Name        = "esptool_py (燒錄工具, ~26MB)"
        Url         = "https://github.com/espressif/arduino-esp32/releases/download/3.1.0-RC3/esptool-v4.9.dev3-win64.zip"
        DestDir     = "esptool_py\4.9.dev3"
        StripPrefix = "esptool"
    },
    @{
        Name        = "openocd-esp32 (除錯工具, ~3MB)"
        Url         = "https://github.com/espressif/openocd-esp32/releases/download/v0.12.0-esp32-20241016/openocd-esp32-win64-0.12.0-esp32-20241016.zip"
        DestDir     = "openocd-esp32\v0.12.0-esp32-20241016"
        StripPrefix = "openocd-esp32"
    },
    @{
        Name        = "xtensa-esp-elf-gdb (Xtensa GDB, ~32MB)"
        Url         = "https://github.com/espressif/binutils-gdb/releases/download/esp-gdb-v14.2_20240403/xtensa-esp-elf-gdb-14.2_20240403-x86_64-w64-mingw32.zip"
        DestDir     = "xtensa-esp-elf-gdb\14.2_20240403"
        StripPrefix = "xtensa-esp-elf-gdb"
    },
    @{
        Name        = "riscv32-esp-elf-gdb (RISC-V GDB, ~32MB)"
        Url         = "https://github.com/espressif/binutils-gdb/releases/download/esp-gdb-v14.2_20240403/riscv32-esp-elf-gdb-14.2_20240403-x86_64-w64-mingw32.zip"
        DestDir     = "riscv32-esp-elf-gdb\14.2_20240403"
        StripPrefix = "riscv32-esp-elf-gdb"
    }
)

function Receive-EspTool {
    param(
        [string]$Name,
        [string]$Url,
        [string]$DestDir
    )

    $fullDest = Join-Path $toolsDir $DestDir

    # 檢查是否已存在
    if ((Test-Path $fullDest) -and (Get-ChildItem $fullDest -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
        Write-Host "  [OK] $Name 已存在，跳過下載" -ForegroundColor Green
        return
    }

    Write-Host ""
    Write-Host "  [DL] $Name" -ForegroundColor Cyan
    $zipFile = Join-Path $env:TEMP "esp32_tool_$(Get-Random).zip"
    $extractTemp = Join-Path $env:TEMP "esp32_extract_$(Get-Random)"

    Receive-FileWithProgress -Url $Url -OutFile $zipFile -DisplayName $Name

    Write-Host "    正在解壓..." -ForegroundColor DarkGray

    # 解壓到臨時目錄
    New-Item -ItemType Directory -Path $extractTemp -Force | Out-Null
    & tar.exe -xf $zipFile -C $extractTemp

    # 建立目標目錄
    New-Item -ItemType Directory -Path $fullDest -Force | Out-Null

    # 移動檔案（動態去掉頂層資料夾，類似 tar --strip-components=1）
    $rootItems = Get-ChildItem -Path $extractTemp
    if ($rootItems.Count -eq 1 -and $rootItems[0].PSIsContainer) {
        Get-ChildItem -Path $rootItems[0].FullName | Move-Item -Destination $fullDest -Force
    }
    else {
        $rootItems | Move-Item -Destination $fullDest -Force
    }

    # 清理
    Remove-Item $zipFile -Force -ErrorAction SilentlyContinue
    Remove-Item $extractTemp -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "  [OK] $Name 安裝完成" -ForegroundColor Green
}

Write-Host ""

$toolIndex = 0
foreach ($tool in $toolList) {
    $toolIndex++
    Write-Host "  ($toolIndex/6)" -NoNewline
    Receive-EspTool -Name $tool.Name -Url $tool.Url -DestDir $tool.DestDir
}

# ---- 下載 arduino-cli.exe ----
$arduinoDir = Join-Path $linkDir "tools\Arduino"
$arduinoCliBin = Join-Path $arduinoDir "arduino-cli.exe"

if (-not (Test-Path $arduinoCliBin)) {
    Write-Host ""
    Write-Host "  [DL] 正在下載 arduino-cli v0.35.3 (Windows x64)..." -ForegroundColor Cyan
    $cliZip = Join-Path $env:TEMP "arduino-cli_$(Get-Random).zip"
    $cliTemp = Join-Path $env:TEMP "arduino-cli_extract_$(Get-Random)"
    
    Receive-FileWithProgress `
        -Url "https://github.com/arduino/arduino-cli/releases/download/v0.35.3/arduino-cli_0.35.3_Windows_64bit.zip" `
        -OutFile $cliZip `
        -DisplayName "arduino-cli"
    
    New-Item -ItemType Directory -Path $cliTemp -Force | Out-Null
    & tar.exe -xf $cliZip -C $cliTemp
    
    # 移動 arduino-cli.exe 到 Arduino 目錄
    $cliExe = Get-ChildItem -Path $cliTemp -Filter "arduino-cli.exe" -Recurse | Select-Object -First 1
    if ($cliExe) {
        Move-Item -Path $cliExe.FullName -Destination $arduinoCliBin -Force
    }
    
    Remove-Item $cliZip -Force -ErrorAction SilentlyContinue
    Remove-Item $cliTemp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] arduino-cli.exe 安裝完成" -ForegroundColor Green
}
else {
    Write-Host "  [OK] arduino-cli.exe 已存在，跳過下載" -ForegroundColor Green
}

# ---- 下載 ctags (arduino-cli 生成函式原型所需) ----
$ctagsDir = Join-Path $linkDir "tools\Arduino\packages\builtin\tools\ctags\5.8-arduino11"
$ctagsBin = Join-Path $ctagsDir "ctags.exe"

if (-not (Test-Path $ctagsBin)) {
    Write-Host ""
    Write-Host "  [DL] 正在下載 ctags 5.8-arduino11 (Windows)..." -ForegroundColor Cyan
    $ctagsZip = Join-Path $env:TEMP "ctags_$(Get-Random).zip"
    $ctagsTemp = Join-Path $env:TEMP "ctags_extract_$(Get-Random)"

    Receive-FileWithProgress `
        -Url "https://github.com/arduino/ctags/releases/download/5.8-arduino11/ctags-5.8-arduino11-i686-mingw32.zip" `
        -OutFile $ctagsZip `
        -DisplayName "ctags"

    New-Item -ItemType Directory -Path $ctagsTemp -Force | Out-Null
    & tar.exe -xf $ctagsZip -C $ctagsTemp

    # 建立目標目錄並移動 ctags.exe
    New-Item -ItemType Directory -Path $ctagsDir -Force | Out-Null
    $ctagsExe = Get-ChildItem -Path $ctagsTemp -Filter "ctags.exe" -Recurse | Select-Object -First 1
    if ($ctagsExe) {
        Move-Item -Path $ctagsExe.FullName -Destination $ctagsBin -Force
    }

    Remove-Item $ctagsZip -Force -ErrorAction SilentlyContinue
    Remove-Item $ctagsTemp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  [OK] ctags 安裝完成" -ForegroundColor Green
}
else {
    Write-Host "  [OK] ctags 已存在，跳過下載" -ForegroundColor Green
}

Write-Host ""
Write-Host "  ESP32 編譯器工具鏈就緒!" -ForegroundColor Green

# ---- 安裝 npm 依賴 ----
Write-Host ""
Write-Host "正在檢查並安裝專案依賴套件 (npm install)..." -ForegroundColor Yellow
Write-Host "  此步驟需要下載並安裝數百個小型模組，畫面暫時停止是正常現象。" -ForegroundColor DarkGray
Set-Location $linkDir
npm install

# ---- 第五步：啟動 Link 連線服務 ----
Write-Host "[5/5] 正在啟動硬體連線助手..." -ForegroundColor Yellow
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "  TubitBlockWeb 硬體連線助手啟動中！" -ForegroundColor Green
Write-Host "  請勿關閉此視窗，把它最小化即可。" -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "  本服務負責編譯與燒錄 (port 20111)，" -ForegroundColor Green
Write-Host "  網頁介面請使用老師提供的 GitHub Pages 網址。" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host ""

Set-Location $linkDir
npm start

