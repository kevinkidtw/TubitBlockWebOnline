# TUbitBlock 開放原始碼積木程式教育平臺

TUbitBlock 是一個專為各級學校資訊教育設計的進階視覺化積木程式開發環境。本系統支援 TU:bit、ESP32、Arduino 等多種開源硬體，能有效解決傳統開發環境安裝繁瑣、版控困難以及跨平台不相容的問題，非常適合應用於 108 課綱下的物聯網與運算思維課程。

## 💡 系統架構簡介

為符合校園情境中「**隨開即用、集中管理**」的核心需求，又能保留**實體硬體燒錄**的底層控制力，系統採前後端分離架構設計：

1. **雲端/區域網路前端 (TUbitBlock Web)**：
   - 負責所有積木邏輯、視覺化編輯器與流程控制。
   - 支援將靜態檔案部署於校內伺服器或免費的 GitHub Pages。這讓學生僅需透過瀏覽器即可進行開發，實現真正的零客戶端安裝 (Zero-install Client)。
2. **本機硬體連線代理 (TUbitBlock Link)**：
   - 為一支常駐於學生端電腦（或廣播派送映像檔中）的輕量級 Node.js 服務 (`tubitblock-link`)。
   - 負責接收前端的 WebSocket 編譯請求、呼叫本機 C++ 工具鏈進行編譯，並過渡至 USB 序列埠完成燒錄程序。這解決了現代瀏覽器基於 WebUSB 安全限制無法直通編譯的問題。

---

## 🚀 快速開始：終端安裝與使用流程

為減輕資訊組長或任課教師在電腦教室的環境派送負擔，本專案提供具備「環境偵測與自動修復」能力的一鍵啟動腳本。以下為標準的上課流程：

### 第一步：取得並啟動本機連線代理服務 (TUbitBlock Link)

該腳本支援透過網管軟體批次派送，它會自動偵測系統環境、安裝 Node.js (若缺乏)，並按需下載跨平臺的 ESP32/Arduino 工具鏈。

