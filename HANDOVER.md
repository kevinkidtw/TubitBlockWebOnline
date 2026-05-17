# TubitBlock Web — 工程師交接文件

> 本文件說明 TubitBlock Web 版的整體架構、各檔案職責、關鍵依賴，以及開發過程中遇到的 Bug 與解法。適合接手維護的工程師快速上手。

---

## 一、系統全貌

TubitBlock Web 把原本只能在桌面 Electron App 執行的積木編程環境，搬到標準瀏覽器上。核心挑戰在於：

1. GUI 主程式是**打包過的 Webpack bundle**（無法修改原始碼），對外依賴 Electron API（`ipcRenderer`、`clipboard` 等）和本地 Link Server（WebSocket）
2. 編譯需要呼叫 `arduino-cli`，瀏覽器端無法直接執行
3. 燒錄需要存取 USB Serial Port，必須透過 **Web Serial API**（僅限 HTTPS / localhost）

```
瀏覽器（使用者）
  │
  ├── index.html            載入 shim + flasher 模組，再載入 GUI bundle
  │
  ├── electron-shim.js      攔截 require('electron')，提供假的 Electron API
  │                         攔截 navigator.clipboard / 資源 URL / 專案載入
  │
  ├── web-flasher/
  │   ├── LinkIntersector.js   攔截 GUI 對 Link Server 的 WebSocket，
  │   │                        把「上傳」流程改成：雲端編譯 → Web Serial 燒錄
  │   ├── SerialManager.js     封裝 Web Serial API 連線、讀取、重連
  │   ├── Esp32WebFlasher.js   ESP32 燒錄（esptool-js 協定）
  │   └── Stk500WebFlasher.js  Arduino AVR 燒錄（STK500v1 協定）
  │
  └── *.bundle.js           GUI 主程式（Webpack 打包，不要修改）

雲端（NAS Docker）
  └── compiler-server/
      └── server.js         Express + arduino-cli，接收程式碼回傳 .bin
```

---

## 二、各檔案詳細說明

### `www/index.html`
**入口頁面**。載入順序非常重要：

1. `electron-shim.js` — 必須最先載入，在 GUI bundle 執行前把所有 shim 裝好
2. `web-flasher/SerialManager.js`
3. `web-flasher/Stk500WebFlasher.js`
4. `web-flasher/Esp32WebFlasher.js`
5. `web-flasher/LinkIntersector.js` — 必須在 SerialManager 之後載入
6. `renderer.js` 等 GUI bundle — 最後才執行

`?v=N` 版本號用於 cache busting，每次修改 `electron-shim.js` 務必同步遞增（否則瀏覽器不會載入新版）。

---

### `www/electron-shim.js`
**最核心的 shim 層**，共約 1900 行。負責：

| 功能 | 說明 |
|------|------|
| `ipcRenderer` shim | 假的 Electron IPC，回應 `get-initial-project-data`（回傳預設空白專案 JSON）、`getTelemetryDidOptIn` 等 |
| `navigator.clipboard` polyfill | HTTP 環境下 `navigator.clipboard` 為 undefined，需在 GUI 初始化前補上，否則 `ScratchDesktopGUIHOC.jsx:componentDidMount` 崩潰 |
| `clipboard` shim | 供 `require('electron').clipboard` 使用 |
| `require()` 攔截 | 攔截 `require('electron')`、`require('fs')`、`require('path')`、`require('@electron/remote')` |
| URL 重導向 | `window.open` / `<a>` 點擊 / `shell.openExternal` 中，`wiki.openblock.cc` 和 `openblock.cc` 一律轉到 `https://trgreat.com/tu-wiki/` |
| 資源 URL 攔截 | `http://127.0.0.1:20112/...` 的圖片/JSON 請求改為讀取 `./external-resources/...` 本地靜態檔案（fetch + XHR + img src 三層攔截） |
| Script src 攔截 | 動態注入的 `<script src="http://127.0.0.1:20112/...">` 也會被重寫 |
| VM `loadProject` 修補 | 攔截 GUI VM 的 `loadProject`，在載入時計算 costume 的 MD5 hash，確保 assetId 合規 |
| 品牌替換 | 把 GUI 內的 OpenBlock logo 換成 TubitBlock logo |
| 預設專案 | `get-initial-project-data` 回傳包含 BitTu 角色的空白 SB3 JSON，assetId 必須是 32 位 hex MD5 |

