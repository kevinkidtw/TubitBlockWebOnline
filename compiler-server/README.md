# TubitBlockWebOnline 雲端編譯器與燒錄系統

此專案是基於 TubitBlock 開放原始碼進行重構，加入了「瀏覽器線上編譯」與「Web Serial 直接燒錄」的功能，讓使用者無需額外安裝 `tubitblock-link`，只要打開網頁就能完成 ESP32/Arduino 的開發與燒錄。

## 架構說明

專案分為兩個主要部分：
1. **Frontend (Web GUI)**: 位於 `www/` 目錄。修改了 `www/web-flasher/LinkIntersector.js`，實作了攔截編譯與快取燒錄二進位檔的邏輯。
2. **Backend (Compiler Server)**: 位於 `compiler-server/` 目錄。提供一個獨立的 Node.js 編譯 API。

### 使用流程 (5-Phase 重構)
相較於原始架構，我們完成了以下五階段重構：
- **Phase 1**: 在前端 GUI 注入「編譯 (線上)」按鈕。
- **Phase 2**: 打造了獨立的 `compiler-server`，處理 `arduino-cli` 的編譯請求，並使用 UUID 暫存資料夾隔離併發連線。
- **Phase 3**: 前端連接伺服器，並解決了前端編輯器 (Ace Editor) 挾帶「不換行空白 (NBSP, `\xA0`)」導致 C++ 編譯失敗的問題。
- **Phase 4**: 實作了「快取機制」。當使用者點擊「上傳」時，如果程式碼沒有更動，系統會直接拿剛剛編譯好的 `.bin` 檔案進行 Web Serial 燒錄，省去重複編譯的時間。
- **Phase 5**: 最佳化錯誤處理，透過串接 `arduino-cli` 的 `stdout` 與 `stderr`，讓編譯錯誤可以顯示在介面上；並支援 Docker 與區域網路雙模式佈署。

## 編譯伺服器部署方式 (Compiler Server Deployment)

伺服器程式碼位於 `compiler-server/`。目前支援兩種主要部署方式：

### 方案 A：區域網路 / 本機佈署 (推薦用於相同 Wi-Fi 的教室環境)

如果您有一台電腦（Mac/Windows/Linux/NAS）作為主要伺服器，且學生裝置都在同一個區域網路下。
此方式編譯速度最快，因為直接使用電腦本機的 CPU 與記憶體（ESP32 編譯峰值需約 1GB RAM）。

1. 確保本機已安裝 Node.js 與 `arduino-cli` (且已安裝對應核心版，如 `esp32:esp32` 或 `arduino:avr`)。
2. 在 `compiler-server/` 下執行：
   ```bash
   npm install
   ```
3. 啟動伺服器：
   ```bash
   node server.js
   ```
   伺服器預設運行在 Port `3000`。
4. **修改前端指向**：開啟 `www/web-flasher/LinkIntersector.js`，將 `COMPILE_SERVER_URL` 指向您的伺服器 IP (例如 `http://192.168.1.104:3000/compile`)。

### 方案 B：Docker / 雲端佈署 (適用於完全開放在網際網路)

我們準備了完整的 `Dockerfile`，內建了 `arduino-cli` 與 ESP32 / Arduino AVR 核心版。
**注意**：請確保您的雲端伺服器 (如 AWS, GCP, Synology NAS) 至少有 **1GB 以上的 RAM**。若使用 Render 免費方案 (512MB RAM)，會在編譯 ESP32 時發生 OOM (Out-of-Memory) 錯誤導致編譯失敗。

1. 建置 Docker 映像檔（初次建置約需數分鐘，會下載 300MB 的 ESP32 核心）：
   ```bash
   cd compiler-server
   docker build -t tubitblock-compiler .
   ```
2. 啟動 Docker 容器：
   ```bash
   docker run -p 3000:3000 tubitblock-compiler
   ```
3. 修改前端 `LinkIntersector.js`，將 `COMPILE_SERVER_URL` 指向您對外的網域。

## API 端點 (API Endpoints)

### `GET /` (Health Check)
回傳伺服器狀態與安裝的核心板資訊，適合用來診斷 `arduino-cli` 是否正常運作。

### `POST /compile`
接收前端程式碼並回傳編譯好的二進位檔。支援兩種請求格式：

**Request Body (Format A):**
```json
{
  "code": "void setup() {} void loop() {}",
  "board": "esp32:esp32:esp32",
  "libraries": "Adafruit_NeoPixel" 
}
```

**Response (Success):**
```json
{
  "success": true,
  "buildId": "uuid...",
  "artifacts": {
    "sketch.ino.bin": "Base64字串...",
    "sketch.ino.elf": "Base64字串..."
  }
}
```

**Response (Error):**
遇到語法錯誤或記憶體耗盡時，會回傳 400，並於 `error` 欄位夾帶完整的 `arduino-cli` 輸出，方便前端呈現給使用者。

## 授權與貢獻
本專案為分支重構版本，遵循原 TubitBlock 開源授權。
