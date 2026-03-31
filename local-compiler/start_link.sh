#!/bin/bash
# =====================================================================
# TubitBlockWeb 本地編譯器啟動腳本 (Mac/Linux)
# 功能：自動安裝 Node.js 與 arduino-cli，安裝 ESP32 核心，
#       啟動 compiler-server 在 localhost:3000。
#
# 使用方式：
#   chmod +x start_link.sh && ./start_link.sh
#
# 所有工具鏈統一安裝至固定目錄 ~/.tubitblock/，與腳本位置無關。
# =====================================================================

set -e

OS_NAME="$(uname -s)"
ARCH="$(uname -m)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 固定 app 資料目錄（與腳本位置無關）
APP_DIR="$HOME/.tubitblock"
mkdir -p "$APP_DIR"

echo "======================================================="
echo "TubitBlockWeb 本地編譯器安裝與啟動工具"
echo "======================================================="
echo "  作業系統: $OS_NAME"
echo "  CPU 架構: $ARCH"
echo "  資料目錄: $APP_DIR"
echo "======================================================="

# ---- 第一步：檢查 Node.js ----
echo ""
echo "[1/4] 正在檢查 Node.js 環境..."

if ! command -v node &> /dev/null; then
    echo "  找不到 Node.js，準備自動安裝..."
    if [ "$OS_NAME" == "Darwin" ]; then
        if command -v brew &> /dev/null; then
            echo "  偵測到 Homebrew，正在安裝 Node.js..."
            brew install node
        else
            echo "  正在下載 Node.js Mac 版安裝檔 (LTS)..."
            curl -o /tmp/nodejs.pkg "https://nodejs.org/dist/v20.11.1/node-v20.11.1.pkg"
            echo "  請輸入 Mac 電腦密碼以授權安裝："
            sudo installer -pkg /tmp/nodejs.pkg -target /
            rm -f /tmp/nodejs.pkg
        fi
    elif [ "$(uname -s | cut -c1-5)" == "Linux" ]; then
        if command -v apt-get &> /dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        else
            echo "  [錯誤] 請手動安裝 Node.js: https://nodejs.org/"
            exit 1
        fi
    fi

    if ! command -v node &> /dev/null; then
        echo ""
        echo "  Node.js 安裝後可能需要重啟終端機。"
        echo "  請關閉此視窗後重新執行腳本。"
        exit 1
    fi
fi

echo "  [✓] Node.js $(node -v) 已就緒"

# ---- 第二步：定位 compiler-server ----
echo ""
echo "[2/4] 正在準備編譯伺服器..."

# 優先順序：
#   1. 專案根目錄 ../compiler-server/（開發者模式，與 NAS Docker 同步）
#   2. 固定 app 目錄 ~/.tubitblock/compiler-server/（已下載過）
#   3. 從 GitHub 下載至固定 app 目錄
PARENT_COMPILER_DIR="$(dirname "$SCRIPT_DIR")/compiler-server"
APP_COMPILER_DIR="$APP_DIR/compiler-server"
COMPILER_DIR=""

if [ -f "$PARENT_COMPILER_DIR/server.js" ] && [ -d "$PARENT_COMPILER_DIR/custom_libraries" ]; then
    COMPILER_DIR="$PARENT_COMPILER_DIR"
    LIB_COUNT=$(ls -d "$COMPILER_DIR/custom_libraries"/*/ 2>/dev/null | wc -l | tr -d ' ')
    echo "  [✓] 使用專案內建 compiler-server（$LIB_COUNT 個函式庫）"
elif [ -f "$APP_COMPILER_DIR/server.js" ] && [ -d "$APP_COMPILER_DIR/custom_libraries" ]; then
    COMPILER_DIR="$APP_COMPILER_DIR"
    LIB_COUNT=$(ls -d "$COMPILER_DIR/custom_libraries"/*/ 2>/dev/null | wc -l | tr -d ' ')
    echo "  [✓] 使用已安裝的 compiler-server（$LIB_COUNT 個函式庫）"