**重要常數**：
- 預設 BitTu costume assetId：`732e5c641367f9185529fcd5fe13f801`
- 對應圖片：`www/static/assets/732e5c641367f9185529fcd5fe13f801.png`

---

### `www/web-flasher/LinkIntersector.js`
**WebSocket 攔截器 + 編譯/燒錄協調器**，最複雜的一個模組（1008 行）。

**運作流程**：

```
GUI bundle 建立 WebSocket → LinkIntersector 攔截 → 建立假 WebSocket（FakeWS）
  │
  ├── discover 事件 → 注入假的裝置發現回應（讓 GUI 以為找到硬體）
  │
  ├── connect 事件 → 嘗試開啟 Web Serial 連線（reconnect → requestPort）
  │
  └── upload 事件 → 
        1. 取得 GUI 目前的積木原始碼
        2. POST 到雲端編譯器 /compile
        3. 取得 Base64 .bin 檔案 + flashAddresses
        4. 呼叫 Esp32WebFlasher 或 Stk500WebFlasher 燒錄
        5. 回報燒錄結果給 GUI
```

**編譯 URL 邏輯**：

```javascript
const ONLINE_COMPILE_URL = window.TUBITBLOCK_COMPILE_SERVER  // 可從外部注入
    || 'https://kevinkid-tubit.mooo.com:3001/compile';       // 預設 fallback
const LOCAL_COMPILE_URL = 'http://localhost:3000/compile';
// compileMode 存在 localStorage，使用者可透過 UI 切換
```

**編譯快取**：相同原始碼（以 MD5 hash 比對）不重複編譯，直接用上次的 .bin 燒錄，加速重複燒錄流程。

**注入的 UI 元素**：
- **模式切換按鈕**：線上（深藍）/ 本地（橘色）
- **編譯按鈕**：並排在原本的上傳按鈕旁，點擊觸發整個編譯→燒錄流程

---

### `www/web-flasher/SerialManager.js`
**Web Serial API 封裝層**（333 行）。

| 方法 | 說明 |
|------|------|
| `requestPort()` | 彈出 port 選擇器（需 User Gesture） |
| `reconnect(baud)` | 靜默重連，優先用 `getPorts()` 取得已授權 port |
| `open(baud)` | 開啟連線、啟動背景讀迴圈 `_readLoop` |
| `close()` | 正確釋放鎖：`cancel/close → releaseLock() → port.close()` |
| `write(data)` | 透過 WritableStreamDefaultWriter 寫入 |

**重要**：`_readLoop` 把硬體資料寫入 `window._stk500_rxBuffer`（全域共享緩衝），或呼叫 `this.onDataReceived` callback，供燒錄器和串口監視器使用。

---

### `www/web-flasher/Esp32WebFlasher.js`
**ESP32 燒錄模組**（207 行），封裝 esptool-js（CDN 載入，v0.5.7）。

接受 `{ data: Uint8Array, address: number }[]` 陣列，依序燒錄到對應 flash 地址。燒錄完成後在 `finally` 區塊呼叫 `transport.disconnect()` 釋放 port 鎖。

**ESP32 必要的 4 個分區**：

| Flash 地址 | 檔案 | 來源 |
|-----------|------|------|
| `0x01000` | `sketch.ino.bootloader.bin` | 編譯器回傳（靜態快取） |
| `0x08000` | `sketch.ino.partitions.bin` | 編譯器回傳（靜態快取） |
| `0x0E000` | `boot_app0.bin` | 編譯器自動注入（ESP32 core tools） |
| `0x10000` | `sketch.ino.bin` | 每次編譯的應用程式 |

---

### `www/web-flasher/Stk500WebFlasher.js`
**Arduino AVR（Uno）燒錄模組**（315 行），實作 STK500v1 協定。內建 Sliding Window 防錯位讀取機制，處理 sync timeout 和 `0x14 0x10` 殘留問題。

---

### `compiler-server/server.js`
**後端編譯 API**（Express + Node.js）。