1. 請依照作業系統，透過指令或瀏覽器下載專用的啟動腳本：
   - **Windows 教室**：[start_link.bat (Raw 連結)](https://raw.githubusercontent.com/kevinkidtw/TubitBlockWeb/main/start_link.bat) (建議放置於桌面或加入開機啟動)
   - **Mac/Linux 教室**：[start_link.sh (Raw 連結)](https://raw.githubusercontent.com/kevinkidtw/TubitBlockWeb/main/start_link.sh)
2. （僅 macOS / Linux 需要）賦予執行權限：`chmod +x start_link.sh`。
3. 執行該腳本：
   - Windows 點兩下執行 `start_link.bat`；Mac/Linux 執行 `./start_link.sh`。
4. 服務成功掛載後，命令列視窗將於背景維持 WebSocket Listen (`ws://127.0.0.1:20111`) 狀態。此視窗可最小化，為確保硬體通訊正常，上課期間**請勿強制終止該進程**。

> *(注意：若您的環境為**首次**被腳本安裝 Node.js，安裝完成後系統可能需重新載入環境變數 (`PATH`)，此時請關閉該終端機視窗並重新執行一次腳本。)*

### 第二步：開啟網頁版積木編譯器

請學生透過瀏覽器（建議使用 Chrome / Edge）連線至學校統一佈署的前端網址：

- **示範網址**：`https://<校名>.github.io/TubitBlockWeb/www/index.html` 或 `http://<校內伺服器IP>/www/index.html`

### 第三步：(首次使用必做) 安裝硬體 USB 驅動程式

大多數的 ESP32 與 TU:bit 開發板皆使用 **CH340/CH341** USB 轉串口晶片。若電腦未安裝對應驅動，將無法透過 USB 連線燒錄程式：

- **Windows 環境**：請點擊網頁右上角的「**齒輪（設定）**」圖示，選擇「**安裝驅動**」，系統將一鍵下載官方 `CH341SER.EXE`。執行安裝後請重新啟動電腦。
- **macOS 12+ / Linux**：系統核心已內建驅動，**無需額外安裝**。
- **macOS 11 以下**：請手動下載 [macOS 版驅動](https://www.wch-ic.com/downloads/CH341SER_MAC_ZIP.html)並安裝。

> ⚠️ **提醒給資訊老師**：強烈建議於學期初，統一在 Windows 電腦教室的母碟映像檔 (Image) 中預先安裝好 CH341 驅動，以免學生上課時才發現無法連線。

### 第四步：連線實體設備並開始編程

1. 使用傳輸線將開發板連接至電腦的 USB 埠。
2. 在網頁左下角點擊「**增加設備**」並選擇您的開發板。
3. 前端會透過 WebSocket 與您剛才啟動的 `TUbitBlock Link` 服務握手，畫面右上角若顯示連線成功，即可開始拖曳積木進行教學與燒錄！

---

## 👨‍🏫 資訊教師與伺服器管理員進階指南

如果您是學校的系統管理員，規劃為全校建置統一的存取入口或加入自訂感測器：

### 方案 A：將網頁介面免費部署至 GitHub Pages (推薦)

這項方案能大幅節省校內伺服器的建置與維護成本，並具備優異的 CDN 連線速度。

1. 以學校科室或個人帳號將本 GitHub 專案 **Fork**。
2. 確認專案根目錄下存在 `.nojekyll` 隱藏檔（此設定可防止 GitHub Pages 忽略底層的系統資料夾）。
3. 進入 GitHub 專案的 **Settings** -> 左側選單 **Pages**。
4. 於 **Build and deployment** 設定區將 Source 設為 `Deploy from a branch`；Branch 選擇 `main` 與 `/ (root)` 後儲存。
5. 部署完成後，將生成的靜態網址掛載於校網或數位學習平台即可供全校使用。

### 方案 B：自行架設區域網路伺服器

對於需受控於純學術網路內、或無對外網路的電腦教室：

1. 於伺服器 (如 Ubuntu) 安裝必備套件：`sudo apt-get install python3 git -y`
2. 拉取專案至伺服器 `/var/www`：`git clone https://github.com/kevinkidtw/TubitBlockWeb.git`
3. 啟動 Web 伺服器 (示範使用 Python, 企業級建議配 Nginx)：`nohup python3 -m http.server 8080 -d ./TubitBlockWeb > server.log 2>&1 &`
4. 網址即為 `http://<內部伺服器IP>:8080/www/index.html`。

### 方案 C：離線手動配置 Link 服務 (取代一鍵腳本)

若校安網路防火牆阻擋了一鍵腳本的包下載，可採取離線配置：

1. 自行部署 Node.js (LTS 版本) 至所有終端機。
2. 下載本專案 `.zip` 壓縮包並解壓至統一終端路徑（如 `C:\TUbitBlock\`）。
3. 開啟終端機切換至 `tubitblock-link` 目錄，手動執行 `npm install` 接著執行 `npm start`。

### 🛠 如何新增客製化硬體設備與感測器？

TUbitBlock 允許任課教師因應特定專題，無縫擴充第三方感測器支援：

1. **註冊設備定義**：於 `external-resources/devices/zh-tw.json` 中配置設備名稱與描述。
2. **擴充積木介面**：於 `external-resources/extensions/` 建立套件專屬目錄，撰寫 `toolbox.js` (分類抽屜)、`blocks.js` (積木型態) 以及 `generator.js` (C/C++ 轉換邏輯)。
3. **整合 Arduino Library (關鍵)**：若使用了第三方硬體函式庫（例如 Adafruit），必須將該 Library 資料夾放入 `tubitblock-link/tools/Arduino/libraries/` 目錄中，後端編譯器才能正確解析標頭檔。

---

## 📝 版本更新紀錄 (Changelog)

### v0.97 (當前版本)

- **網頁端驅動一鍵下載**：大幅優化「安裝驅動」之引導流程。使用者直接從網頁 GUI 的齒輪選單點擊「安裝驅動」時，系統會智慧攔截底層 IPC 訊號，並穿透瀏覽器彈窗封鎖限制，直接啟動官方 `CH341SER.EXE` 下載。
- **介面深度淨化**：徹底移除了網頁版不必要的動態生成的設定選單（如許可証、隱私政策、數據設置），並具備繁簡體自動相容能力，為後續教育現場打造更專注的教學介面。

### v0.95

- **客製化品牌識別**：透過前端 DOM 攔截技術動態置換網頁版標誌，並支援透過 `logo.png` 輕鬆自訂專屬圖示 (預設顯示 75% 高度比例)。
- **專屬預設角色**：攔截專案初始化 API，開啟新專案時會如 Scratch 貓咪般自動載入「BitTu」專屬角色，並調整為合適大小。
- **專案副檔名變更**：動態覆寫瀏覽器下載行為，將儲存專案時的預設副檔名由原本的 `.ob` / `.sb3` 變更為 `.tb` 檔。

### v0.91

- **修復 Windows 中文路徑編譯失敗 (Error 123)**：將 `tubitblock-link` 安裝至全 ASCII 路徑 (`C:\TubitBlockWeb`)，徹底繞過 ESP32 編譯器的中文路徑解析 Bug。
- **改進環境變數邏輯**：覆寫 `TMP`/`TEMP` 至公用或短路經目錄，確保暫存區可正確讀寫並避開特殊字元。
- **補齊編譯工具鏈**：新增自動下載 Windows 版 `ctags.exe`，解決原型生成失敗的問題。
- **支援 Apple Silicon**：Mac 版腳本新增自動偵測並安裝 Rosetta 2，確保 x86_64 架構工具在 ARM64 處理器上順利執行。
- **新增驅動文件**：於 README 加入 CH341SER USB 驅動詳細安裝指引。

### v0.85

- **動態首字 SVG 圖示**：透過前端 DOM 攔截技術即時分析標籤，將主畫面左側「分類選單」的預設圖示替換為帶有分類中文首字 (如：多、機、馬、按) 的高畫質 SVG 動態色彩圓標，大幅減少圖片空間，視覺更一致。
- **擴充功能庫真實影像保留**：精確控制 DOM 攔截範圍，於「選擇擴充功能」彈出視窗保留硬體原廠之寫實照片，在保持左側選單視覺統一的同時，依舊提供清晰的硬體辨識度。

### v0.82

- **智慧部署腳本**：`start_link` 腳本全面升級，支援 Mac/Win/Linux，具備硬體架構感知能力，並能根據系統動態下載所需 ESP32 編譯元件。解決跨平臺相容性異常。
- **儲存庫巨幅精簡**：移除高達 3.7GB 冗餘靜態檔案與日誌，Git 儲存庫體積下降逾 60%，提升校安代理伺服器與終端機同步效率。
- **TUbitBlock 核心重構**：完成歷史 `openblock` 變數與底層通訊協定全面更名（含 `tubitblock-link` 與 `.tubitblockData`），並透過 `electron-shim.js` 動態修補前端 DOM。
- **本地伺服器整合與路由防護**：一鍵腳本同步掛載 HTTP 靜態服務 (Port 8080) 與 WebSocket (Port 20111)。建置全域 URL 攔截機制，將所有失效的舊版維基連結強制導回 `trgreat.com/tu-wiki/`。
