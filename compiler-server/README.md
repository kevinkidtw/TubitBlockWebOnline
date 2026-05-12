# TubitBlock Compiler Server

TubitBlock 線上編譯系統的後端伺服器。接收瀏覽器端送來的 Arduino/ESP32 原始碼，呼叫 `arduino-cli` 編譯，將產生的 `.bin` 二進位檔以 Base64 回傳，供前端透過 Web Serial API 直接燒錄至開發板。

---

## 架構總覽

```text
瀏覽器 (積木編輯器)
   │  POST /compile  { code, fqbn }
   ▼
compiler-server (Node.js + Express)
   │  arduino-cli compile
   ▼
/tmp/tubitblock-compile/{UUID}/    ← 每個請求獨立隔離
   ├── sketch/sketch.ino
   └── build/                      ← 從 seed 複製 + 修補
       ├── build.options.json      ← 修補 sketchLocation
       ├── libraries/**/*.o        ← 全部重用（不重編）
       └── sketch.ino.bin          ← 只重編這一個
   │
   ▼ 回傳 flashAddresses + Base64 artifacts
瀏覽器 Web Serial → ESP32 燒錄
```

---

## 核心機制

### Seed Build 暖機（編譯加速關鍵）

Docker image 建置時，預先編譯一個包含所有 TUBITV2 常用 library 的暖機 sketch（`ble_warmup/sketch.ino`），將產生的 `.o` 目標檔案保存在 `/arduino-ble-seed/`（約 52MB）。

每次學生編譯流程：

1. `cp -a /arduino-ble-seed/ → /tmp/.../build/`（22ms）
2. 修補 `build.options.json` 的 `sketchLocation` 為本次 sketch 路徑
3. 修補所有 `.d` 依賴檔案的目標路徑（`sed`）
4. 執行 `arduino-cli compile`

arduino-cli 的增量編譯機制判定所有 library `.o` 皆為最新，只重新編譯 `sketch.ino`。

**實測編譯速度（NAS Docker 環境）：**

| 程式類型 | 速度 | 說明 |
| ------- | ---- | ---- |
| 非 BLE（馬達、感測器等） | ~7s | 極快，幾乎只是 link |
| BLE（V7RC_BT、PS3） | ~30–55s | 瓶頸為 xtensa linker 掃描 3.1GB archives |

> **注意**：BLE linker 是 CPU-bound 的單執行緒瓶頸，OS page cache 暖機與 `--jobs N` 均無法改善。

### 重要限制：`build.options.json` 必須完全一致

arduino-cli 在判斷快取是否有效時，會比對 `build.options.json` 的所有欄位。若 seed build 時的設定與學生編譯時的設定不完全相符，所有 `.o` 都會被視為無效並重編（退化成 90s+）。

**最容易踩坑的地方**：Dockerfile 暖機指令 **不能** 加 `--libraries` 旗標。加了之後 `otherLibrariesFolders` 欄位會被填入明確路徑，與學生編譯（不加 `--libraries`，使用預設目錄）產生差異。Custom libraries 放在 arduino-cli 預設用戶目錄（`/root/Arduino/libraries/`），不需要明確指定。

### 靜態產物快取

server 啟動時，從 seed build 預先讀取 3 個每次都相同的靜態分區檔案到記憶體：

- `sketch.ino.bootloader.bin` → `0x1000`
- `sketch.ino.partitions.bin` → `0x8000`
- `boot_app0.bin` → `0xe000`（從 ESP32 core tools/partitions/ 自動注入）

每次編譯回應直接從記憶體夾帶這 3 個檔案，只有 `sketch.ino.bin`（`0x10000`）是每次實際編譯的結果。

### Flash 分區映射

ESP32 正確燒錄需要 4 個分區：

| 地址 | 檔案 | 來源 |
| ---- | ---- | ---- |
| `0x01000` | `sketch.ino.bootloader.bin` | arduino-cli 編譯產出（靜態快取） |
| `0x08000` | `sketch.ino.partitions.bin` | arduino-cli 編譯產出（靜態快取） |
| `0x0E000` | `boot_app0.bin` | ESP32 core `tools/partitions/`（自動注入） |
| `0x10000` | `sketch.ino.bin` | 每次編譯的應用程式 |

> `sketch.ino.merged.bin` 與 `.elf` 會被過濾掉，不回傳給前端。

### 並發隔離

每個編譯請求使用獨立 UUID 目錄（`/tmp/tubitblock-compile/{UUID}/`），請求之間完全隔離，支援多個學生同時編譯。

---

## 部署

### 方案 A：Docker（NAS / 雲端，推薦）

```bash
cd compiler-server
docker build -t tubitblock-compiler .
docker run -d --name compiler-server --restart unless-stopped -p 3000:3000 tubitblock-compiler
```

**系統需求：**

- RAM：至少 2GB（BLE 連結峰值約 1.5GB）
- 磁碟：映像檔約 3.5GB（含 ESP32 core 3.1.3 + 所有 library）
- 初次建置時間：約 10–20 分鐘（會下載 ESP32 core 並預編所有 library）