| 端點 | 說明 |
|------|------|
| `GET /` | Health check，回傳版本、arduino-cli 版本、並發狀態 |
| `POST /compile` | 接收 `{ code, fqbn }`，呼叫 arduino-cli，回傳 Base64 .bin + flashAddresses |

**核心機制**：
- **Seed Build 加速**：複製 `/arduino-ble-seed/` 預編譯的 `.o` 檔，讓 arduino-cli 只重編 sketch.ino（BLE 從 90s → 30-55s）
- **靜態產物快取**：bootloader / partitions / boot_app0.bin 在 FQBN 不變時完全相同，server 啟動時從 seed 讀入記憶體，不需每次重新讀取
- **並發 Semaphore**：最多 28 個同時編譯（60GB RAM / 每個 BLE 峰值 1.5GB），超過的請求排隊等待，不拒絕
- **自動注入 boot_app0.bin**：`findBootApp0()` 從 ESP32 core 目錄動態定位此檔案
- **原始碼修補**：自動把 `#include` 提到頂端、補 `setup()`/`loop()`、補缺少的 `}`

---

### `compiler-server/Dockerfile`
使用 `node:20-slim`，安裝 `arduino-cli 0.35.3`，安裝：
- `esp32:esp32@3.1.3`（**版本固定，不可隨意升級，libTuBitCore.a 針對此版本 ABI 編譯**）
- `arduino:avr@1.8.6`

`custom_libraries/` 中的自訂函式庫（含 `TuBitCore`、`V7RC_BT`、`Ps3Controller` 等）COPY 至 `/root/Arduino/libraries/`，**不使用 `--libraries` 旗標**（原因見下方 Bug 紀錄）。

Docker image 建置時執行暖機編譯，產物存至 `/arduino-ble-seed/`（約 52MB）。

---

## 三、部署架構與步驟

### 3.1 架構總覽

```
瀏覽器 → https://192.168.50.34/ (Nginx port 443)
              │
              ├── /            → WebStation 靜態檔案 (/volume1/web/)
              └── /compile     → proxy_pass http://127.0.0.1:3000/compile
                                  └── Docker container: tubitblock-compiler
                                        port 3000，僅綁定 127.0.0.1（不對外暴露）
```

**重要**：Web Serial API 需要 HTTPS，務必從 `https://192.168.50.34/` 訪問，用 `http://` 無法燒錄。首次瀏覽器會顯示「憑證不受信任」，點「進階 → 繼續前往」即可，一台電腦只需做一次。

---

### 3.2 部署編譯器（Docker）

#### 前置條件

- 目標機器已安裝 Docker（Synology NAS 透過 DSM 套件中心安裝 Container Manager）
- SSH 可連線（Synology NAS 在 DSM → 控制台 → 終端機 啟用 SSH）
- 機器需要至少 4GB RAM（BLE 編譯峰值 ~1.5GB）、約 4GB 磁碟空間（image 含 ESP32 core）

#### Step 1：上傳編譯器原始碼到 NAS

```bash
# 在本機執行（需先安裝 sshpass）
NAS_USER="hruserDongYe"
NAS_IP="192.168.50.34"
NAS_PW="YOUR_PASSWORD"
NAS_DIR="/volume1/docker/tubitblock/compiler-server"

# 建立目錄
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "mkdir -p $NAS_DIR/ble_warmup $NAS_DIR/custom_libraries"

# 逐一上傳檔案（NAS 通常不支援 rsync/scp，改用 SSH stdin pipe）
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "cat > $NAS_DIR/Dockerfile"       < compiler-server/Dockerfile
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "cat > $NAS_DIR/server.js"        < compiler-server/server.js
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "cat > $NAS_DIR/package.json"     < compiler-server/package.json
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "cat > $NAS_DIR/package-lock.json"< compiler-server/package-lock.json

# 上傳暖機 sketch
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "cat > $NAS_DIR/ble_warmup/sketch.ino" < compiler-server/ble_warmup/sketch.ino

# 上傳 custom_libraries（每個子目錄的所有檔案）
# 方法：在本機打包成 tar，透過 SSH stdin 解壓
tar -czf - -C compiler-server/custom_libraries . \
  | sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "tar -xzf - -C $NAS_DIR/custom_libraries"
```

#### Step 2：在 NAS 上建置 Docker image

