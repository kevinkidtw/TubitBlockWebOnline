# ===========================================
# TubitBlock Online Compiler Server - Dockerfile
# ===========================================
# 此 Dockerfile 會：
# 1. 安裝 arduino-cli
# 2. 安裝 ESP32 與 Arduino AVR 核心板支援
# 3. 啟動 Node.js Express 編譯伺服器
#
# 建置方式: docker build -t tubitblock-compiler .
# 執行方式: docker run -p 3000:3000 tubitblock-compiler
# ===========================================

FROM node:20-slim

# 安裝必要系統工具
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

# --- 安裝 arduino-cli ---
ENV ARDUINO_CLI_VERSION=0.35.3
RUN curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=/usr/local/bin sh -s ${ARDUINO_CLI_VERSION}

# --- 初始化 arduino-cli 設定 ---
RUN arduino-cli config init

# --- 新增 ESP32 Board Manager URL ---
RUN arduino-cli config add board_manager.additional_urls \
    https://espressif.github.io/arduino-esp32/package_esp32_index.json

# --- 更新索引並安裝核心板 ---
RUN arduino-cli core update-index

# 安裝 ESP32 核心（這一步下載量大，約 300MB+，但只在 build 時下載一次）
RUN arduino-cli core install esp32:esp32@3.1.1

# 安裝 Arduino AVR 核心 (Arduino Uno 等)
RUN arduino-cli core install arduino:avr@1.8.6

# --- 設定工作目錄 ---
WORKDIR /app

# --- 複製並安裝 Node.js 依賴 ---
COPY package.json ./
RUN npm install --production

# --- 複製應用程式碼 ---
COPY server.js ./

# --- 環境變數 ---
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
