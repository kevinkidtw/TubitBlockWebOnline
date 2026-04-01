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

畫面上方有一排按鈕，可選擇編譯方式：

- **「🌐 線上」／「💻 本地」切換按鈕**：選擇要使用雲端還是教室電腦的本地編譯伺服器。一般情況下選「🌐 線上」即可；若老師已在教室電腦啟動本地編譯伺服器，才需切換至「💻 本地」。
- **「編譯」按鈕**：只編譯、不燒錄，方便先確認程式是否有錯誤。編譯進度會在螢幕上彈出浮動視窗即時顯示。
- **「上傳」按鈕（▶ 圖示）**：編譯後自動燒錄至開發板。

點擊「**上傳**」後的流程：

1. 系統將積木轉換為 Arduino C++ 程式碼
2. 傳送至編譯伺服器進行編譯（約 10~30 秒）
3. 編譯完成後，透過 Web Serial API 直接燒錄至 TuBit MTC v2
4. 燒錄成功後，板子會自動重啟並執行新程式

燒錄進度可在畫面下方的訊息視窗中即時查看。

> **提示：** 先點擊「編譯」確認程式無誤後，系統會快取這次的編譯結果，再點「上傳」時可直接跳過編譯步驟，燒錄速度更快。

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
│       │  選擇編譯目標（線上 / 本地）                        │
│       │                                                  │
└───────┼──────────────────────────────────────────────────┘
        │
        ├─────────────────────────────────────┐
        │ 線上模式（HTTPS）                    │ 本地模式（HTTP）
        ▼                                     ▼
┌────────────────────────┐   ┌────────────────────────────┐
│  雲端編譯伺服器         │   │  教室電腦本地編譯伺服器      │
│  （Synology NAS/Docker）│   │  （start_link.bat / .sh）   │
│                        │   │                            │
│  server.js             │   │  server.js                 │
│  arduino-cli 編譯       │   │  arduino-cli 編譯           │
│  回傳 .bin + 燒錄地址   │   │  回傳 .bin + 燒錄地址       │
└────────────────────────┘   └────────────────────────────┘
        │                                     │
        └──────────────┬──────────────────────┘
                       │ 編譯結果回傳瀏覽器
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

燒錄完成後，系統會自動重新開啟序列埠（訊息視窗顯示「序列埠已恢復，可直接再次上傳」），接著點擊「連接」可直接重新連線，**不需按 F5**。若顯示「序列埠未自動重開」，才需要 F5 重整後重新連接。

### Q5：每次上課都要重新選擇序列埠嗎？

是的。瀏覽器的 Web Serial API 基於安全考量，每次開啟頁面都需要使用者明確點擊「連接」並選擇序列埠。這是瀏覽器的安全機制，無法繞過。

### Q6：編譯很慢，需要等很久

第一次編譯約需 20~40 秒（伺服器需從頭建置），後續如果程式碼沒有修改，系統會使用快取直接燒錄，速度大幅提升。若每次都很慢，可能是 NAS 資源不足，請確認 Docker 容器記憶體至少有 **1 GB**。

---

## 七、資訊教師進階指南：自行部署編譯伺服器

若學校需要自行建置編譯伺服器（例如：不使用目前的 NAS、建立校內區域網路版本），請依以下步驟操作。

### 方案 A：一鍵啟動腳本（最簡單，推薦教室使用）

適用於想在**教室電腦**直接執行本地編譯伺服器的情境，無需 Docker、無需額外設定。腳本會自動安裝所有必要工具（Node.js、arduino-cli、ESP32 核心），完成後在背景啟動伺服器，學生在瀏覽器切換至「💻 本地」模式即可使用。

**Windows 電腦：**

1. 下載 `local-compiler/start_link.bat`
2. 雙擊執行，腳本會自動下載並執行最新版 PowerShell 腳本
3. 安裝完成後，終端機顯示「伺服器已啟動於 http://localhost:3000」即可

> **注意（Windows）：** 執行時系統可能出現「已封鎖不明的應用程式」警告，請點擊「仍要執行」。腳本首次執行需要網路下載工具（約 5~10 分鐘）；之後再次執行則秒速啟動。

**macOS / Linux 電腦：**

```bash
# 在終端機執行
bash local-compiler/start_link.sh
```

