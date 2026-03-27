#!/bin/bash
# =====================================================================
# TubitBlockWeb 本地編譯器啟動腳本 (Mac/Linux)
# 功能：自動安裝 Node.js 與 arduino-cli，安裝 ESP32 核心，
#       啟動 compiler-server 在 localhost:3000。
#
# 使用方式：
#   chmod +x start_link.sh && ./start_link.sh
# =====================================================================

set -e

OS_NAME="$(uname -s)"
ARCH="$(uname -m)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "======================================================="
echo "TubitBlockWeb 本地編譯器安裝與啟動工具"
echo "======================================================="
echo "  作業系統: $OS_NAME"
echo "  CPU 架構: $ARCH"
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

# ---- 第二步：下載 compiler-server ----
echo ""
echo "[2/4] 正在準備編譯伺服器..."

COMPILER_DIR="$SCRIPT_DIR/compiler-server"

if [ ! -f "$COMPILER_DIR/server.js" ]; then
    echo "  正在從 GitHub 下載 compiler-server..."
    mkdir -p "$COMPILER_DIR"

    # 嘗試用 Git sparse-checkout
    if command -v git &> /dev/null; then
        TEMP_REPO="/tmp/tubitblock-repo-$$"
        git clone --filter=blob:none --no-checkout --depth 1 \
            https://github.com/kevinkidtw/TubitBlockWebOnline.git "$TEMP_REPO" 2>&1
        cd "$TEMP_REPO"
        git sparse-checkout init --cone
        git sparse-checkout set compiler-server
        git checkout 2>&1
        cp -r "$TEMP_REPO/compiler-server/"* "$COMPILER_DIR/"
        rm -rf "$TEMP_REPO"
    else
        # 用 curl 下載 server.js 和 package.json
        curl -sL "https://raw.githubusercontent.com/kevinkidtw/TubitBlockWebOnline/main/compiler-server/server.js" \
            -o "$COMPILER_DIR/server.js"
        curl -sL "https://raw.githubusercontent.com/kevinkidtw/TubitBlockWebOnline/main/compiler-server/package.json" \
            -o "$COMPILER_DIR/package.json"
    fi
fi

echo "  [✓] compiler-server 已就緒: $COMPILER_DIR"

# ---- 第三步：安裝 arduino-cli + ESP32 核心 ----
echo ""
echo "[3/4] 正在檢查 arduino-cli 與 ESP32 核心..."

ARDUINO_CLI=""

# 檢查全域 arduino-cli
if command -v arduino-cli &> /dev/null; then
    ARDUINO_CLI="$(command -v arduino-cli)"
    echo "  [✓] 已找到全域 arduino-cli: $ARDUINO_CLI"
else
    # 本地安裝
    LOCAL_CLI="$SCRIPT_DIR/arduino-cli"
    if [ -f "$LOCAL_CLI" ]; then
        ARDUINO_CLI="$LOCAL_CLI"
        echo "  [✓] 已找到本地 arduino-cli"
    else
        echo "  正在下載 arduino-cli v0.35.3..."
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
        tar xzf /tmp/arduino-cli.tar.gz -C "$SCRIPT_DIR" arduino-cli
        chmod +x "$LOCAL_CLI"
        rm -f /tmp/arduino-cli.tar.gz
        ARDUINO_CLI="$LOCAL_CLI"
        echo "  [✓] arduino-cli 已下載"
    fi
fi

# 安裝 ESP32 核心
ESP32_CORE_INSTALLED=$("$ARDUINO_CLI" core list 2>/dev/null | grep -c "esp32:esp32" || true)
if [ "$ESP32_CORE_INSTALLED" -eq 0 ]; then
    echo "  正在安裝 ESP32 核心 (esp32:esp32@3.1.3)，首次約需 3-5 分鐘..."
    "$ARDUINO_CLI" core update-index --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    "$ARDUINO_CLI" core install esp32:esp32@3.1.3 --additional-urls "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
    echo "  [✓] ESP32 核心安裝完成"
else
    echo "  [✓] ESP32 核心已安裝"
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
