#!/bin/bash
# =====================================================================
# TubitBlockWeb 一鍵啟動環境 (Mac/Linux)
# 功能：自動安裝 Node.js、偵測 CPU 架構、下載對應的 ESP32 編譯器、
#       啟動 Link 硬體連線服務（編譯與燒錄）。
#
# 說明：網頁前端 (www/) 和擴展包 (external-resources/) 由 GitHub Pages 提供，
#       本地端只需要 Link 服務 (openblock-link/) 進行編譯和燒錄。
# =====================================================================

set -e

OS_NAME="$(uname -s)"
ARCH="$(uname -m)"

echo "======================================================="
echo "TubitBlockWeb 一鍵啟動環境 (Mac/Linux)"
echo "======================================================="
echo "  作業系統: $OS_NAME"
echo "  CPU 架構: $ARCH"
echo "======================================================="
echo "正在檢查系統環境..."

# ---- 第一步：檢查 Node.js ----
if ! command -v npm &> /dev/null; then
    echo ""
    echo "找不到 Node.js (npm)，準備進行自動安裝..."
    if [ "$OS_NAME" == "Darwin" ]; then
        if command -v brew &> /dev/null; then
            echo "偵測到 Homebrew，正在安裝 Node.js..."
            brew install node
        else
            echo "正在下載 Node.js Mac 版安裝檔 (LTS)..."
            curl -o /tmp/nodejs.pkg "https://nodejs.org/dist/v20.11.1/node-v20.11.1.pkg"
            echo "即將安裝 Node.js，請輸入您的 Mac 電腦密碼以授權："
            sudo installer -pkg /tmp/nodejs.pkg -target /
            rm -f /tmp/nodejs.pkg
        fi
    elif [ "$(uname -s | cut -c1-5)" == "Linux" ]; then
        echo "正在為 Linux 系統安裝 Node.js..."
        if command -v apt-get &> /dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        else
            echo "[錯誤] 目前僅支援使用 apt 的 Linux 系統自動安裝。"
            echo "請手動前往 https://nodejs.org/ 下載。安裝後重新執行此腳本。"
            exit 1
        fi
    else
        echo "[錯誤] 未知的作業系統，無法自動安裝 Node.js！"
        exit 1
    fi

    if ! command -v npm &> /dev/null; then
        echo ""
        echo "======================================================="
        echo "自動安裝似乎未成功，請嘗試手動前往 https://nodejs.org/ 安裝，"
        echo "安裝完畢後，請重新開啟這個終端機視窗並重試。"
        echo "======================================================="
        exit 1
    fi
    echo ""
    echo "======================================================="
    echo "Node.js (npm) 安裝成功！"
    echo "由於環境變數更新，請先關閉這個終端機視窗，然後重新執行腳本一次！"
    echo "======================================================="
    exit 0
fi

# ---- 第二步：尋找或下載 Link 服務（僅下載編譯服務，不含網頁前端）----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LINK_DIR=""

# 搜尋可能的 link 目錄位置（支援新舊目錄名）
for ROOT_DIR in "$SCRIPT_DIR" "$SCRIPT_DIR/TubitBlockWeb" "$SCRIPT_DIR/TubitBlockWeb-main"; do
    for DIR_NAME in openblock-link tubitblock-link; do
        if [ -f "$ROOT_DIR/$DIR_NAME/package.json" ]; then
            LINK_DIR="$ROOT_DIR/$DIR_NAME"
            break 2
        fi
    done
done

