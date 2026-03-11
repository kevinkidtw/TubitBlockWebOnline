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
        console.log('[Intersector] WebSocket connection to:', url);
        const ws = new OriginalWebSocket(url, protocols);
        
        // 只有針對 link server (20111) 的連線進行攔截
        if (url.includes(':20111/openblock/serialport')) {
            const originalSend = ws.send;
            ws.send = function (data) {
                try {
                    const json = JSON.parse(data);
                    if (json.method === 'serialport/upload') {
                        console.log('[Intersector] 偵測到 Upload 請求！啟動攔截流程...', json);
                        handleInterceptedUpload(ws, json);
                        return; // 攔截，不發送給 Link Server
                    }
                    if (json.method === 'serialport/discover') {
                        console.log('[Intersector] 偵測到 Discover 請求，注入 Web Serial 虛擬設備...');
                        handleInterceptedDiscover(ws, json);
                        return;
                    }
                    if (json.method === 'serialport/connect') {
                        console.log('[Intersector] 偵測到 Connect 請求，啟動 Web Serial 授權...');
                        handleInterceptedConnect(ws, json);
                        return;
                    }
                } catch (e) {
                    // 非 JSON 或解析失敗，正常發送
                }
                return originalSend.apply(ws, arguments);
            };
        }
        return ws;
    }

    HookedWebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket = HookedWebSocket;

    async function handleInterceptedDiscover(ws, originalRequest) {
        // 模擬發現一個設備
        ws.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({
                jsonrpc: "2.0",
                method: "serialport/didDiscoverPeripheral",
                params: {
                    peripheralId: "web-serial-device",
                    name: "Web Serial (瀏覽器直通)",
                    rssi: -50
                }
            })
        }));
    }

    async function handleInterceptedConnect(ws, originalRequest) {
        const { id } = originalRequest;
        try {
            console.log('[Intersector] 請求 Web Serial 存取權...');
            await window.serialManager.requestPort();
            await window.serialManager.open(115200); // 預設連線波特率
            
            console.log('[Intersector] 連線成功！回報給 GUI');
            ws.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify({
                    jsonrpc: "2.0",
                    id: id,
                    result: null
                })
            }));
        } catch (e) {
            console.error('[Intersector] 連線失敗:', e);
            ws.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify({
                    jsonrpc: "2.0",
                    id: id,
                    error: { message: e.message }
                })
            }));
        }
    }

    async function handleInterceptedUpload(ws, originalRequest) {
        const { id, params } = originalRequest;
        const logger = (msg) => {
            console.log('[Intersector]', msg);
            // 同步發送 stdout 給 GUI
            ws.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "serialport/uploadStdout",
                    params: { message: `\x1b[32m[WebFlasher] ${msg}\n\x1b[0m` }
                })
            }));
        };

        try {
            logger("正在發起模擬線上編譯 (POST /compile)...");
            
            const response = await fetch('http://127.0.0.1:20111/compile', {
                method: 'POST',
                body: JSON.stringify(params),
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                const errData = await response.json();
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
            
            // 回報 Success 給 GUI
            ws.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify({
                    jsonrpc: "2.0",
                    id: id,
                    result: "Success"
                })
            }));
            
            // 發送 uploadSuccess 事件
            ws.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "serialport/uploadSuccess",
                    params: { aborted: false }
                })
            }));

        } catch (e) {
            console.error('[Intersector] 錯誤:', e);
            logger(`[錯誤] ${e.message}`);
            
            // 回報 Error 給 GUI
            ws.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "serialport/uploadError",
                    params: { message: `\x1b[31m${e.message}\x1b[0m` }
                })
            }));
        }
    }

    async function flashESP32(artifacts, logger) {
        if (!window.serialManager.isOpen) {
            logger("序列埠尚未開啟，正在請求權限並連線...");
            await window.serialManager.requestPort();
            await window.serialManager.open(460800);
        }

        const flasher = new window.Esp32WebFlasher(window.serialManager, logger);
        
        // 準備 ESP32 分區資料
        // 注意：這裡假設 artifacts 包含對應名稱的檔名。
        // 線上編譯通常會回傳多個 .bin
        const fileArray = [];
        
        // 尋找主要的 app bin (通常檔名包含 project.ino.bin)
        for (const [name, base64] of Object.entries(artifacts)) {
            const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            
            if (name.includes('bootloader')) {
                fileArray.push({ data, address: 0x1000 });
            } else if (name.includes('partitions')) {
                fileArray.push({ data, address: 0x8000 });
            } else if (name.endsWith('.bin') && !name.includes('bootloader') && !name.includes('partitions')) {
                // 假設這個是最主要的 App bin
                fileArray.push({ data, address: 0x10000 });
            }
        }

        if (fileArray.length === 0) throw new Error("編譯結果中找不到任何 .bin 檔案");
        
        logger(`準備燒錄 ${fileArray.length} 個分區...`);
        await flasher.flashData(fileArray);
    }

    console.log('[Intersector] LinkIntersector 已載入並掛載 HookedWebSocket');
})();
