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

    // --- 編譯伺服器設定 ---
    // 優先使用遠端伺服器 (Render)
    const COMPILE_SERVER_URL = window.TUBITBLOCK_COMPILE_SERVER
        || 'https://tubitblock-compiler.onrender.com/compile';

    // --- 編譯快取 (Phase 4) ---
    let cachedArtifacts = null;   // Base64 artifacts from last successful compile
    let cachedCodeHash = null;    // 用來判斷程式碼是否已變更
    let isCompiling = false;      // 防止重複點擊
    
    // --- 階段 1：DOM 監聽與「編譯」按鈕注入 ---
    function injectCompileButton() {
        const uploadButton = document.querySelector('div.hardware-header_upload-button_24CyN');
        if (uploadButton && !document.getElementById('web-flasher-compile-btn')) {
            console.log('[Intersector] Found Upload button, injecting Compile button...');
            
            // 複製上傳按鈕的 DOM 結構以維持一致的樣式
            const compileButton = uploadButton.cloneNode(true);
            compileButton.id = 'web-flasher-compile-btn';
            
            // 修改文字與圖示 (如果有的話)
            const textSpan = compileButton.querySelector('span');
            if (textSpan) {
                textSpan.textContent = '編譯 (線上)';
            }
            
            // 更改顏色以區分 (可選，這裡稍微調暗一點藍色)
            compileButton.style.backgroundColor = '#155bb5';
            compileButton.style.marginRight = '10px';
            
            // 點擊事件：Phase 3 - 連接到線上編譯伺服器
            compileButton.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('[Intersector] Compile button clicked!');
                handleCompileOnly(compileButton);
            });

            // 插入到上傳按鈕的前面
            uploadButton.parentNode.insertBefore(compileButton, uploadButton);
        }
    }

    // 使用 MutationObserver 監聽 DOM 變化，確保切換設備後依然能注入按鈕
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                // 節流檢查，避免過多查詢
                injectCompileButton();
            }
        }
    });

    // 等待 body 出現後開始監聽
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
    // ----------------------------------------


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

    // --- Phase 3: handleCompileOnly ---
    // 簡易的程式碼 hash（用來判斷是否需要重新編譯）
    function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const chr = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        return hash.toString(36);
    }

    // 從 GUI 取得當前的程式碼與 board 設定
    function getCurrentCodeFromGUI() {
        // 嘗試從 GUI 的 Ace editor 取得程式碼，必須逐行取得以保留換行符號
        const aceLines = document.querySelectorAll('.ace_line');
        if (aceLines.length > 0) {
            // 將所有行合併，使用換行符號隔開
            return Array.from(aceLines).map(l => l.textContent).join('\n');
        }
        
        // 如果沒有 Ace editor，退路：嘗試取得 Monaco editor 內容
        const monacoLines = document.querySelectorAll('.view-line');
        if (monacoLines.length > 0) {
            return Array.from(monacoLines).map(l => l.textContent).join('\n');
        }
        
        // 再退一步，如果只有純 text layer (雖然這會失去換行，但留作備用)
        const codeEditor = document.querySelector('.ace_text-layer');
        if (codeEditor) {
            return codeEditor.textContent || '';
        }
        
        return null;
    }

    async function handleCompileOnly(buttonElement) {
        if (isCompiling) {
            console.log('[Intersector] 正在編譯中，請稍候...');
            return;
        }
        isCompiling = true;

        const originalText = buttonElement.querySelector('span')?.textContent || '編譯 (線上)';
        const textSpan = buttonElement.querySelector('span');

        try {
            // 更新按鈕狀態
            if (textSpan) textSpan.textContent = '⏳ 編譯中...';
            buttonElement.style.opacity = '0.7';
            buttonElement.style.pointerEvents = 'none';

            // 取得當前程式碼
            const currentCode = getCurrentCodeFromGUI();
            if (!currentCode) {
                throw new Error('無法從編輯器取得程式碼。請確認已選擇裝置並切換到程式碼檢視。');
            }

            const codeHash = simpleHash(currentCode);
            
            // 如果程式碼沒有變更且已有快取，直接跳過
            if (cachedArtifacts && cachedCodeHash === codeHash) {
                console.log('[Intersector] 程式碼未變更，使用快取的編譯結果');
                if (textSpan) textSpan.textContent = '✅ 已編譯';
                setTimeout(() => { if (textSpan) textSpan.textContent = originalText; }, 2000);
                return;
            }

            console.log(`[Intersector] 發送編譯請求到 ${COMPILE_SERVER_URL}`);
            
            const response = await fetch(COMPILE_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: currentCode,
                    board: 'esp32:esp32:esp32'  // TODO: 從 GUI 動態取得
                })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || '編譯失敗');
            }

            // 儲存快取
            cachedArtifacts = result.artifacts;
            cachedCodeHash = codeHash;

            console.log(`[Intersector] 編譯成功！取得 ${result.artifactCount || Object.keys(result.artifacts).length} 個檔案`);
            if (textSpan) textSpan.textContent = '✅ 編譯成功';
            setTimeout(() => { if (textSpan) textSpan.textContent = originalText; }, 3000);

        } catch (err) {
            console.error('[Intersector] 編譯失敗:', err);
            if (textSpan) textSpan.textContent = '❌ 編譯失敗';
            alert(`編譯失敗：${err.message}`);
            setTimeout(() => { if (textSpan) textSpan.textContent = originalText; }, 3000);
        } finally {
            isCompiling = false;
            buttonElement.style.opacity = '1';
            buttonElement.style.pointerEvents = 'auto';
        }
    }

    // --- Phase 4: 改寫 handleInterceptedUpload ---
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
            let artifacts;

            // Phase 4: 優先檢查快取
            if (cachedArtifacts) {
                logger('偵測到已編譯的快取檔案，跳過編譯步驟！');
                artifacts = cachedArtifacts;
            } else {
                // 沒有快取：走原本的編譯流程
                logger(`正在發起線上編譯 (${COMPILE_SERVER_URL})...`);
                
                // 嘗試兩種請求格式：先用 GUI 原生的 params，再用簡潔版
                const response = await fetch(COMPILE_SERVER_URL, {
                    method: 'POST',
                    body: JSON.stringify(params), 
                    headers: { 'Content-Type': 'application/json' }
                });

                if (!response.ok) {
                    const errData = await response.json();
                    console.error('[Intersector] Compile server error:', errData);
                    throw new Error(errData.error || '編譯伺服器錯誤');
                }

                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.error || '編譯失敗');
                }
                artifacts = result.artifacts;
            }

            logger('編譯完成！正在處理 Binary 檔案...');

            // 判斷晶片類型
            const fqbn = (params.config && params.config.fqbn) || '';
            if (fqbn.includes('esp32')) {
                await flashESP32(artifacts, logger);
            } else {
                throw new Error('目前僅支援 ESP32 的網頁直通燒錄');
            }

            // 燒錄成功後清除快取（避免再次燒錄舊版）
            cachedArtifacts = null;
            cachedCodeHash = null;

            logger('燒錄流程全數完成！');
            
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