if [ -z "$LINK_DIR" ]; then
    echo ""
    echo "找不到 Link 服務，正在從 GitHub 下載（僅下載編譯服務）..."
    echo "  (不會下載網頁前端和擴展包，節省大量下載時間)"
    echo ""

    if command -v git &> /dev/null; then
        echo "使用 Git 稀疏檢出 (sparse-checkout)，僅下載 Link 服務..."
        cd "$SCRIPT_DIR"

        # 初始化空 repo，設定 sparse-checkout，然後 checkout
        git clone --filter=blob:none --no-checkout --depth 1 --progress \
            https://github.com/kevinkidtw/TubitBlockWeb.git

        cd TubitBlockWeb
        git sparse-checkout init --cone
        git sparse-checkout set openblock-link tubitblock-link
        git checkout
    else
        echo "系統找不到 Git，改用 curl 下載壓縮包..."
        cd "$SCRIPT_DIR"
        curl -L --progress-bar -o TubitBlockWeb.zip \
            https://github.com/kevinkidtw/TubitBlockWeb/archive/refs/heads/main.zip
        unzip -q TubitBlockWeb.zip
        rm TubitBlockWeb.zip
        mv TubitBlockWeb-main TubitBlockWeb
    fi

    # 尋找下載後的 link 目錄
    for DIR_NAME in openblock-link tubitblock-link; do
        if [ -f "$SCRIPT_DIR/TubitBlockWeb/$DIR_NAME/package.json" ]; then
            LINK_DIR="$SCRIPT_DIR/TubitBlockWeb/$DIR_NAME"
            break
        fi
    done

    if [ -z "$LINK_DIR" ]; then
        echo "[錯誤] 下載失敗或專案結構異常。"
        echo "請手動前往 https://github.com/kevinkidtw/TubitBlockWeb 下載。"
        exit 1
    fi
fi

TOOLS_DIR="$LINK_DIR/tools/Arduino/packages/esp32/tools"

echo "[OK] 已找到 Link 服務: $LINK_DIR"

# ---- 第三步：偵測 CPU 架構並下載對應的 ESP32 編譯器 ----
echo ""
echo "======================================================="
echo "正在檢查 ESP32 編譯器工具鏈..."
echo "======================================================="

# 判斷需要下載的平台標籤
if [ "$OS_NAME" == "Darwin" ]; then
    if [ "$ARCH" == "arm64" ]; then
        PLATFORM_LABEL="macOS ARM64 (Apple Silicon)"
        # 確保 Rosetta 2 已安裝（部分 x86_64 工具如 ctags 需要）
        if ! /usr/bin/pgrep -q oahd 2>/dev/null; then
            echo "  [!] 偵測到尚未安裝 Rosetta 2，正在自動安裝..."
            softwareupdate --install-rosetta --agree-to-license 2>/dev/null || true
            echo "  [✓] Rosetta 2 安裝完成"
        fi
        ESP_X32_URL="https://github.com/espressif/crosstool-NG/releases/download/esp-13.2.0_20240530/xtensa-esp-elf-13.2.0_20240530-aarch64-apple-darwin.tar.gz"
        ESP_RV32_URL="https://github.com/espressif/crosstool-NG/releases/download/esp-13.2.0_20240530/riscv32-esp-elf-13.2.0_20240530-aarch64-apple-darwin.tar.gz"
        ESPTOOL_URL="https://github.com/espressif/arduino-esp32/releases/download/3.1.0-RC3/esptool-v4.9.dev3-macos-arm64.tar.gz"
        OPENOCD_URL="https://github.com/espressif/openocd-esp32/releases/download/v0.12.0-esp32-20241016/openocd-esp32-macos-arm64-0.12.0-esp32-20241016.tar.gz"
        GDB_XTENSA_URL="https://github.com/espressif/binutils-gdb/releases/download/esp-gdb-v14.2_20240403/xtensa-esp-elf-gdb-14.2_20240403-aarch64-apple-darwin21.1.tar.gz"
        GDB_RV32_URL="https://github.com/espressif/binutils-gdb/releases/download/esp-gdb-v14.2_20240403/riscv32-esp-elf-gdb-14.2_20240403-aarch64-apple-darwin21.1.tar.gz"
    else
        PLATFORM_LABEL="macOS Intel (x86_64)"
        ESP_X32_URL="https://github.com/espressif/crosstool-NG/releases/download/esp-13.2.0_20240530/xtensa-esp-elf-13.2.0_20240530-x86_64-apple-darwin.tar.gz"
        ESP_RV32_URL="https://github.com/espressif/crosstool-NG/releases/download/esp-13.2.0_20240530/riscv32-esp-elf-13.2.0_20240530-x86_64-apple-darwin.tar.gz"
        ESPTOOL_URL="https://github.com/espressif/arduino-esp32/releases/download/3.1.0-RC3/esptool-v4.9.dev3-macos-amd64.tar.gz"
        OPENOCD_URL="https://github.com/espressif/openocd-esp32/releases/download/v0.12.0-esp32-20241016/openocd-esp32-macos-amd64-0.12.0-esp32-20241016.tar.gz"
        GDB_XTENSA_URL="https://github.com/espressif/binutils-gdb/releases/download/esp-gdb-v14.2_20240403/xtensa-esp-elf-gdb-14.2_20240403-x86_64-apple-darwin14.tar.gz"
        GDB_RV32_URL="https://github.com/espressif/binutils-gdb/releases/download/esp-gdb-v14.2_20240403/riscv32-esp-elf-gdb-14.2_20240403-x86_64-apple-darwin14.tar.gz"
    fi