```bash
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "echo '$NAS_PW' | sudo -S /usr/local/bin/docker build -t tubitblock-compiler $NAS_DIR"
```

> **注意**：這一步會下載 ESP32 core（約 300MB+）並執行暖機編譯（約 10～20 分鐘）。請耐心等待，失敗通常是網路問題，重試即可。

#### Step 3：啟動容器

```bash
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "echo '$NAS_PW' | sudo -S /usr/local/bin/docker run -d \
    --name tubitblock-compiler \
    --restart unless-stopped \
    -p 127.0.0.1:3000:3000 \
    tubitblock-compiler"
```

`-p 127.0.0.1:3000:3000`：port 3000 只對本機 localhost 開放，外部無法直接連線，安全性更好。

#### Step 4：確認容器正常運行

```bash
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "curl -s http://127.0.0.1:3000/"
```

正常回應如下（`concurrency.active` 為目前編譯數，`max` 為上限）：

```json
{
  "service": "tubitblock-compiler-server",
  "status": "running",
  "version": "1.3.0",
  "concurrency": { "active": 0, "queued": 0, "max": 28 }
}
```

---

### 3.3 設定 Nginx 代理（/compile 轉發）

Synology WebStation 使用 Nginx，需要新增一個 location 區塊把 `/compile` 轉發到容器。

#### Step 1：建立代理設定檔

```bash
# 先寫到 /tmp，再 sudo cp（直接 sudo tee 會因 stdin 被 sudo 消耗而失敗）
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "cat > /tmp/tubitblock-compile.conf" << 'EOF'
# TubitBlock compiler proxy — 優先於 WebStation catch-all (location ~ ^)
location ^~ /compile {
    proxy_pass          http://127.0.0.1:3000/compile;
    proxy_read_timeout  180s;
    proxy_connect_timeout 10s;
    proxy_set_header    Host            $http_host;
    proxy_set_header    X-Real-IP       $remote_addr;
    proxy_set_header    X-Forwarded-For $proxy_add_x_forwarded_for;
}
EOF

sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "echo '$NAS_PW' | sudo -S cp /tmp/tubitblock-compile.conf \
   /etc/nginx/conf.d/.location.webstation.conf.tubitblock && \
   sudo -S nginx -s reload"
```

`location ^~ /compile` 使用前綴優先匹配（`^~`），確保比 WebStation 預設的 `location ~ ^`（正規表達式匹配）優先處理，否則 `/compile` 請求會被 WebStation 攔截而不是轉發給編譯器。

#### Step 2：驗證代理生效

```bash
# 應回傳 {"service":"tubitblock-compiler-server",...}
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "curl -sk https://127.0.0.1/compile -X POST \
   -H 'Content-Type: application/json' \
   -d '{\"code\":\"#include <Arduino.h>\nvoid setup(){} void loop(){}\",\"fqbn\":\"esp32:esp32:esp32\"}' \
   | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"success:\", d.get(\"success\"))'"
```

#### ⚠️ 重要：NAS 重啟後代理設定會遺失

Synology DSM 在系統更新或重啟時會重置 `/etc/nginx/conf.d/`。解決方式是把設定備份到 Docker 卷並建立還原腳本：

```bash
# 備份設定到持久路徑
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "cp /etc/nginx/conf.d/.location.webstation.conf.tubitblock \
   /volume1/docker/tubitblock/tubitblock-compile.conf"

# 建立還原腳本
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "cat > /volume1/docker/tubitblock/restore-nginx.sh" << 'EOF'
#!/bin/sh
CONF=/etc/nginx/conf.d/.location.webstation.conf.tubitblock
if [ ! -f "$CONF" ]; then
    cp /volume1/docker/tubitblock/tubitblock-compile.conf "$CONF"
    /usr/bin/nginx -s reload 2>/dev/null || true
    echo "[restore-nginx] Nginx proxy restored."
fi
EOF

sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "chmod +x /volume1/docker/tubitblock/restore-nginx.sh"
```

每次 NAS 重啟後，SSH 進去執行一次：

```bash
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "echo '$NAS_PW' | sudo -S /volume1/docker/tubitblock/restore-nginx.sh"
```

---

### 3.4 部署 Web UI（靜態檔案）