**工具鏈安裝位置：**

| 平台 | 安裝路徑 |
|------|---------|
| Windows | `C:\TubitBlock\`（固定 ASCII 路徑，避免中文帳號問題）|
| macOS / Linux | `~/.tubitblock/` |

每次啟動腳本都會自動從 GitHub 拉取最新版 `server.js`，確保修復同步生效，不需要手動更新。

### 方案 B：Docker 部署（適合伺服器長期運行）

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

### 方案 C：直接以 Node.js 運行（無 Docker）

適用於已安裝 Node.js 與 arduino-cli 的本機環境。

**前置需求：**
- Node.js 20+
- arduino-cli 0.35+（已安裝 esp32:esp32@3.1.3 核心）

```bash
# 1. 安裝相依套件
cd compiler-server/
npm install

# 2. 啟動伺服器
node server.js
# 伺服器預設監聽 port 3000
```

### 方案 D：GitHub Actions（免維護雲端，適合低預算）

利用 GitHub Actions Runner 執行 arduino-cli 編譯，不需任何自架伺服器。

**架構流程：**

```
瀏覽器（積木編輯器）
    │
    │  POST /compile（帶上 .ino 原始碼）
    ▼
中介 API（Cloudflare Worker / Vercel Edge Function）
    │  GitHub REST API: workflow_dispatch
    ▼
GitHub Actions Runner（免費 ubuntu-latest）
    │  arduino-cli 編譯，上傳 artifacts
    ▼
中介 API 輪詢 artifacts 並回傳
    │
    ▼
瀏覽器下載 .bin，Web Serial 燒錄
```

**步驟 1：建立 Workflow 檔案**

在 repo 新增 `.github/workflows/compile.yml`：

```yaml
name: Compile ESP32

on:
  workflow_dispatch:
    inputs:
      sketch_b64:
        description: 'Base64 encoded sketch.ino'
        required: true
      job_id:
        description: 'Unique job ID'
        required: true