elif [ "$OS_NAME" == "Linux" ]; then
    PLATFORM_LABEL="Linux x86_64"
    ESP_X32_URL="https://github.com/espressif/crosstool-NG/releases/download/esp-13.2.0_20240530/xtensa-esp-elf-13.2.0_20240530-x86_64-linux-gnu.tar.gz"
    ESP_RV32_URL="https://github.com/espressif/crosstool-NG/releases/download/esp-13.2.0_20240530/riscv32-esp-elf-13.2.0_20240530-x86_64-linux-gnu.tar.gz"
    ESPTOOL_URL="https://github.com/espressif/arduino-esp32/releases/download/3.1.0-RC3/esptool-v4.9.dev3-linux-amd64.tar.gz"
    OPENOCD_URL="https://github.com/espressif/openocd-esp32/releases/download/v0.12.0-esp32-20241016/openocd-esp32-linux-amd64-0.12.0-esp32-20241016.tar.gz"
    GDB_XTENSA_URL="https://github.com/espressif/binutils-gdb/releases/download/esp-gdb-v14.2_20240403/xtensa-esp-elf-gdb-14.2_20240403-x86_64-linux-gnu.tar.gz"
    GDB_RV32_URL="https://github.com/espressif/binutils-gdb/releases/download/esp-gdb-v14.2_20240403/riscv32-esp-elf-gdb-14.2_20240403-x86_64-linux-gnu.tar.gz"
else
    echo "[錯誤] 不支援的作業系統: $OS_NAME"
    exit 1
fi

echo "  對應平台: $PLATFORM_LABEL"

# ---- 下載函數 ----
download_tool() {
    local TOOL_NAME="$1"
    local URL="$2"
    local DEST_DIR="$3"
    local STRIP_PREFIX="$4"

    if [ -d "$DEST_DIR" ] && [ "$(ls -A "$DEST_DIR" 2>/dev/null)" ]; then
        echo "  [✓] $TOOL_NAME 已存在，跳過下載"
        return 0
    fi

    echo "  [↓] 正在下載 $TOOL_NAME ..."
    local TMP_FILE="/tmp/esp32_tool_$$_$(basename "$URL")"
    curl -L --progress-bar -o "$TMP_FILE" "$URL"

    echo "  [⚙] 正在解壓 $TOOL_NAME ..."
    mkdir -p "$DEST_DIR"

    if [ -n "$STRIP_PREFIX" ]; then
        tar xzf "$TMP_FILE" -C "$DEST_DIR" --strip-components=1
    else
        tar xzf "$TMP_FILE" -C "$DEST_DIR"
    fi

    rm -f "$TMP_FILE"
    echo "  [✓] $TOOL_NAME 下載完成"
}

echo ""

# ---- 下載 arduino-cli ----
ARDUINO_DIR="$LINK_DIR/tools/Arduino"
ARDUINO_CLI_BIN="$ARDUINO_DIR/arduino-cli"

if [ "$OS_NAME" == "Darwin" ]; then
    if [ "$ARCH" == "arm64" ]; then
        ARDUINO_CLI_URL="https://github.com/arduino/arduino-cli/releases/download/v0.35.3/arduino-cli_0.35.3_macOS_ARM64.tar.gz"
    else
        ARDUINO_CLI_URL="https://github.com/arduino/arduino-cli/releases/download/v0.35.3/arduino-cli_0.35.3_macOS_64bit.tar.gz"
    fi
elif [ "$OS_NAME" == "Linux" ]; then
    ARDUINO_CLI_URL="https://github.com/arduino/arduino-cli/releases/download/v0.35.3/arduino-cli_0.35.3_Linux_64bit.tar.gz"
fi

# 檢查 arduino-cli 是否需要更新（架構不匹配或不存在）
NEED_DOWNLOAD=false
if [ ! -f "$ARDUINO_CLI_BIN" ]; then
    NEED_DOWNLOAD=true