Web UI 是純靜態檔案，直接放到 WebStation 的根目錄即可。

#### Step 1：在 DSM 設定 WebStation 根目錄

1. DSM → 套件中心 → 安裝 **Web Station**
2. Web Station → 虛擬主機 or 一般設定 → 根目錄設為 `/volume1/web`
3. 確認 HTTP/HTTPS 皆啟用（需要 HTTPS 讓 Web Serial 正常）

#### Step 2：上傳 www/ 目錄所有檔案

```bash
# 打包並上傳（注意目標目錄要是 WebStation 根目錄，通常為 /volume1/web）
tar -czf - -C www . \
  | sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "tar -xzf - -C /volume1/web"
```

#### Step 3：驗證

```bash
# 應回傳 index.html 的 <!DOCTYPE html> 開頭
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" "curl -sk https://127.0.0.1/ | head -3"
```

---

### 3.5 更新編譯器（不重建 image）

只修改 `server.js` 邏輯時，不需要重建整個 Docker image（重建約需 10-20 分鐘），可直接注入：

```bash
# 1. 上傳新的 server.js 到 NAS
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "cat > $NAS_DIR/server.js" < compiler-server/server.js

# 2. 複製進正在運行的容器
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "echo '$NAS_PW' | sudo -S /usr/local/bin/docker cp \
   $NAS_DIR/server.js tubitblock-compiler:/app/server.js"

# 3. 重啟容器（幾秒完成）
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "echo '$NAS_PW' | sudo -S /usr/local/bin/docker restart tubitblock-compiler"
```

### 3.6 重建 Docker image（必要時）

以下情況需要完整重建 image：

- 新增或修改 `custom_libraries/` 中的函式庫
- 修改 `Dockerfile`（例如升級 arduino-cli、調整 FQBN）
- 修改 `ble_warmup/sketch.ino`（新增暖機 library）

```bash
# 停止並刪除舊容器與 image
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "echo '$NAS_PW' | sudo -S /usr/local/bin/docker stop tubitblock-compiler && \
   sudo -S /usr/local/bin/docker rm tubitblock-compiler && \
   sudo -S /usr/local/bin/docker rmi tubitblock-compiler"

# 重建（約 10-20 分鐘）
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "echo '$NAS_PW' | sudo -S /usr/local/bin/docker build -t tubitblock-compiler $NAS_DIR"

# 重新啟動
sshpass -p "$NAS_PW" ssh "$NAS_USER@$NAS_IP" \
  "echo '$NAS_PW' | sudo -S /usr/local/bin/docker run -d \
    --name tubitblock-compiler \
    --restart unless-stopped \
    -p 127.0.0.1:3000:3000 \
    tubitblock-compiler"
```

### 3.7 關鍵路徑速查

| 內容 | NAS 路徑 |
| --- | --- |
| Web UI 靜態檔案 | `/volume1/web/` |
| 編譯器原始碼（持久備份） | `/volume1/docker/tubitblock/compiler-server/` |
| Nginx 代理設定（每次重啟後可能消失） | `/etc/nginx/conf.d/.location.webstation.conf.tubitblock` |
| Nginx 代理備份（持久） | `/volume1/docker/tubitblock/tubitblock-compile.conf` |
| Nginx 還原腳本 | `/volume1/docker/tubitblock/restore-nginx.sh` |
| 編譯暖機 seed（在容器內） | `/arduino-ble-seed/`（約 52MB） |
| 編譯暫存目錄（在容器內） | `/tmp/tubitblock-compile/{UUID}/` |

### 舊 NAS（122.117.187.79）
外部 URL：`https://kevinkid-tubit.mooo.com:3001/compile`（路由器 NAT 3001→3000）。
`LinkIntersector.js` 的 `ONLINE_COMPILE_URL` 預設指向此位址，可透過 `window.TUBITBLOCK_COMPILE_SERVER` 在 index.html 覆蓋。

---

## 四、Bug 修復與優化紀錄

### Bug 1：`boot_app0.bin` 缺失導致 ESP32 無法開機
**症狀**：燒錄成功但 ESP32 黑屏無回應。  
**原因**：ESP32 需要 4 個分區才能正常開機，`boot_app0.bin`（`0xE000`）不在 arduino-cli 的 build 輸出目錄，原本程式碼沒有收集到。  
**修復**：`server.js` 加入 `findBootApp0()`，從 ESP32 core 的 `tools/partitions/` 自動定位並注入。

