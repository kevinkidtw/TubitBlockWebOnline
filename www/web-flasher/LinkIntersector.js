/**
 * LinkIntersector.js
 * 
 * 攔截 GUI 與 tubitblock-link 之間的 WebSocket 通訊。
 * 當偵測到 upload 請求時，改由瀏覽器端發起：
 * 1. 向 Link Server 請求 /compile (模擬線上編譯)
 * 2. 獲取 Binary 後，使用 Web Serial (Esp32WebFlasher) 進行燒錄。
 */

(function () {
    const OriginalWebSocket = window.WebSocket;

    function HookedWebSocket(url, protocols) {
        console.log('[Intersector] WebSocket Attempt:', url);
        const ws = new OriginalWebSocket(url, protocols);
        
        // 攔截所有到 port 20111 的請求
        if (url.includes(':20111')) {
            console.log('[Intersector] Hooking Link WebSocket:', url);
            const originalSend = ws.send;
            ws.send = function (data) {
                try {
                    const json = JSON.parse(data);
                    if (json && json.method) {
                        console.log('[Intersector] Outgoing JSON-RPC Method:', json.method);
                        const method = json.method.replace('serialport/', '');

                        if (method === 'upload') {
                            console.log('[Intersector] Detected Upload! Triggering compilation and flashing...');
                            handleInterceptedUpload(ws, json);
                            return; 
                        }
                        if (method === 'discover') {
                            console.log('[Intersector] Detected Discover! Injecting virtual device...');
                            handleInterceptedDiscover(ws, json);
                            return;
                        }
                        if (method === 'connect') {
                            console.log('[Intersector] Detected Connect! Opening Web Serial...');
                            handleInterceptedConnect(ws, json);
                            return;
                        }
                    }
                } catch (e) {
                    // console.warn('[Intersector] Message parse error or non-JSON:', data);
                }
                return originalSend.apply(ws, arguments);
            };
        }
        return ws;
    }

    HookedWebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket = HookedWebSocket;

    // 輔助函式：注入訊息回 GUI
    function injectMessage(ws, data) {
        const event = new MessageEvent('message', {
            data: JSON.stringify(data)
        });
        console.log('[Intersector] Injecting message to GUI:', data.method || 'response', data);
        ws.dispatchEvent(event);
        if (typeof ws.onmessage === 'function') {
            ws.onmessage(event);
        }
    }

    async function handleInterceptedDiscover(ws, originalRequest) {
        // 模擬發現一個設備
        injectMessage(ws, {
            jsonrpc: "2.0",
            method: "didDiscoverPeripheral",
            params: {
                peripheralId: "web-serial-device",
                name: "Web Serial (瀏覽器直通)",
                rssi: -50
            }
        });
    }

    async function handleInterceptedConnect(ws, originalRequest) {
        const { id } = originalRequest;
        try {
            if (!window.serialManager) throw new Error("SerialManager not initialized");
            console.log('[Intersector] 請求 Web Serial 存取權...');
            await window.serialManager.requestPort();
            await window.serialManager.open(115200); 
            
            console.log('[Intersector] 連線成功！回報給 GUI');
            injectMessage(ws, {
                jsonrpc: "2.0",
                id: id,
                result: null
            });
        } catch (e) {
            console.error('[Intersector] 連線失敗:', e);
            injectMessage(ws, {
                jsonrpc: "2.0",
                id: id,
                error: { message: e.message }
            });
        }
    }

    async function handleInterceptedUpload(ws, originalRequest) {
        const { id, params } = originalRequest;
        const logger = (msg) => {
            console.log('[Intersector]', msg);
            injectMessage(ws, {
                jsonrpc: "2.0",
                method: "uploadStdout",
                params: { message: `\x1b[32m[WebFlasher] ${msg}\n\x1b[0m` }
            });
        };

        try {
            logger("正在發起網頁編譯 (POST /compile)...");
            
            const response = await fetch('http://127.0.0.1:20111/compile', {
                method: 'POST',
                body: JSON.stringify(params), 
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                const errData = await response.json();
                console.error('[Intersector] Compile server error response:', errData);
                throw new Error(errData.error || "編譯伺服器錯誤");
            }

            const result = await response.json();
            logger("編譯成功！正在處理 Binary 檔案...");

            // 判斷晶片類型 (ESP32)
            if (params.config.fqbn.includes('esp32')) {
                await flashESP32(result.artifacts, logger);
            } else {
                throw new Error("目前僅支援 ESP32 的網頁直通燒錄");
            }

            logger("燒錄流程全數完成！");
            
            injectMessage(ws, {
                jsonrpc: "2.0",
                id: id,
                result: "Success"
            });
            
            injectMessage(ws, {
                jsonrpc: "2.0",
                method: "uploadSuccess",
                params: { aborted: false }
            });

        } catch (e) {
            console.error('[Intersector] 錯誤:', e);
            logger(`[錯誤] ${e.message}`);
            
            injectMessage(ws, {
                jsonrpc: "2.0",
                method: "uploadError",
                params: { message: `\x1b[31m${e.message}\x1b[0m` }
            });
        }
    }

    async function flashESP32(artifacts, logger) {
        if (!window.serialManager) throw new Error("SerialManager not initialized");
        if (!window.serialManager.isOpen) {
            logger("序列埠尚未開啟，正在請求權限並連線...");
            await window.serialManager.requestPort();
            await window.serialManager.open(460800);
        }

        const flasher = new window.Esp32WebFlasher(window.serialManager, logger);
        
        const fileArray = [];
        for (const [name, base64] of Object.entries(artifacts)) {
            const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            
            if (name.includes('bootloader')) {
                fileArray.push({ data, address: 0x1000 });
            } else if (name.includes('partitions')) {
                fileArray.push({ data, address: 0x8000 });
            } else if (name.endsWith('.bin') && !name.includes('bootloader') && !name.includes('partitions')) {
                fileArray.push({ data, address: 0x10000 });
            }
        }

        if (fileArray.length === 0) throw new Error("編譯結果中找不到任何 .bin 檔案");
        
        logger(`準備燒錄 ${fileArray.length} 個分區...`);
        await flasher.flashData(fileArray);
    }

    console.log('[Intersector] LinkIntersector 已載入並掛載 HookedWebSocket');
})();