else
    echo "  未找到 compiler-server，正在從 GitHub 下載至 $APP_COMPILER_DIR ..."

    REPO_ZIP="/tmp/tubitblock-repo-$$.zip"
    REPO_EXTRACT="/tmp/tubitblock-extract-$$"
    echo "    正在下載..."
    curl -L --progress-bar -o "$REPO_ZIP" \
        "https://github.com/kevinkidtw/TubitBlockWebOnline/archive/refs/heads/main.zip"
    echo "    正在解壓縮..."
    mkdir -p "$REPO_EXTRACT"
    unzip -q "$REPO_ZIP" -d "$REPO_EXTRACT"
    rm -f "$REPO_ZIP"
    echo "    解壓縮完成"

    mkdir -p "$APP_COMPILER_DIR"
    cp -r "$REPO_EXTRACT/TubitBlockWebOnline-main/compiler-server/"* "$APP_COMPILER_DIR/"
    rm -rf "$REPO_EXTRACT"

    COMPILER_DIR="$APP_COMPILER_DIR"
    LIB_COUNT=$(ls -d "$COMPILER_DIR/custom_libraries"/*/ 2>/dev/null | wc -l | tr -d ' ')
    echo "  [✓] 已下載 $LIB_COUNT 個自訂函式庫"
fi

# 每次啟動都從 GitHub 下載最新 server.js（只更新這一個檔案，libraries 快取保留）
echo "  更新 server.js 至最新版本..."
if curl -fsSL \
    "https://raw.githubusercontent.com/kevinkidtw/TubitBlockWebOnline/main/compiler-server/server.js" \
    -o "$COMPILER_DIR/server.js" 2>/dev/null; then
    echo "  [✓] server.js 已更新"
else
    echo "  [警告] server.js 更新失敗，使用本地快取版本"
fi

echo "  [✓] compiler-server 已就緒: $COMPILER_DIR"

# ---- 第三步：安裝 arduino-cli + ESP32 核心 ----
echo ""
echo "[3/4] 正在檢查 arduino-cli 與 ESP32 核心..."

ARDUINO_CLI=""

# 優先順序：
#   1. 系統全域 arduino-cli（PATH 中）
#   2. 固定 app 目錄 ~/.tubitblock/arduino-cli（已下載過）
#   3. 下載至固定 app 目錄
if command -v arduino-cli &> /dev/null; then
    ARDUINO_CLI="$(command -v arduino-cli)"
    echo "  [✓] 已找到全域 arduino-cli: $ARDUINO_CLI"
else
    APP_CLI="$APP_DIR/arduino-cli"
    if [ -f "$APP_CLI" ]; then
        ARDUINO_CLI="$APP_CLI"
        echo "  [✓] 已找到已安裝的 arduino-cli"
    else
        echo "  正在下載 arduino-cli v0.35.3 至 $APP_DIR ..."
        if [ "$OS_NAME" == "Darwin" ]; then
            if [ "$ARCH" == "arm64" ]; then
                CLI_URL="https://github.com/arduino/arduino-cli/releases/download/v0.35.3/arduino-cli_0.35.3_macOS_ARM64.tar.gz"
            else
                CLI_URL="https://github.com/arduino/arduino-cli/releases/download/v0.35.3/arduino-cli_0.35.3_macOS_64bit.tar.gz"
            fi
        else
            CLI_URL="https://github.com/arduino/arduino-cli/releases/download/v0.35.3/arduino-cli_0.35.3_Linux_64bit.tar.gz"
        fi
        curl -L --progress-bar -o /tmp/arduino-cli.tar.gz "$CLI_URL"
        tar xzf /tmp/arduino-cli.tar.gz -C "$APP_DIR" arduino-cli
        chmod +x "$APP_CLI"
        rm -f /tmp/arduino-cli.tar.gz
        ARDUINO_CLI="$APP_CLI"
        echo "  [✓] arduino-cli 已下載至 $APP_DIR"
    fi
fi

# 安裝 ESP32 核心（必須是 3.1.3，預編譯函式庫僅與此版本相容）
REQUIRED_ESP32_VER="3.1.3"
ESP32_CURRENT_VER=$("$ARDUINO_CLI" core list 2>/dev/null | grep "esp32:esp32" | awk '{print $2}' || true)

if [ "$ESP32_CURRENT_VER" = "$REQUIRED_ESP32_VER" ]; then
    echo "  [✓] ESP32 核心已安裝 (v${REQUIRED_ESP32_VER})"
elif [ -n "$ESP32_CURRENT_VER" ]; then
    echo "  ⚠️  偵測到 ESP32 核心版本 v${ESP32_CURRENT_VER}，但預編譯函式庫需要 v${REQUIRED_ESP32_VER}"
    echo "  正在切換至 v${REQUIRED_ESP32_VER}..."
    "$ARDUINO_CLI" core update-index --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    "$ARDUINO_CLI" core install "esp32:esp32@${REQUIRED_ESP32_VER}" --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    echo "  [✓] ESP32 核心已切換至 v${REQUIRED_ESP32_VER}"
else
    echo "  正在安裝 ESP32 核心 (esp32:esp32@${REQUIRED_ESP32_VER})，首次約需 3-5 分鐘..."
    "$ARDUINO_CLI" core update-index --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    "$ARDUINO_CLI" core install "esp32:esp32@${REQUIRED_ESP32_VER}" --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    echo "  [✓] ESP32 核心安裝完成 (v${REQUIRED_ESP32_VER})"
fi

# ---- 第四步：安裝 npm 依賴並啟動 ----
echo ""
echo "[4/4] 正在啟動本地編譯伺服器..."

cd "$COMPILER_DIR"
if [ ! -d "node_modules" ]; then
    echo "  正在安裝 npm 依賴..."
    npm install
fi

echo ""
echo "======================================================="
echo "  ✅ 本地編譯伺服器啟動中！"
echo ""
echo "  API 端點: http://localhost:3000/compile"
echo "  健康檢查: http://localhost:3000/"
echo ""
echo "  請勿關閉此視窗！把它最小化即可。"
echo "  在瀏覽器中切換到「💻 本地」模式即可使用。"
echo "======================================================="
echo ""

ARDUINO_CLI_PATH="$ARDUINO_CLI" node server.js