---

### Bug 2：`sketch.ino.merged.bin` 被燒錄到錯誤地址
**症狀**：燒錄流程完成，但板子行為異常。  
**原因**：`collectArtifactsRecursive()` 收集所有 `.bin`，`merged.bin` 是 4 個分區合併的完整映像，被誤當成 application binary 放到 `0x10000`。  
**修復**：收集時過濾掉包含 `merged` 的檔名。

---

### Bug 3：`SerialManager.close()` 後 port 鎖未釋放
**症狀**：第二次燒錄時報 `InvalidStateError: The port is already open`。  
**原因**：`reader.cancel()` 和 `writer.close()` **不會自動 releaseLock()**，必須顯式呼叫，否則 `port.close()` 靜默失敗，port 鎖殘留。  
**修復**：正確釋放順序 `cancel/close → releaseLock() → port.close()`。

---

### Bug 4：`libTuBitCore.a` ABI 不符導致燒錄後崩潰
**症狀**：編譯成功、燒錄成功，但 ESP32 執行時崩潰或無回應。  
**原因**：`TuBitCore/src/esp32/libTuBitCore.a` 是針對 `esp32:esp32@3.1.3` 預編譯的靜態庫，Dockerfile 原本使用 `3.1.1`，ABI 不符（編譯階段不報錯，執行時崩潰）。  
**修復**：Dockerfile 改為安裝 `esp32:esp32@3.1.3`，並重建 Docker image。

---

### Bug 5：BLE 編譯 Seed Build 失效退化回 90s
**症狀**：BLE 編譯從 ~30s 退化回 ~90s（log 中出現大量「Compiling library...」）。  
**原因**：arduino-cli 用 `build.options.json` 判斷 `.o` 快取是否有效。若 Dockerfile 暖機指令加了 `--libraries` 旗標，會在 `build.options.json` 的 `otherLibrariesFolders` 欄位寫入明確路徑，與學生編譯（不加 `--libraries`，使用預設目錄）產生差異，導致所有 `.o` 全部重編。  
**修復**：Dockerfile 暖機指令移除 `--libraries`，custom libraries 放在 arduino-cli 預設目錄 `/root/Arduino/libraries/`。

---

### Bug 6：`navigator.clipboard` 在 HTTP 環境下 undefined 導致 GUI 白屏
**症狀**：從 `http://` 訪問時，console 報 `TypeError: Cannot set properties of undefined (setting 'readText')`，積木編輯器完全空白。  
**原因**：`ScratchDesktopGUIHOC.jsx:componentDidMount` 直接對 `navigator.clipboard.readText` 賦值，而 HTTP 環境下 `navigator.clipboard` 為 `undefined`，組件初始化崩潰，導致整個 React 樹失敗。  
**修復**：在 `electron-shim.js` 最早期（GUI bundle 執行前）用 `Object.defineProperty` 補上 `navigator.clipboard` polyfill。必須同時遞增 `index.html` 的 `?v=N` cache busting 版本號，否則瀏覽器繼續使用舊快取。

---

### Bug 7：`.tb` 專案檔在桌面版無法開啟（assetId 格式錯誤）
**症狀**：Web 版可以讀取 `.tb` 專案，桌面版 TubitBlockApp 報「無效專案」錯誤。  
**原因**：SB3 schema 要求 costume 的 `assetId` 必須是 32 位 hex MD5（`/^[a-f0-9]{32}$/`）。原本 `electron-shim.js` 的預設專案用 `'BitTu'` 作為 assetId，桌面版嚴格驗證不通過。  
**修復**：
1. `electron-shim.js` 預設專案改為 `assetId: '732e5c641367f9185529fcd5fe13f801'`（BitTu.png 的真實 MD5）
2. 新增 `www/static/assets/732e5c641367f9185529fcd5fe13f801.png`（BitTu.png 的複製）
3. 所有現有 `.tb` 範例專案重新打包，修正 `project.json` 內的 assetId

---

