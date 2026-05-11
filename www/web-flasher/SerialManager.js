/**
 * SerialManager.js
 * 
 * 負責統籌 Web Serial API 的基礎連線與資料流讀取。
 * 當連線開啟後，會啟動一個背景的讀迴圈 (_readLoop) 不斷將硬體
 * 傳來的資料寫入 Shared Buffer (window._stk500_rxBuffer)，以防止
 * 瀏覽器 Web Serial Reader 發生被阻塞或取消時的拋錯關閉。
 */

window.SerialManager = class {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isOpen = false;

        // 全域分享的接收緩衝區，給各個燒錄器（例如 STK500Flasher）存取
        window._stk500_rxBuffer = [];

        // 外部監聯器 (例如一般通訊模式下，把資料拋給 UI 或 Firmata)
        this.onDataReceived = null;

        // USB 裝置拔除時的外部通知 callback
        this.onDisconnected = null;

        // 標記是否為「燒錄攔截模式」。如果是 true，背景迴圈就把資料丟進 _stk500_rxBuffer
        this.isFlashingMode = false;

        // 防止 _handleDisconnect 和 _readLoop finally 的競態條件
        this._disconnecting = false;

        // 記錄上次使用的 baudRate，方便重連時使用
        this._lastBaudRate = 115200;

        // 監聽 USB 裝置拔除事件
        if (navigator.serial) {
            navigator.serial.addEventListener('disconnect', (e) => {
                // 注意：disconnect 事件的 target 是 SerialPort 物件
                if (this.port && e.target === this.port) {
                    console.warn('[SerialManager] ⚠️ USB 裝置已拔除，自動清理連線狀態');
                    this._handleDisconnect();
                }
            });
        }
    }

    /**
     * 請求使用者選擇 Serial Port
     * 注意：此方法必須在 User Gesture (使用者點擊) 的 call stack 內呼叫
     */
    async requestPort() {
        try {
            this.port = await navigator.serial.requestPort();
            return this.port;
        } catch (e) {
            console.error("[SerialManager] 使用者取消或選擇失敗", e);
            throw e;
        }
    }

    /**
     * 開啟 Serial Port 並啟動背景讀取迴圈
     * @param {number} baudRate 波特率 (Arduino Uno Optiboot 預設 115200)
     */
    async open(baudRate = 115200) {
        if (!this.port) {
            throw new Error("[SerialManager] 尚未選擇 Port，請先呼叫 requestPort()");
        }

        // 如果 port 已經開啟（readable 存在），先嘗試關閉再重開
        if (this.port.readable || this.port.writable) {
            console.warn('[SerialManager] Port 似乎已開啟，先關閉再重開...');
            await this.close();
            await new Promise(r => setTimeout(r, 100));
        }

        try {
            await this.port.open({ baudRate: baudRate });
            this.isOpen = true;
            this._disconnecting = false;
            this._lastBaudRate = baudRate;
            this.writer = this.port.writable.getWriter();

            // 啟動背景迴圈
            this._startReadLoop();

            console.log(`[SerialManager] Port 已開啟 (${baudRate} baud)`);
        } catch (e) {
            // 如果 open 失敗，檢查是否是因為 port 已失效
            if (e.name === 'InvalidStateError' || e.name === 'NetworkError') {
                console.warn('[SerialManager] Port 已失效（可能已拔除），嘗試重新取得...');
                this.port = null;
                this.isOpen = false;
            }
            console.error("[SerialManager] 開啟 Port 失敗", e);
            throw e;
        }
    }

    /**
     * 關閉 Serial Port
     * @param {boolean} shouldKeepPort 是否保留 Port 物件引用供外部(如 esptool-js)使用
     *
     * 重要：Web Serial API 規範要求在呼叫 port.close() 之前，
     * 所有 readable/writable stream 的鎖都必須被釋放。
     * reader.cancel() 只是取消讀取，並不會自動釋放鎖，
     * 必須額外呼叫 reader.releaseLock() 才能讓 port.close() 成功。
     */
    async close(shouldKeepPort = false) {
        if (!this.isOpen && !this.reader && !this.writer) return;

        this.isOpen = false;
        this.isFlashingMode = false;

        // Step 1: 取消 reader 並釋放鎖（兩步缺一不可）
        if (this.reader) {
            try { await this.reader.cancel(); } catch (e) { /* 已取消或已關閉，忽略 */ }
            try { this.reader.releaseLock(); } catch (e) { /* 已釋放，忽略 */ }
            this.reader = null;
        }

        // Step 2: 關閉 writer 並釋放鎖
        if (this.writer) {
            try { await this.writer.close(); } catch (e) { /* 已關閉，忽略 */ }
            try { this.writer.releaseLock(); } catch (e) { /* 已釋放，忽略 */ }
            this.writer = null;
        }

        // Step 3: 等一個 tick，讓 _startReadLoop 的 finally 有機會完成
        await new Promise(r => setTimeout(r, 50));

        // Step 4: 關閉 Port（此時所有 stream 鎖均已釋放，port.close() 才能成功）
        if (this.port) {
            try {
                await this.port.close();
                console.log("[SerialManager] Port 已安全關閉");
            } catch (e) {
                console.warn("[SerialManager] 關閉 Port 時發生錯誤:", e);
            }
        }

        if (!shouldKeepPort) {
            this.port = null;
        }
    }

    /**
     * 開啟燒錄攔截模式
     */
    enableFlashingMode() {
        this.isFlashingMode = true;
        window._stk500_rxBuffer = []; // 清空之前的殘留
        console.log("[SerialManager] 已進入燒錄攔截模式 (Hook Enabled)");
    }

    /**
     * 關閉燒錄攔截模式
     */
    disableFlashingMode() {
        this.isFlashingMode = false;
        console.log("[SerialManager] 已解除燒錄攔截模式 (Hook Disabled)");
    }

    /**
     * 寫入 Byte Array 給硬體
     * @param {Array|Uint8Array} bytes 
     */
    async write(bytes) {
        if (!this.writer) throw new Error("Writer 尚未就緒");
        const data = new Uint8Array(bytes);
        await this.writer.write(data);
    }

    /**
     * 重新連線：自動清理舊狀態並嘗試取得已授權的 Port。
     * 
     * 核心優勢：使用 navigator.serial.getPorts() 取得之前已授權的 port，
     * 這個 API **不需要 User Gesture**，解決了 requestPort() 必須在
     * 使用者點擊 call stack 中呼叫的限制。
     * 
     * @param {number} baudRate 波特率
     * @returns {boolean} 是否成功重連。false 表示需要 requestPort()（User Gesture）
     */
    async reconnect(baudRate = 115200) {
        console.log('[SerialManager] 開始重連流程...');

        // === Step 1: 徹底清理舊的連線狀態 ===
        this.isOpen = false;
        this.isFlashingMode = false;
        this._disconnecting = false;

        // 清理 reader
        if (this.reader) {
            try { await this.reader.cancel(); } catch (e) { /* 忽略 */ }
            try { this.reader.releaseLock(); } catch (e) { /* 忽略 */ }
            this.reader = null;
        }

        // 清理 writer
        if (this.writer) {
            try { await this.writer.close(); } catch (e) { /* 忽略 */ }
            try { this.writer.releaseLock(); } catch (e) { /* 忽略 */ }
            this.writer = null;
        }

        // 嘗試關閉舊 port（可能失敗 → 已拔除，忽略）
        if (this.port) {
            try { await this.port.close(); } catch (e) { /* 忽略 */ }
            this.port = null;
        }

        // 等待 OS 層級的 USB 重新枚舉完成
        await new Promise(r => setTimeout(r, 200));

        // === Step 2: 嘗試用 getPorts() 自動取得已授權的 port ===
        try {
            const ports = await navigator.serial.getPorts();
            console.log(`[SerialManager] getPorts() 找到 ${ports.length} 個已授權的 port`);

            if (ports.length > 0) {
                // 取最後一個（通常是最新插入的裝置）
                this.port = ports[ports.length - 1];

                // 嘗試開啟
                try {
                    await this.open(baudRate);
                    console.log('[SerialManager] ✅ 自動重連成功！');
                    return true;
                } catch (openErr) {
                    console.warn('[SerialManager] 自動開啟最新 port 失敗，嘗試其他 port...', openErr);
                    this.port = null;

                    // 如果有多個 port，逐一嘗試
                    for (let i = ports.length - 2; i >= 0; i--) {
                        this.port = ports[i];
                        try {
                            await this.open(baudRate);
                            console.log(`[SerialManager] ✅ 使用 port[${i}] 重連成功！`);
                            return true;
                        } catch (e) {
                            console.warn(`[SerialManager] port[${i}] 也無法開啟`, e);
                            this.port = null;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[SerialManager] getPorts() 呼叫失敗:', e);
        }

        console.log('[SerialManager] 自動重連失敗，需要使用者手動選擇 port (requestPort)');
        return false;
    }

    /**
     * USB 裝置物理拔除時的清理處理
     * Port 已斷開，不需要（也無法）正常 close，直接清理狀態即可。
     */
    _handleDisconnect() {
        // 防止重複進入（與 _readLoop finally 的競態）
        if (this._disconnecting) return;
        this._disconnecting = true;

        this.isOpen = false;
        this.isFlashingMode = false;

        // reader/writer 直接丟棄（port 已物理斷開，cancel/close 會失敗）
        if (this.reader) {
            try { this.reader.releaseLock(); } catch (e) { /* 已斷開，忽略 */ }
            this.reader = null;
        }
        if (this.writer) {
            try { this.writer.releaseLock(); } catch (e) { /* 已斷開，忽略 */ }
            this.writer = null;
        }

        // 重要：將 port 設為 null，因為已拔除的 port 永久失效
        // 重連時必須透過 getPorts() 或 requestPort() 取得新的 port 引用
        this.port = null;

        // 通知外部（如 LinkIntersector）
        if (this.onDisconnected) {
            try { this.onDisconnected(); } catch (e) {
                console.warn('[SerialManager] onDisconnected callback 執行失敗:', e);
            }
        }
    }

    /**
     * 背景讀取迴圈
     */
    async _startReadLoop() {
        try {
            if (this.port && this.port.readable) {
                this.reader = this.port.readable.getReader();

                while (this.isOpen) {
                    const { value, done } = await this.reader.read();
                    if (done) break;

                    if (value && value.length > 0) {
                        if (this.isFlashingMode && window._stk500_rxBuffer) {
                            // 燒錄模式：直接塞入分享陣列，供 STK500 _readByte 等待
                            for (let i = 0; i < value.length; i++) {
                                window._stk500_rxBuffer.push(value[i]);
                            }
                        } else {
                            // 一般模式：可將資料拋給外部系統 (如 Firmata 或終端機 UI)
                            if (this.onDataReceived) {
                                this.onDataReceived(value);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // 如果是因為 USB 被拔除導致的錯誤，_handleDisconnect 會處理
            // 這裡只需要記錄，不需要重複清理
            if (!this._disconnecting) {
                console.warn("[SerialManager] Read Loop 異常 (可能是 USB 拔除): ", e.message);
            }
        } finally {
            // 防止與 _handleDisconnect 競態：如果已經在斷線處理中，不要再動 reader
            if (!this._disconnecting && this.reader) {
                try { this.reader.releaseLock(); } catch (e) { /* 忽略 */ }
                this.reader = null;
            }
        }
    }
};

// 全域建立一個 Instance 供整個專案使用
window.serialManager = new window.SerialManager();
