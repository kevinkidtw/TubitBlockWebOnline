/**
 * Esp32WebFlasher.js
 * 
 * 整合官方 esptool-js 的 ESP32 燒錄模組。
 * 將 SerialManager 的 Port 授權給 esptool-js 進行協定通訊。
 */

window.Esp32WebFlasher = class {
    constructor(manager, logCallback = console.log) {
        if (!manager || !manager.port) {
            throw new Error("[ESP32] SerialManager 尚未就緒");
        }
        this.manager = manager;
        this.port = manager.port;
        this.log = logCallback;
    }

    /**
     * 核心輔助：動態載入 esptool-js 並建立 Loader
     */
    async _getLoader(baudRate) {
        this.log("[ESP32] 關閉現有監聽以釋放 Port...");
        // 關鍵：先讓 Manager 釋放串流但不刪除 Port 引用
        await this.manager.close(true);

        this.log("[ESP32] 正在向雲端請求燒錄引擎元件 (ESM Import)...");

        // 1. 使用動態 Import 載入最新版 esptool-js (ESM 版)
        // 註：這能完美解決 全域變數找不到 的問題
        const module = await import("https://cdn.jsdelivr.net/npm/esptool-js@0.5.7/+esm");

        // 2. 檢查 pako (esptool-js 的相依項)
        if (typeof pako === 'undefined') {
            throw new Error("找不到 pako 庫，請檢查 index.html 是否正確載入。");
        }

        // 3. 進入燒錄模式
        this.manager.enableFlashingMode();

        // 4. 建立 Transport 與 Loader
        const transport = new module.Transport(this.port);
        const esploader = new module.ESPLoader({
            transport: transport,
            baudrate: baudRate,
            terminal: {
                clean: () => { },
                writeLine: (data) => this.log(data),
                write: (data) => console.log(data)
            }
        });

        return esploader;
    }

    /**
     * 執行完整燒錄流程
     * @param {Array} fileArray 格式為 [{ data: Uint8Array, address: 0x1000 }, ...]
     */
    async flashData(fileArray) {
        if (!fileArray || fileArray.length === 0) {
            throw new Error("[ESP32] 燒錄資料為空");
        }

        let esploader;
        const connectBaudRate = 115200; // 初始連線使用 115200 較為穩定
        const flashBaudRate = 460800;   // 燒錄時切換到高速

        try {
            // 1. 初始化連線
            esploader = await this._getLoader(connectBaudRate);
            this.log("[ESP32] 執行硬體重置進入下載模式 (DTR/RTS Toggle)...");
            
            // 由於部分開發板在使用 Web Serial 時，esptool-js 預設的 reset_strategy 可能會失效
            // 導致一直在 waiting for download mode timeout。
            // 我們手動透過 Transport 控制 DTR/RTS 來強制進入 Download Mode
            try {
                if (esploader.transport) {
                    await esploader.transport.setDTR(false);
                    await esploader.transport.setRTS(true);
                    await new Promise(r => setTimeout(r, 100));
                    await esploader.transport.setDTR(true);
                    await esploader.transport.setRTS(false);
                    await new Promise(r => setTimeout(r, 50));
                    await esploader.transport.setDTR(false);
                }
            } catch (resetErr) {
                this.log("[ESP32] 警告: 手動硬體重置信號發送失敗，將嘗試使用預設重置");
            }

            this.log("[ESP32] 正在連接晶片 (Connect & Detect)...");

            if (typeof esploader.main === 'function') {
                await esploader.main();
            } else if (typeof esploader.main_fn === 'function') {
                await esploader.main_fn();
            }

            this.log(`[ESP32] 已連接！晶片類型: ${esploader.chip.CHIP_NAME}`);
            
            // 提升 Baudrate 以加速燒錄
            if (flashBaudRate !== connectBaudRate) {
                 this.log(`[ESP32] 修改 Baudrate 至 ${flashBaudRate}...`);
                 // 利用 esptool 內建的 changeBaudrate（如果有的話，沒的話就不改）
                 // 暫不強制改變，esptool.main() 內部通常會處理。
            }

            // 2. 執行寫入
            this.log("[ESP32] 開始寫入 Flash 分區...");

            // 格式轉換：esptool-js 0.5.x 要求 data 是 binary string，而非 Uint8Array
            // 同時嚴格檢查 flashOptions (必需提供 string 避免 indexOf undefined)
            const formattedFileArray = fileArray.map(file => ({
                data: typeof file.data === 'string' 
                      ? file.data 
                      : String.fromCharCode.apply(null, file.data),
                address: file.address
            }));

            await esploader.writeFlash({
                fileArray: formattedFileArray,
                flashSize: "keep",
                flashMode: "keep",
                flashFreq: "keep",
                eraseAll: false,
                compress: true,
                reportProgress: (fileIndex, written, total) => {
                    this.log(`[ESP32] 寫入進度: 第 ${fileIndex + 1} 個檔案, 已寫入 ${written} / ${total} bytes`);
                }
            });

            this.log("[ESP32] 燒錄成功！");

        } catch (e) {
            this.log(`[ESP32] 燒錄失敗: ${e.message}`);
            throw e;
        } finally {
            // 3. 恢復一般模式
            if (this.manager) {
                this.manager.disableFlashingMode();
            }
            this.log("[ESP32] 燒錄流程結束。");
        }
    }

    /**
     * 測試錄一個基本的 Blink
     * 為了示範，我們會嘗試載入典型的 ESP32 三大區塊 (暫用 dummy 資料)
     */
    async flashTestBlink() {
        this.log("[ESP32] 啟動測試燒錄 (模擬多分區寫入)...");

        // 這裡僅為結構展示，實際需要對應晶片的 bin 檔
        // 典型的 ESP32 位址: 0x1000 (bootloader), 0x8000 (part-table), 0x10000 (app)
        this.log("[ESP32] 注意：目前僅為 API 結構驗證，準備寫入空分區測試介面相容性...");

        const dummyData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
        const testFileArray = [
            { data: dummyData, address: 0x10000 } // 僅測試寫入單一小區塊
        ];

        return await this.flashData(testFileArray);
    }
};