### Bug 8：`copySeedBuild` 使用 `execSync` 阻塞 event loop
**症狀**：多個學生同時觸發編譯時，前幾個請求的 seed 複製（22ms）會串行執行，後進者等待時間疊加。  
**修復**：改為 `async/await exec`，Node.js event loop 在等待 `cp -a` 時可繼續處理其他請求。

---

### 優化：BLE linker 速度（已確認無法進一步改善）
ESP32 BLE linker（`xtensa-esp-elf-ld`）是單執行緒 CPU-bound，需掃描 3.1GB archive 檔案。
- OS page cache 暖機（預讀 `.a` 檔）：**無效**（2s 完成但編譯速度不變，linker 是 CPU-bound 非 I/O-bound）
- `arduino-cli --jobs N`：**無效**（linker 不是多執行緒的，`--jobs` 只影響編譯階段）
- Seed Build `.o` 重用：**有效**，library 不重編，非 BLE 程式 ~7s，BLE 程式 ~30-55s

---

## 五、已知限制與待處理事項

| 項目 | 說明 |
|------|------|
| HTTPS 必要 | Web Serial API 需要 HTTPS，從 HTTP IP 訪問時 `navigator.serial` 為 undefined，無法燒錄 |
| NAS Nginx 設定重啟後遺失 | Synology 更新或重啟後 `/etc/nginx/conf.d/.location.webstation.conf.tubitblock` 可能被覆蓋，需執行 `restore-nginx.sh` |
| Docker image 更新需重建 | `docker cp` 可臨時注入 server.js，但重建 image 後才是永久生效 |
| BLE 編譯 ~30-55s | xtensa linker 的硬性限制，目前無法突破（除非改用 NimBLE 重寫 V7RC_BT）|
| esptool-js CDN 依賴 | `Esp32WebFlasher.js` 依賴 `https://unpkg.com/esptool-js@0.5.7/bundle.js`，離線環境需本地化 |
| pako CDN 依賴 | `index.html` 載入 `https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js`，離線環境需本地化 |

---

## 六、開發常用指令

```bash
# 本地測試 Web UI
python3 -m http.server 8080 --directory www/
# 開啟 http://localhost:8080/index.html （localhost 支援 Web Serial）

# 本地編譯伺服器
cd compiler-server && npm install && node server.js

# 上傳檔案到 NAS Web UI
sshpass -p 'PASSWORD' ssh USER@192.168.50.34 "cat > /volume1/web/FILENAME" < ./local/FILENAME

# 上傳 server.js 並熱更新（不重建 image）
sshpass -p 'PASSWORD' ssh USER@192.168.50.34 "cat > /volume1/docker/tubitblock/compiler-server/server.js" < ./compiler-server/server.js
sshpass -p 'PASSWORD' ssh USER@192.168.50.34 "sudo /usr/local/bin/docker cp /volume1/docker/tubitblock/compiler-server/server.js tubitblock-compiler:/app/server.js"
sshpass -p 'PASSWORD' ssh USER@192.168.50.34 "sudo /usr/local/bin/docker restart tubitblock-compiler"

# 重建 Docker image（變更 Dockerfile / 新增 library 時需要）
sshpass -p 'PASSWORD' ssh USER@192.168.50.34 "sudo /usr/local/bin/docker stop tubitblock-compiler && sudo /usr/local/bin/docker rm tubitblock-compiler"
sshpass -p 'PASSWORD' ssh USER@192.168.50.34 "sudo /usr/local/bin/docker build -t tubitblock-compiler /volume1/docker/tubitblock/compiler-server/"
sshpass -p 'PASSWORD' ssh USER@192.168.50.34 "sudo /usr/local/bin/docker run -d --name tubitblock-compiler --restart unless-stopped -p 127.0.0.1:3000:3000 tubitblock-compiler"
```

---

## 七、版本環境

| 元件 | 版本 |
|------|------|
| Node.js | 20 (slim) |
| arduino-cli | 0.35.3 |
| ESP32 core | **3.1.3**（固定，勿升級） |
| Arduino AVR core | 1.8.6 |
| esptool-js | 0.5.7 |
| pako | 2.1.0 |
| electron-shim.js | v13（index.html cache busting 版號） |
| compiler-server | v1.3.0 |
