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
# 使用 3.1.3 以匹配 libTuBitCore.a 的預編譯目標版本（3.1.1 會導致 runtime 崩潰）
RUN arduino-cli core install esp32:esp32@3.1.3

# 安裝 Arduino AVR 核心 (Arduino Uno 等)
RUN arduino-cli core install arduino:avr@1.8.6

# --- 設定自訂函式庫 (Custom Libraries) ---
RUN mkdir -p /root/Arduino/libraries
COPY custom_libraries/ /root/Arduino/libraries/
RUN find /root/Arduino/libraries -name "._*" -delete

# --- 預先暖機 ALL TUBITV2 擴展函式庫 ---
# 在 image build 時預先編譯包含所有 TUBITV2 擴展的 sketch：
#   BLE(V7RC_BT), WiFi(V7RC_WIFI), PS3, MTC, DTC, OTC, ATARM, PPGUN,
#   OLED(Adafruit_GFX + SH110X + U8g2 + eye_anim + chart_display + dot_matrix),
#   ESP32Servo 等。
# build 目錄保留在 /arduino-ble-seed，執行期每次編譯前 cp 到 buildDir，
# arduino-cli 只需重新編譯 sketch.ino，其餘 library .o 直接重用。
# 重要：warmup sketch 必須 include 所有可能用到的 library，否則對應 .o 不會被產生。
COPY ble_warmup/ /tmp/ble-warmup/sketch/
RUN mkdir -p /arduino-ble-seed /arduino-cache && \
    arduino-cli compile \
        --fqbn "esp32:esp32:esp32:JTAGAdapter=default,PSRAM=disabled,PartitionScheme=default,CPUFreq=240,FlashMode=qio,FlashFreq=80,FlashSize=4M,UploadSpeed=460800,LoopCore=1,EventsCore=1,DebugLevel=none,EraseFlash=none,ZigbeeMode=default" \
        --build-cache-path "/arduino-cache" \
        --build-path "/arduino-ble-seed" \
        /tmp/ble-warmup/sketch && \
    rm -rf /tmp/ble-warmup && \
    echo "BLE+ATARM seed done: $(du -sh /arduino-ble-seed | cut -f1)"

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
