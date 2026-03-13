# TubitBlock Web 線上編譯版

專為資訊教育設計的**零安裝**積木程式開發環境。學生只需打開瀏覽器，即可拖曳積木、線上編譯、直接燒錄 ESP32/TuBit MTC v2 開發板——不需安裝任何軟體。

---

## 目錄

1. [系統需求](#一系統需求)
2. [學生使用流程（上課步驟）](#二學生使用流程上課步驟)
3. [系統架構說明](#三系統架構說明)
4. [雲端編譯伺服器](#四雲端編譯伺服器)
5. [本地靜態伺服器（開發測試用）](#五本地靜態伺服器開發測試用)
6. [常見問題與故障排除](#六常見問題與故障排除)
7. [資訊教師進階指南：自行部署編譯伺服器](#七資訊教師進階指南自行部署編譯伺服器)
8. [自訂硬體與函式庫](#八自訂硬體與函式庫)
9. [專案結構說明](#九專案結構說明)
10. [版本更新紀錄](#十版本更新紀錄)

---

## 一、系統需求

### 學生電腦（前端）

| 項目 | 需求 |
|------|------|
| 瀏覽器 | **Google Chrome 89+** 或 **Microsoft Edge 89+**（必須支援 Web Serial API）|
| 作業系統 | Windows 10/11、macOS 12+、ChromeOS |
| 網路 | 需能連線至雲端編譯伺服器（預設：`https://kevinkid-tubit.mooo.com:3001`）|
| USB 驅動 | TuBit MTC v2 使用 **CH340/CH341** 晶片，Windows 需安裝驅動（見下方說明）|

> **重要：** Safari 和 Firefox **不支援** Web Serial API，無法使用燒錄功能。請確保所有學生使用 Chrome 或 Edge。

### Windows 電腦 USB 驅動安裝

TuBit MTC v2 透過 CH340 晶片與電腦通訊。Windows 預設不含此驅動，需手動安裝：

1. 下載驅動：[CH341SER 官方驅動](https://www.wch-ic.com/downloads/CH341SER_ZIP.html)
2. 解壓縮後執行 `SETUP.EXE`，點擊「安裝」
3. 安裝完成後**重新啟動電腦**
4. 重啟後插入 USB，裝置管理員應可看到 `USB-SERIAL CH340 (COM*)`

> **資訊教師建議：** 請在學期初預先將 CH341 驅動整合至電腦教室的系統映像（Ghost Image）中，避免上課時學生發現無法連線。macOS 12+ 及 Linux 系統已內建驅動，無需額外安裝。

---

## 二、學生使用流程（上課步驟）

### 步驟 1：開啟網頁

以 Chrome 或 Edge 開啟網址：

```
http://<伺服器IP>:8080/www/index.html
```

或您學校部署的對應網址。等待畫面從「TubitBlock Web is loading...」載入完成。

### 步驟 2：選擇設備

畫面載入完成後，點擊左下角「**增加設備**」，從清單中選擇「**Tubit MTC V2**」（或對應的開發板型號）。

### 步驟 3：連接開發板

1. 用 USB 傳輸線將 TuBit MTC v2 連接到電腦。
2. 點擊畫面右上角的「**連接**」按鈕。
3. 瀏覽器會彈出序列埠選擇對話框，選擇對應的 COM 埠（通常顯示為 `USB-SERIAL CH340`），點擊「**連接**」。
4. 連接成功後，右上角會顯示連線狀態。

### 步驟 4：撰寫積木程式

在積木區拖曳所需的積木組合程式邏輯。

### 步驟 5：編譯並燒錄

點擊右上角的「**上傳**」按鈕（▶ 圖示）：

- 系統會自動將積木轉換為 Arduino C++ 程式碼
- 傳送至雲端編譯伺服器進行編譯（約 10~30 秒）
- 編譯完成後，透過 Web Serial API 直接燒錄至 TuBit MTC v2
- 燒錄成功後，板子會自動重啟並執行新程式

燒錄進度可在畫面下方的訊息視窗中即時查看。

> **提示：** 若想先確認程式是否可以正確編譯（不燒錄），可點擊「**編譯 (線上)**」按鈕（藍色按鈕，位於「上傳」按鈕左側）。成功後系統會快取編譯結果，下次點擊「上傳」時可直接跳過編譯步驟，加速燒錄流程。

---

## 三、系統架構說明

```
┌─────────────────────────────────────────────────────────┐
│  學生電腦（瀏覽器）                                        │
│                                                          │
│  積木編輯器 (OpenBlock GUI)                               │
│       │  積木 → Arduino C++ 程式碼                        │
│       ▼                                                  │
│  LinkIntersector.js（WebSocket 攔截器）                   │
│       │  HTTPS POST /compile                             │
│       │                                                  │
└───────┼──────────────────────────────────────────────────┘
        │
        │  網際網路 / 區域網路
        ▼
┌─────────────────────────────────────────────────────────┐
│  雲端編譯伺服器（Synology NAS / Docker）                  │
│                                                          │
│  server.js (Node.js + Express)                           │
│       │  呼叫 arduino-cli 編譯                            │
│       │  回傳 .bin 檔案（Base64）+ 燒錄地址               │
│                                                          │
└─────────────────────────────────────────────────────────┘
        │
        │  編譯結果回傳瀏覽器
        ▼
┌─────────────────────────────────────────────────────────┐
│  學生電腦（瀏覽器）                                        │
│                                                          │
│  Esp32WebFlasher.js（使用 esptool-js 0.5.7）             │
│       │  Web Serial API                                  │
│       ▼                                                  │
│  TuBit MTC v2（USB 序列埠）                               │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 核心元件說明

| 元件 | 位置 | 功能 |
|------|------|------|
| `LinkIntersector.js` | `www/web-flasher/` | 攔截 GUI 的 WebSocket 通訊，將上傳請求改為呼叫雲端編譯 API |
| `Esp32WebFlasher.js` | `www/web-flasher/` | 封裝 esptool-js，負責透過 Web Serial API 燒錄 ESP32 |
| `SerialManager.js` | `www/web-flasher/` | 管理 Web Serial 連線的建立、讀寫與關閉 |
| `electron-shim.js` | `www/` | 提供 Electron API 的瀏覽器相容替代實作 |
| `server.js` | `compiler-server/` | Node.js 編譯 API，呼叫 arduino-cli 並回傳 .bin 檔 |
| `Dockerfile` | `compiler-server/` | Docker 容器定義，含 arduino-cli + ESP32 core 3.1.3 |

### ESP32 燒錄分區

燒錄時會寫入 4 個分區，缺少任何一個都可能導致板子無法啟動：

| 地址 | 檔案 | 說明 |
|------|------|------|
| `0x01000` | `sketch.ino.bootloader.bin` | ESP32 啟動引導程式 |
| `0x08000` | `sketch.ino.partitions.bin` | 分區表 |
| `0x0E000` | `boot_app0.bin` | OTA 資料分區（標記 factory 分區可執行）|
| `0x10000` | `sketch.ino.bin` | 使用者程式（主程式）|

---

## 四、雲端編譯伺服器

### 目前部署資訊

| 項目 | 說明 |
|------|------|
| 服務網址 | `https://kevinkid-tubit.mooo.com:3001/compile` |
| 硬體 | Synology NAS（自架）|
| 容器 | Docker（container 名稱：`compiler-server`）|
| 對映埠 | 路由器 NAT 3001 → NAS 3000 |
| ESP32 核心版本 | `esp32:esp32@3.1.3` |
| 預設編譯板型 (FQBN) | `esp32:esp32:esp32:CPUFreq=240,FlashMode=qio,FlashFreq=80,FlashSize=4M,...` |

### 健康檢查

在瀏覽器開啟以下網址，確認伺服器正常運作：

```
https://kevinkid-tubit.mooo.com:3001/
```

正常回應範例：
```json
{
  "service": "tubitblock-compiler-server",
  "status": "running",
  "version": "1.1.0"
}
```

### NAS 手動重啟 Docker 容器

若編譯伺服器無法回應，請透過 SSH 連線 NAS 進行重啟：

```bash
# SSH 連線 NAS
ssh kevinkid@122.117.187.79

# 重啟容器
echo 'PASSWORD' | sudo -S /usr/local/bin/docker restart compiler-server

# 查看容器狀態
echo 'PASSWORD' | sudo -S /usr/local/bin/docker ps
```

### 更新編譯伺服器程式碼

當 `compiler-server/server.js` 有修改，需重新部署至 NAS：

```bash
# 1. 上傳新的 server.js
sshpass -p 'PASSWORD' ssh kevinkid@122.117.187.79 \
  "cat > /volume1/docker/tubitblock/compiler-server/server.js" \
  < compiler-server/server.js

# 2. 重建 Docker 映像並重啟
sshpass -p 'PASSWORD' ssh kevinkid@122.117.187.79 "
  echo 'PASSWORD' | sudo -S /usr/local/bin/docker stop compiler-server
  echo 'PASSWORD' | sudo -S /usr/local/bin/docker rm compiler-server
  echo 'PASSWORD' | sudo -S /usr/local/bin/docker build \
    -t tubitblock-compiler /volume1/docker/tubitblock/compiler-server/
  echo 'PASSWORD' | sudo -S /usr/local/bin/docker run \
    -d --name compiler-server --restart unless-stopped \
    -p 3000:3000 tubitblock-compiler
"
```

> **注意：** 如果 `Dockerfile` 或 `custom_libraries/` 有修改，必須執行完整的重建流程（如上述 Step 2），而不只是上傳 `server.js`。

---

## 五、本地靜態伺服器（開發測試用）

若需在本機測試前端修改，可啟動一個本地靜態伺服器：

```bash
# 在專案根目錄執行（注意：需從根目錄服務，而非 www/ 子目錄）
python3 -m http.server 8080 --directory "/path/to/TubitBlockWeb線上編譯版/"
```

開啟瀏覽器，前往：

```
http://localhost:8080/www/index.html
```

> **注意：** 每次修改 `www/web-flasher/` 下的 `.js` 檔案後，在瀏覽器按 `Cmd+Shift+R`（Mac）或 `Ctrl+Shift+R`（Windows）**強制清除快取重新整理**，確保載入最新版本。靜態伺服器本身無需重啟。

### 切換編譯伺服器目標

開發時若想指向本機或自架伺服器，可在 `www/index.html` 的 `<head>` 區段加入：

```html
<script>
  window.TUBITBLOCK_COMPILE_SERVER = 'http://192.168.1.100:3000/compile';
</script>
```

加在 `<script src="web-flasher/LinkIntersector.js">` 之前即可生效，不需修改 `LinkIntersector.js` 本身。

---

## 六、常見問題與故障排除

### Q1：點擊連接後，出現錯誤或選不到序列埠

**可能原因與解決方式：**

1. **未安裝 CH340 驅動（Windows）**：請依照「系統需求」章節安裝驅動後重啟電腦。
2. **使用 Safari 或 Firefox**：這兩個瀏覽器不支援 Web Serial API，請改用 Chrome 或 Edge。
3. **USB 線是充電線而非傳輸線**：部分 Micro USB 線只有供電功能，沒有資料接腳，請換一條傳輸線。
4. **序列埠被其他程式佔用**：關閉其他可能使用序列埠的程式（如 Arduino IDE 的序列監控視窗）。

### Q2：燒錄過程卡住或失敗

**常見錯誤訊息與處理：**

| 錯誤訊息 | 原因 | 解決方式 |
|----------|------|----------|
| `Failed to connect to ESP32` | ESP32 未進入燒錄模式 | 按住板子的 BOOT 鍵，同時點擊上傳，進入 Download 模式 |
| `port is already open` | 序列埠被前次連線鎖住 | 按 F5 重新整理網頁，重新連接 |
| `編譯失敗` | 程式碼有語法錯誤 | 查看下方訊息視窗的錯誤訊息，修正積木程式後重試 |
| `net::ERR_CONNECTION_REFUSED` | 編譯伺服器無法連線 | 確認網路連線，或請資訊教師檢查 NAS 上的 Docker 容器狀態 |

### Q3：燒錄成功，但板子沒有動作

1. 確認燒錄完成後板子有自動重啟（訊息視窗應顯示「重置脈衝已送出」）。
2. 若板子未自動重啟，請手動按下板子上的 **EN** 或 **RST** 按鈕，或將 USB 線拔除再重新插入。
3. 確認積木程式邏輯正確（例如馬達的引腳號碼是否設定正確）。

### Q4：燒錄完成後再次點擊上傳，需要 F5 重整

這是正常現象。燒錄流程結束後，系統會自動嘗試重新開啟序列埠（訊息視窗顯示「序列埠已恢復，可直接再次上傳」）。若顯示「序列埠未自動重開」，則按 F5 重整後重新連接即可。

### Q5：每次上課都要重新選擇序列埠嗎？

是的。瀏覽器的 Web Serial API 基於安全考量，每次開啟頁面都需要使用者明確點擊「連接」並選擇序列埠。這是瀏覽器的安全機制，無法繞過。

### Q6：編譯很慢，需要等很久

第一次編譯約需 20~40 秒（伺服器需從頭建置），後續如果程式碼沒有修改，系統會使用快取直接燒錄，速度大幅提升。若每次都很慢，可能是 NAS 資源不足，請確認 Docker 容器記憶體至少有 **1 GB**。

---

## 七、資訊教師進階指南：自行部署編譯伺服器

若學校需要自行建置編譯伺服器（例如：不使用目前的 NAS、建立校內區域網路版本），請依以下步驟操作。

### 方案 A：Docker 部署（推薦）

適用於任何支援 Docker 的機器（NAS、伺服器、PC）。

**系統需求：**
- Docker Engine 已安裝
- 至少 **1 GB 可用 RAM**（ESP32 編譯峰值約 500 MB）
- 至少 **2 GB 可用磁碟**（ESP32 core 約 1 GB）

**部署步驟：**

```bash
# 1. 進入 compiler-server 目錄
cd compiler-server/

# 2. 建置 Docker 映像（首次建置約需 5~10 分鐘，會下載 ESP32 核心）
docker build -t tubitblock-compiler .

# 3. 啟動容器（自動重啟、綁定 port 3000）
docker run -d \
  --name compiler-server \
  --restart unless-stopped \
  -p 3000:3000 \
  tubitblock-compiler

# 4. 確認運作
curl http://localhost:3000/
```

**修改前端指向新伺服器：**

在 `www/index.html` 的 `<head>` 中加入（置於 `LinkIntersector.js` 之前）：

```html
<script>
  window.TUBITBLOCK_COMPILE_SERVER = 'http://192.168.1.xxx:3000/compile';
</script>
```

### 方案 B：直接以 Node.js 運行（無 Docker）

適用於已安裝 Node.js 與 arduino-cli 的本機環境。

**前置需求：**
- Node.js 18+
- arduino-cli 0.35+（已安裝 esp32:esp32@3.1.3 核心）

```bash
# 1. 安裝相依套件
cd compiler-server/
npm install

# 2. 啟動伺服器
node server.js
# 伺服器預設監聽 port 3000
```

### API 端點說明

#### `GET /`

健康檢查，回傳 arduino-cli 版本與已安裝核心資訊。

#### `POST /compile`

接收程式碼並回傳編譯產物。

**Request Body：**
```json
{
  "code": "void setup() {} void loop() {}",
  "board": "esp32:esp32:esp32"
}
```

**Response（成功）：**
```json
{
  "success": true,
  "buildId": "uuid...",
  "board": "esp32:esp32:esp32:CPUFreq=240,FlashMode=qio,...",
  "artifacts": {
    "sketch.ino.bin": "Base64字串...",
    "sketch.ino.bootloader.bin": "Base64字串..."
  },
  "flashAddresses": {
    "sketch.ino.bootloader.bin": 4096,
    "sketch.ino.partitions.bin": 32768,
    "boot_app0.bin": 57344,
    "sketch.ino.bin": 65536
  }
}
```

**Response（失敗）：**
```json
{
  "success": false,
  "error": "完整的 arduino-cli 錯誤輸出..."
}
```

---

## 八、自訂硬體與函式庫

### 新增 Arduino 函式庫到雲端編譯器

若課程需要使用特定的 Arduino 函式庫（例如 Adafruit NeoPixel、DHT 感測器），需要將函式庫加入 Docker 容器：

1. 將函式庫資料夾放入 `compiler-server/custom_libraries/`
2. 重新建置並部署 Docker 映像（參考第四節的「更新編譯伺服器程式碼」）

目前已內建的函式庫可在 `compiler-server/custom_libraries/` 目錄查看。

### 修改支援的開發板 (FQBN)

若需支援其他 ESP32 變體（例如 ESP32-S3、ESP32-C3）：

1. 在 `compiler-server/Dockerfile` 中加入對應核心安裝指令
2. 在 `compiler-server/server.js` 的 fallback FQBN 邏輯中加入判斷
3. 重新建置 Docker 映像

### 新增積木設備定義

新增自訂設備的積木至 GUI：

1. 在 `external-resources/devices/zh-tw.json` 新增設備條目
2. 在 `external-resources/extensions/` 建立對應的擴充目錄，包含：
   - `index.js`：擴充主程式（積木定義、程式碼生成器）
   - `toolbox.js`：積木分類與工具箱設定

---

## 九、專案結構說明

```
TubitBlockWeb線上編譯版/
│
├── www/                        # 瀏覽器前端（已建置的靜態檔案）
│   ├── index.html              # 主頁面入口
│   ├── renderer.js             # Webpack 主 bundle
│   ├── electron-shim.js        # Electron API 瀏覽器替代實作
│   ├── external-resources/     # 設備定義、擴充套件、靜態資源
│   └── web-flasher/            # 燒錄相關模組
│       ├── LinkIntersector.js  # WebSocket 攔截器 + 雲端編譯整合
│       ├── Esp32WebFlasher.js  # ESP32 燒錄器（esptool-js 封裝）
│       └── SerialManager.js    # Web Serial API 管理
│
├── compiler-server/            # 雲端編譯伺服器
│   ├── server.js               # Express API 主程式
│   ├── Dockerfile              # Docker 容器定義
│   ├── package.json            # Node.js 相依套件
│   └── custom_libraries/       # 預先整合至 Docker 的 Arduino 函式庫
│
├── external-resources/         # 設備定義與擴充套件原始碼
│   ├── devices/                # 設備清單（zh-tw.json 等）
│   └── extensions/             # 各設備的積木擴充套件
│
└── index.html                  # 根目錄重導向頁（→ www/index.html）
```

---

## 十、版本更新紀錄

### 目前版本（線上編譯版）

- **零安裝架構**：移除 `tubitblock-link` 本機服務，改以雲端 Docker 編譯 + 瀏覽器 Web Serial 燒錄
- **WebSocket 攔截器**：`LinkIntersector.js` 攔截 GUI 的上傳請求，無縫接入雲端編譯流程
- **編譯快取機制**：程式碼未修改時直接使用快取的 `.bin` 檔案，跳過重複編譯
- **正確 ESP32 燒錄分區**：伺服器明確回傳每個 `.bin` 檔的燒錄地址（`flashAddresses`），包含自動注入 `boot_app0.bin`
- **完整 FQBN 支援**：使用含 `FlashMode=qio,FlashFreq=80,CPUFreq=240` 等完整選項的 FQBN 進行編譯，確保與桌面版行為一致
- **二次重置機制**：燒錄後自動透過 Web Serial 發送 200ms RTS 重置脈衝，提升自動重啟成功率
- **自動重開序列埠**：燒錄完成後自動恢復序列埠連線，減少需要按 F5 重整的情況
- **訊息不重複**：修復燒錄訊息在 GUI 視窗重複輸出的問題

---

## 授權

本專案基於 [TubitBlock](https://github.com/openblockcc/openblock-desktop) 開放原始碼改作，遵循原始授權條款。