**Synology NAS 重新部署指令：**

```bash
echo PASSWORD | sudo -S /usr/local/bin/docker stop compiler-server
echo PASSWORD | sudo -S /usr/local/bin/docker rm compiler-server
echo PASSWORD | sudo -S /usr/local/bin/docker build -t tubitblock-compiler /volume1/docker/tubitblock/compiler-server/
echo PASSWORD | sudo -S /usr/local/bin/docker run -d --name compiler-server --restart unless-stopped -p 3000:3000 tubitblock-compiler
```

### 方案 B：本機直接執行（開發 / 測試用）

```bash
# 需先安裝：Node.js、arduino-cli（含 esp32:esp32@3.1.3、arduino:avr@1.8.6）
cd compiler-server
npm install
node server.js
```

首次執行時若缺少 seed build，server 會在背景自動執行暖機編譯（約 3–5 分鐘）。

---

## API

### `GET /`

Health check。回傳伺服器版本、seed build 狀態、已安裝的核心板列表。

### `POST /compile`

**Request Body：**
```json
{
  "code": "#include <TuBitCore.h>\nvoid setup() {} void loop() {}",
  "fqbn": "esp32:esp32:esp32:JTAGAdapter=default,PSRAM=disabled,PartitionScheme=default,CPUFreq=240,FlashMode=qio,FlashFreq=80,FlashSize=4M,UploadSpeed=460800,LoopCore=1,EventsCore=1,DebugLevel=none,EraseFlash=none,ZigbeeMode=default"
}
```

**Response（成功）：**
```json
{
  "success": true,
  "buildId": "8ca5af44-...",
  "flashAddresses": {
    "sketch.ino.bootloader.bin": 4096,
    "sketch.ino.partitions.bin": 32768,
    "boot_app0.bin": 57344,
    "sketch.ino.bin": 65536
  },
  "artifacts": {
    "sketch.ino.bootloader.bin": "<Base64>",
    "sketch.ino.partitions.bin": "<Base64>",
    "boot_app0.bin": "<Base64>",
    "sketch.ino.bin": "<Base64>"
  }
}
```

**Response（失敗）：**
```json
{
  "success": false,
  "buildId": "...",
  "error": "完整的 arduino-cli 輸出（含語法錯誤訊息）"
}
```

---

## 目錄結構

```text
compiler-server/
├── server.js              # Express 主程式
├── Dockerfile             # Docker 建置設定
├── package.json
├── ble_warmup/
│   └── sketch.ino         # 暖機 sketch（含所有 TUBITV2 library）
└── custom_libraries/      # 自訂函式庫（COPY 至 /root/Arduino/libraries/）
    ├── TuBitCore/         # libTuBitCore.a（預編譯，針對 esp32:esp32@3.1.3）
    ├── V7RC_BT/
    ├── V7RC_WIFI/
    ├── TuMTC/
    ├── TuDTC/
    ├── TuOTC/
    ├── ATARM/
    ├── PPGUN/
    ├── Ps3Controller/
    ├── ESP32Servo/
    └── ...（其他擴充 library）
```

---

## 常見問題

### BLE 程式碼編譯超過 60 秒

正常現象。ESP32 BLE linker（`xtensa-esp-elf-ld`）需要單執行緒掃描 3.1GB 的 archive 檔案，這是工具鏈的硬性限制。seed build 已消除 library 重編的時間，剩下的全是 linker 時間。

### 編譯突然變回 90 秒

seed build 的 `build.options.json` 與學生編譯的設定不符，導致增量編譯失效。最常見原因：

1. Dockerfile warmup 指令多了 `--libraries` 旗標 → 移除
2. FQBN 與 warmup 使用的不同 → 確認兩者完全一致
3. Docker image 未重建 → 重新 `docker build`

確認方法：進入容器執行 `cat /arduino-ble-seed/build.options.json`，比對 `otherLibrariesFolders` 欄位是否為 `/root/Arduino/libraries`。

### 燒錄失敗 `InvalidStateError: The port is already open`

esptool-js transport 未正確釋放 port 鎖。`Esp32WebFlasher.js` 的 `finally` 區塊已確保在所有路徑（成功、失敗）下都會呼叫 `esploader.transport.disconnect()`，若仍發生請重新連接序列埠。

### `libTuBitCore.a` 連結錯誤 / firmware 燒錄後崩潰

`libTuBitCore.a` 是針對 `esp32:esp32@3.1.3` 預編譯的靜態庫。若 Docker 使用不同版本的 ESP32 core，會發生 ABI 不符——編譯不報錯，但執行時崩潰。確認 Dockerfile 使用 `esp32:esp32@3.1.3`。

---

## 環境版本

| 元件 | 版本 |
| ---- | ---- |
| Node.js | 20 (slim) |
| arduino-cli | 0.35.3 |
| ESP32 core | 3.1.3 |
| Arduino AVR core | 1.8.6 |
| esptool-js（前端） | 0.5.7 |