elif [ "$OS_NAME" == "Darwin" ] && [ "$ARCH" == "arm64" ]; then
    # 檢查是否為 ARM64 原生版
    if ! file "$ARDUINO_CLI_BIN" | grep -q "arm64"; then
        echo "  [!] arduino-cli 為 x86_64 版本，將更新為 ARM64 原生版..."
        NEED_DOWNLOAD=true
    fi
fi

if [ "$NEED_DOWNLOAD" == "true" ]; then
    echo "  [↓] 正在下載 arduino-cli v0.35.3 ..."
    TMP_CLI="/tmp/arduino-cli_$$.tar.gz"
    curl -L --progress-bar -o "$TMP_CLI" "$ARDUINO_CLI_URL"
    tar xzf "$TMP_CLI" -C "$ARDUINO_DIR" arduino-cli
    chmod +x "$ARDUINO_CLI_BIN"
    rm -f "$TMP_CLI"
    echo "  [✓] arduino-cli 下載完成"
else
    echo "  [✓] arduino-cli 已存在，跳過下載"
fi

# 下載 6 個 OS-specific 工具
download_tool "esp-x32 (Xtensa 編譯器)" \
    "$ESP_X32_URL" \
    "$TOOLS_DIR/esp-x32/2405" \
    "xtensa-esp-elf"

download_tool "esp-rv32 (RISC-V 編譯器)" \
    "$ESP_RV32_URL" \
    "$TOOLS_DIR/esp-rv32/2405" \
    "riscv32-esp-elf"

download_tool "esptool_py (燒錄工具)" \
    "$ESPTOOL_URL" \
    "$TOOLS_DIR/esptool_py/4.9.dev3" \
    "esptool"

download_tool "openocd-esp32 (除錯工具)" \
    "$OPENOCD_URL" \
    "$TOOLS_DIR/openocd-esp32/v0.12.0-esp32-20241016" \
    "openocd-esp32"

download_tool "xtensa-esp-elf-gdb (Xtensa GDB)" \
    "$GDB_XTENSA_URL" \
    "$TOOLS_DIR/xtensa-esp-elf-gdb/14.2_20240403" \
    "xtensa-esp-elf-gdb"

download_tool "riscv32-esp-elf-gdb (RISC-V GDB)" \
    "$GDB_RV32_URL" \
    "$TOOLS_DIR/riscv32-esp-elf-gdb/14.2_20240403" \
    "riscv32-esp-elf-gdb"

echo ""
echo "  ESP32 編譯器工具鏈就緒 ✓"

# ---- 第四步：安裝 npm 依賴並啟動 Link 服務 ----
echo ""
echo "正在檢查並安裝專案依賴套件 (npm install)..."
cd "$LINK_DIR"
npm install

echo ""
echo "======================================================="
echo "TubitBlockWeb 硬體連線助手啟動中！"
echo "請勿關閉此終端機視窗，把它最小化即可！"
echo "======================================================="
echo ""

# 偵測專案根目錄（包含 www/ 和 external-resources/ 的目錄）
PROJECT_ROOT="$(cd "$LINK_DIR/.." && pwd)"

# 如果本地有 www/ 目錄，啟動 HTTP 靜態伺服器供本地開發使用
if [ -d "$PROJECT_ROOT/www" ]; then
    lsof -ti:8080 | xargs kill -9 2>/dev/null || true
    echo "正在啟動 HTTP 靜態伺服器 (port 8080)..."
    cd "$PROJECT_ROOT"
    nohup python3 -m http.server 8080 -d "$PROJECT_ROOT" > "$PROJECT_ROOT/http_server.log" 2>&1 &
    HTTP_PID=$!
    echo "HTTP 伺服器已啟動 (PID: $HTTP_PID)"
    echo ""
    echo "請用瀏覽器開啟: http://localhost:8080/www/index.html"
    echo ""
else
    echo "本服務負責編譯與燒錄 (port 20111)，"
    echo "網頁介面請使用老師提供的 GitHub Pages 網址。"
    echo ""
fi

# 啟動 Link 連線服務 (port 20111)
cd "$LINK_DIR"
npm start

# 當 npm start 結束時，也關閉 HTTP 伺服器
if [ -n "$HTTP_PID" ]; then
    kill $HTTP_PID 2>/dev/null
fi