jobs:
  compile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Cache arduino-cli data
        uses: actions/cache@v4
        with:
          path: ~/.arduino15
          key: arduino-esp32-3.1.3

      - name: Decode sketch
        run: |
          mkdir -p sketch
          echo "${{ inputs.sketch_b64 }}" | base64 -d > sketch/sketch.ino

      - name: Install arduino-cli
        run: |
          curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
          echo "$HOME/bin" >> $GITHUB_PATH

      - name: Install ESP32 core
        run: |
          arduino-cli config init
          arduino-cli config add board_manager.additional_urls \
            https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
          arduino-cli core update-index
          arduino-cli core install esp32:esp32@3.1.3

      - name: Compile
        run: |
          arduino-cli compile \
            --fqbn esp32:esp32:esp32 \
            --build-path ./build \
            --libraries ./compiler-server/custom_libraries \
            ./sketch

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: firmware-${{ inputs.job_id }}
          path: build/*.bin
          retention-days: 1
```

**步驟 2：中介 API（觸發 + 輪詢）**

```javascript
// POST /compile  →  觸發 GitHub Actions
export async function handleCompile(request) {
  const { code } = await request.json();
  const jobId = crypto.randomUUID();

  await fetch(
    `https://api.github.com/repos/OWNER/REPO/actions/workflows/compile.yml/dispatches`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { sketch_b64: btoa(code), job_id: jobId } }),
    }
  );
  return Response.json({ jobId });
}
```

**步驟 3：前端輪詢（修改 LinkIntersector.js）**

```javascript
async function compileWithGitHubActions(code) {
  const { jobId } = await fetch('/api/compile', {
    method: 'POST', body: JSON.stringify({ code }),
  }).then(r => r.json());

  // 每 5 秒輪詢，最多等 5 分鐘
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await fetch(`/api/status/${jobId}`).then(r => r.json());
    if (status.state === 'completed') return status.downloadUrls;
    if (status.state === 'failed') throw new Error('Compile failed');
  }
}
```

**優缺點比較：**

| 項目 | NAS Docker（現行）| GitHub Actions |
|------|-----------------|---------------|
| 費用 | NAS 電費 | 免費（public repo 無限；private repo 2000 min/月）|
| 速度 | ~30 秒 | **3–8 分鐘**（含 runner 啟動）|
| 速度（有快取）| ~15 秒 | ~1–2 分鐘 |
| 可靠性 | 依賴家用網路 | GitHub 基礎設施 |
| 維護量 | 需管理 Docker | 零維護 |
| 最大併發 | 受 NAS 限制 | 多 runner 並行 |

> **建議：** 若主要考量是零維護且可接受較長等待時間，選 GitHub Actions；若需要速度接近現行水準，建議改用 Railway / Render / Fly.io 部署 `compiler-server`。

---

### 大規模部署：高併發 NAS 硬體規格建議

當需要支援教室或學校規模（同時 100 個以上的編譯請求）時，可參考以下規格。

**單次 arduino-cli 編譯的資源消耗：**

| 資源 | 消耗量 |
|------|--------|
| CPU | 1–2 cores 峰值（xtensa-esp32-elf-gcc 多進程）|
| RAM | ~300–500 MB（compiler process + node subprocess）|
| Disk I/O | 讀取 headers + 寫入 .o 物件，約 50–200 MB temp |
| 時間 | 冷編譯 60–90 秒；有 build cache 約 15–30 秒 |

**情境一：真正同時 100 個（無佇列）**

| 資源 | 計算 | 最低規格 |
|------|------|---------|
| CPU | 100 × 1.5 cores | 64 cores |
| RAM | 100 × 400 MB + OS | 64 GB |
| Disk | 100 × 150 MB temp | NVMe 500 GB+ |

**情境二：佇列制（推薦，最大併發 = 20）**

| 資源 | 計算 | 最低規格 |
|------|------|---------|
| CPU | 20 × 1.5 cores | 16–32 cores |
| RAM | 20 × 400 MB + OS | 16–32 GB |
| Disk | 20 × 150 MB temp | NVMe 200 GB |

**推薦實用配置：**

| 等級 | CPU | RAM | 儲存 | 估計吞吐（30 秒/編譯）|
|------|-----|-----|------|----------------------|
| 最低可用 | Intel Core i7-13700（16 核）| 32 GB DDR5 | NVMe 500 GB | 100 請求約 3 分鐘完成 |
| 舒適配置 | AMD Ryzen Threadripper 3960X（24 核）| 64 GB ECC DDR4 | NVMe 1 TB | 100 請求約 1.5 分鐘完成 |

**關鍵優化：將 build temp 掛載為 tmpfs（RAM Disk）**

arduino-cli 編譯時大量讀寫小檔案（`.h`、`.o`），這是最主要的瓶頸。改用 tmpfs 可讓編譯速度提升 2–3 倍：

```bash
# 開機後執行一次（分配 20 GB RAM 給 build temp）
sudo mount -t tmpfs -o size=20G tmpfs /tmp/arduino-builds/
```

並在 `server.js` 將編譯目錄指向此路徑：

```javascript
const buildPath = process.platform === 'linux'
  ? `/tmp/arduino-builds/${buildId}`
  : path.join(os.tmpdir(), buildId);
```

**server.js 加入佇列限制（支援高併發的必要修改）：**

```bash
cd compiler-server/
npm install p-queue
```

```javascript
import PQueue from 'p-queue';

// concurrency 依硬體核心數調整
const queue = new PQueue({ concurrency: 20 });

app.post('/compile', (req, res) => {
  queue.add(async () => {
    const result = await runArduinoCli(req.body);
    res.json(result);
  });
});

// 讓前端可以查詢目前佇列狀態
app.get('/queue-status', (req, res) => {
  res.json({ pending: queue.pending, size: queue.size });
});
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

#### `GET /boards`

列出伺服器上已安裝的所有開發板核心，可用來確認目標板型是否已安裝。

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
│       ├── LinkIntersector.js  # WebSocket 攔截器 + 雲端/本地編譯整合
│       ├── Esp32WebFlasher.js  # ESP32 燒錄器（esptool-js 封裝）
│       └── SerialManager.js    # Web Serial API 管理
│
├── compiler-server/            # 編譯伺服器核心（雲端與本地共用）
│   ├── server.js               # Express API 主程式
│   ├── Dockerfile              # Docker 容器定義
│   ├── package.json            # Node.js 相依套件
│   └── custom_libraries/       # 預先整合的 Arduino 函式庫
│
├── local-compiler/             # 本地編譯器一鍵啟動腳本
│   ├── start_link.bat          # Windows 版（自動下載並執行 .ps1）
│   ├── start_link.ps1          # Windows PowerShell 安裝與啟動腳本
│   └── start_link.sh           # macOS / Linux 安裝與啟動腳本
│
├── external-resources/         # 設備定義與擴充套件原始碼
│   ├── devices/                # 設備清單（zh-tw.json 等）
│   └── extensions/             # 各設備的積木擴充套件
│
└── index.html                  # 根目錄重導向頁（→ www/index.html）
```

---

## 十、版本更新紀錄

### v1.6（目前版本）— 2026-04-01

**問題修復：**

- **修復 Windows 本地編譯器中文路徑 panic（Error code 123）**：ESP32 core 3.1.x 的 Rust toolchain wrapper 使用 Win32 ANSI API 解析路徑，當使用者名稱含中文時觸發崩潰。改為將所有工具鏈（arduino-cli、compiler-server、ESP32 core data）統一安裝至 `C:\TubitBlock\`（ASCII 路徑），徹底繞過此問題。
- **修復 Windows 本地編譯 `UploadSpeed=460800` 無效**：GUI 送來的 FQBN 含 `UploadSpeed=460800`，此值在 Windows 版 arduino-cli 的 `boards.txt` 未定義。在 `server.js` 加入平台判斷，Windows 自動替換為 `921600`，並優先從平台物件中選擇正確值。
- **修復 `.bat` 執行時亂碼與命令解析錯誤**：繁中 Windows 以 Big5 讀取 UTF-8 無 BOM 的 `.bat`，UTF-8 中文字元的部分 byte 與換行符衝突，導致指令行被截斷合併。移除 `.bat` 中所有中文，改以 CRLF 換行。
- **修復 `.ps1` 執行時 `MissingEndCurlyBrace` 錯誤**：同為 Big5 解析 UTF-8 的問題，部分 `}` byte 被吃掉。加入 UTF-8 BOM（`EF BB BF`）確保 PowerShell 正確以 UTF-8 讀取。
- **修復 winget 失敗時未安裝 Node.js**：winget 存在但來源索引過期（錯誤碼 `0x8a15000f`）時，舊版直接跳過，導致 Node.js 未安裝卻顯示成功。現在啟動前先執行 `winget source update`，失敗時自動 fallback 至 MSI 直接下載。
- **修復上傳按鈕可能燒錄舊代碼（Stale Code）**：直接點擊「上傳」而未先「編譯」時，無快取情況下會將 GUI 傳來的舊 `params` 轉寄至伺服器。現在無論哪條路徑都會先呼叫 `getCurrentCodeFromGUI()` 取得最新 DOM 代碼再編譯，`requestPort()` 仍在 User Gesture context 內執行，不影響 Web Serial 權限。

**改善：**

- **`.bat` 改為自動從 GitHub 下載 `.ps1` 再執行**：使用者只需下載單一 `.bat` 檔案，腳本會自動從 GitHub 拉取最新 `start_link.ps1` 至暫存目錄執行，結束後自動清除。
- **本地編譯器 compiler-server 下載改用 ZIP**：Mac/Linux 版 `.sh` 改用 `curl` + `unzip` 下載 repo ZIP 並解壓，移除對 `git` 的依賴（原需 `git sparse-checkout`）。
- **server.js 每次啟動自動更新**：Mac/Linux `.sh` 與 Windows `.ps1` 每次啟動時都從 GitHub 下載最新 `server.js`，確保本地快取的 libraries 不動、但修復內容即時生效。
- **舊版安裝路徑自動遷移（Windows）**：偵測到舊版 `%APPDATA%\TubitBlock\` 存在時，自動搬移至 `C:\TubitBlock\` 並刪除舊目錄，使用者無需手動操作。
- **解壓縮改為文字提示**：`Expand-Archive` 進度條改為簡短文字輸出，避免 Windows 終端機畫面跳動干擾。

---

### v1.55 — 2026-03-30

**新增功能：**

- **PS3 擴充新增 `on_notify` 事件積木**：可在 PS3 控制器通知（notify）觸發時執行對應程式區塊。
- **純編譯模式新增浮動視覺化 console**：點擊「編譯（線上/本地）」按鈕但不燒錄時，顯示浮動 console 面板即時呈現編譯輸出，取代原本無反饋的靜默等待。
- **修正線上/本地模式日誌文字**：狀態列文字現在正確反映當前使用的是線上還是本地編譯模式。

**問題修復：**

- 修復編譯時無法正確抓取完整程式碼的問題：新增 Monaco editor 偵測路徑，可完整抓取到程式碼。

**UI 調整：**

- 優化「線上/本地」編譯按鈕外觀：改為群組樣式（button group），主題色隨選取模式動態切換。
- 統一按鈕寬度與內距，移除重複圖示與括號內多餘文字，整體視覺更簡潔。

---

### v1.5 — 2026-03-29

**新增功能：**

- **GUI 新增本地編譯按鈕**：除雲端編譯外，GUI 介面新增「💻 本地」切換模式，可將編譯請求導向本機運行的 `compiler-server`（`http://localhost:3000/compile`）。
- **本地編譯器一鍵啟動腳本**：提供 macOS/Linux（`start_link.sh`）與 Windows（`start_link.ps1`）啟動腳本，自動安裝 Node.js、arduino-cli、ESP32 core 3.1.3 並啟動本地編譯伺服器。所有工具鏈統一安裝至固定目錄（`~/.tubitblock/` / `%APPDATA%\TubitBlock\`），與腳本擺放位置無關。
  > ⚠️ Windows 版本尚未完整測試，macOS 版本已驗證可正常運作。

**問題修復：**

- 修復 `server.js` 在 macOS 上找不到 `boot_app0.bin`（路徑應為 `~/Library/Arduino15`）
- 修復 TubitBlock 產生的程式碼將 `#include` 放在函數後導致編譯失敗（自動提升至頂端）
- 修復程式碼缺少結尾 `}` 導致 `expected '}'` 錯誤（自動補齊括號）
- 修復 Ace editor 虛擬化渲染只抓可見行，程式碼捲動後被截斷（改用 `editor.getValue()`）
- 修復 Windows 路徑含空白時 `exec` 指令解析失敗（所有路徑加引號）
- 修復 Windows 版腳本不檢查 ESP32 core 版本，舊版本不會自動升級

---

### v1.2 — 2026-03-27

- 新增串口監視器 Web Serial 支援
- 新增 USB 拔插自動偵測，斷線時自動清理連線狀態
- 新增專案檔儲存與載入（`.tb` 格式，相容 `.sb3`、`.ob`）
- 修復編譯進度訊息未即時顯示（插入 200ms 延遲等待 React re-render）

---

### v1.12

- 修復 GUI 上傳超時（提前回覆 JSON-RPC 確認，不等待燒錄完成）
- 修復燒錄期間點擊「編譯」導致第二次編譯失敗
- 修復 GUI 燒錄訊息重複顯示
- 修復燒錄後重新連接需要 F5
- 修復 CORS 跨來源存取被封鎖（NAS nginx timeout 延長至 300 秒）
- 修復 `libTuBitCore.a` ABI 版本不符（Docker 改用 `esp32:esp32@3.1.3`）
- 更新瀏覽器 favicon 與頁面標題為「TubitBlock Web」

---

### v1.1

- 零安裝架構：改以雲端 Docker 編譯 + 瀏覽器 Web Serial 燒錄
- `LinkIntersector.js` 攔截 GUI 上傳請求，接入雲端編譯流程
- 編譯快取機制：程式碼未修改時直接使用快取 `.bin`
- 正確 ESP32 燒錄分區：伺服器回傳 `flashAddresses`，自動注入 `boot_app0.bin`
- **完整 FQBN 支援**：使用含 `FlashMode=qio,FlashFreq=80,CPUFreq=240` 等完整選項的 FQBN 進行編譯，確保與桌面版行為一致
- **二次重置機制**：燒錄後自動透過 Web Serial 發送 200ms RTS 重置脈衝，提升自動重啟成功率
- **自動重開序列埠**：燒錄完成後自動嘗試恢復序列埠連線

---

## 授權

本專案基於 [TubitBlock](https://github.com/openblockcc/openblock-desktop) 開放原始碼改作，遵循原始授權條款。
