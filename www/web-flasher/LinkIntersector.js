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
    const ONLINE_COMPILE_URL = window.TUBITBLOCK_COMPILE_SERVER
        || 'https://kevinkid-tubit.mooo.com:3001/compile';
    const LOCAL_COMPILE_URL = 'http://localhost:3000/compile';

    // 從 localStorage 讀取使用者上次的選擇（預設線上）
    let compileMode = localStorage.getItem('tubitblock_compile_mode') || 'online';
    let COMPILE_SERVER_URL = (compileMode === 'local') ? LOCAL_COMPILE_URL : ONLINE_COMPILE_URL;

    // --- 編譯快取 (Phase 4) ---
    let cachedArtifacts = null;       // Base64 artifacts from last successful compile
    let cachedFlashAddresses = null;  // 對應的 flash 地址映射（由 server 回傳）
    let cachedCodeHash = null;        // 用來判斷程式碼是否已變更
    let isCompiling = false;          // 防止重複點擊
    let isUploading = false;          // 燒錄進行中（防止燒錄期間觸發編譯）
    let isSerialReading = false;      // GUI 是否已啟動串口讀取（read 方法觸發）
    let activeFakeWs = null;          // 當前活動的 fake WebSocket 引用（用於 onDataReceived）
    
    // --- 階段 1：DOM 監聽與「編譯」按鈕 + 模式切換注入 ---
    function getCompileModeLabel() {
        return compileMode === 'local' ? '💻 本地' : '🌐 線上';
    }

    function injectCompileButton() {
        const uploadButton = document.querySelector('div.hardware-header_upload-button_24CyN');
        if (uploadButton && !document.getElementById('web-flasher-compile-btn')) {
            console.log('[Intersector] Found Upload button, injecting Compile + Toggle buttons...');
            
            // === 模式切換按鈕 ===
            const toggleBtn = document.createElement('div');
            toggleBtn.id = 'web-flasher-mode-toggle';
            toggleBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;' +
                'padding:0 15px;margin-right:1px;border-radius:4px 0 0 4px;cursor:pointer;' +
                'font-size:12px;font-weight:bold;color:#fff;user-select:none;' +
                'transition:all 0.2s;min-width:70px;height:32px;box-sizing:border-box;';
            toggleBtn.title = '切換本地/線上編譯模式';

            // === 編譯按鈕 ===
            const compileButton = uploadButton.cloneNode(true);
            compileButton.id = 'web-flasher-compile-btn';
            compileButton.style.marginRight = '6px';
            compileButton.style.borderTopLeftRadius = '0';
            compileButton.style.borderBottomLeftRadius = '0';
            compileButton.style.transition = 'all 0.2s';
            compileButton.style.minWidth = '70px';
            compileButton.style.padding = '0 15px';
            compileButton.style.boxSizing = 'border-box';
            compileButton.style.display = 'inline-flex';
            compileButton.style.justifyContent = 'center';
            compileButton.style.alignItems = 'center';

            // 移除複製出的上傳圖示（使用者希望編譯按鈕不要和上傳一樣的圖案，若無合適的寧願不要）
            const icon = compileButton.querySelector('img') || compileButton.querySelector('svg');
            if (icon) {
                icon.remove();
            }
            
            // 統一更新兩個按鈕的主題/狀態
            function updateTheme() {
                const isLocal = compileMode === 'local';
                // 線上為深藍色，本地為深橘色(對比凸顯)
                const themeColor = isLocal ? '#e65100' : '#1565c0';
                
                toggleBtn.textContent = getCompileModeLabel();
                toggleBtn.style.backgroundColor = themeColor;
                
                compileButton.style.backgroundColor = themeColor;
                compileButton.style.borderColor = themeColor; // 確保若原本帶有邊框顏色也會同步
                const textSpan = compileButton.querySelector('span');
                if (textSpan) {
                    textSpan.textContent = '編譯';
                }
            }

            compileButton.addEventListener('click', (e) => {
                e.stopPropagation();
                handleCompileOnly(compileButton);
            });

            toggleBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (isCompiling || isUploading) {
                    alert('編譯或燒錄進行中，請稍後再切換。');
                    return;
                }

                if (compileMode === 'online') {
                    // 切到本地：先 ping localhost:3000
                    toggleBtn.textContent = '⏳ 偵測中...';
                    toggleBtn.style.backgroundColor = '#757575';
                    compileButton.style.backgroundColor = '#757575';
                    compileButton.style.borderColor = '#757575';
                    try {
                        const resp = await fetch('http://localhost:3000/', {
                            method: 'GET',
                            signal: AbortSignal.timeout(3000)
                        });
                        if (resp.ok) {
                            compileMode = 'local';
                            COMPILE_SERVER_URL = LOCAL_COMPILE_URL;
                            console.log('[Intersector] 切換到本地編譯模式');
                        } else {
                            throw new Error('Server responded with ' + resp.status);
                        }
                    } catch (err) {
                        alert('⚠️ 無法連接本地編譯伺服器 (localhost:3000)\n\n' +
                              '請先執行「部署本地編譯器」下載的啟動腳本。\n' +
                              '（齒輪選單 → 部署本地編譯器）');
                        updateTheme(); // 回復原本外觀
                        return;
                    }
                } else {
                    compileMode = 'online';
                    COMPILE_SERVER_URL = ONLINE_COMPILE_URL;
                    console.log('[Intersector] 切換到線上編譯模式');
                }

                // 清空快取
                cachedArtifacts = null;
                cachedFlashAddresses = null;
                cachedCodeHash = null;

                // 持久化並更新外觀
                localStorage.setItem('tubitblock_compile_mode', compileMode);
                updateTheme();
            });

            // 初始化套用主題
            updateTheme();

            // Hover 效果同步
            toggleBtn.addEventListener('mouseenter', () => toggleBtn.style.opacity = '0.85');
            toggleBtn.addEventListener('mouseleave', () => toggleBtn.style.opacity = '1');
            compileButton.addEventListener('mouseenter', () => compileButton.style.opacity = '0.85');
            compileButton.addEventListener('mouseleave', () => compileButton.style.opacity = '1');

            uploadButton.parentNode.insertBefore(compileButton, uploadButton);
            uploadButton.parentNode.insertBefore(toggleBtn, compileButton);
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


    /**
     * 為 :20111 (Link server) URL 建立一個假的 WebSocket 物件。
     * 真實的 WebSocket 連線會因為 Link server 不存在而失敗，導致 GUI 顯示
     * 「請安裝 TUbitBlock Link」的對話框。
     * 假的 WS 立即模擬連線成功 (onopen)，並攔截所有 send() 呼叫。
     */
    function createFakeLinkWebSocket(url) {
        const fakeWs = new EventTarget();
        fakeWs.url = url;
        fakeWs.readyState = 0; // CONNECTING
        fakeWs.CONNECTING = 0; fakeWs.OPEN = 1; fakeWs.CLOSING = 2; fakeWs.CLOSED = 3;
        fakeWs.onopen = null; fakeWs.onclose = null; fakeWs.onerror = null; fakeWs.onmessage = null;
        fakeWs.bufferedAmount = 0; fakeWs.extensions = ''; fakeWs.protocol = ''; fakeWs.binaryType = 'blob';

        // 用 property setter 讓 on* 屬性透過 addEventListener 註冊，
        // 避免 dispatchEvent 重複觸發（舊做法會讓 addEventListener + onmessage 同時存在時訊息重複）
        ['open', 'close', 'error', 'message'].forEach(type => {
            let _h = null;
            Object.defineProperty(fakeWs, 'on' + type, {
                get() { return _h; },
                set(fn) {
                    if (_h) fakeWs.removeEventListener(type, _h);
                    _h = fn;
                    if (fn) fakeWs.addEventListener(type, fn);
                },
                configurable: true
            });
        });

        fakeWs.send = function (data) {
            try {
                const json = JSON.parse(data);
                if (json && json.method) {
                    console.log('[Intersector] Outgoing JSON-RPC Method:', json.method);
                    const method = json.method.replace('serialport/', '');
                    if (method === 'upload')   { handleInterceptedUpload(fakeWs, json);   return; }
                    if (method === 'discover') { handleInterceptedDiscover(fakeWs, json); return; }
                    if (method === 'connect')  { handleInterceptedConnect(fakeWs, json);  return; }
                    if (method === 'read')     { handleInterceptedRead(fakeWs, json);    return; }
                    if (method === 'write')    { handleInterceptedWrite(fakeWs, json);   return; }
                    if (method === 'disconnect') { handleInterceptedDisconnect(fakeWs, json); return; }
                }
            } catch (e) {}
            console.log('[Intersector] Unhandled WS send:', data);
        };

        fakeWs.close = function () {
            fakeWs.readyState = 3;
            fakeWs.dispatchEvent(new CloseEvent('close', { wasClean: true, code: 1000 }));
        };

        // 模擬立即連線成功
        setTimeout(function () {
            fakeWs.readyState = 1; // OPEN
            fakeWs.dispatchEvent(new Event('open'));
        }, 50);

        return fakeWs;
    }

    function HookedWebSocket(url, protocols) {
        console.log('[Intersector] WebSocket Attempt:', url);
        if (url.includes(':20111')) {
            console.log('[Intersector] Intercepting Link WebSocket, using fake WS (no real connection)');
            return createFakeLinkWebSocket(url);
        }
        return new OriginalWebSocket(url, protocols);
    }

    HookedWebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket = HookedWebSocket;

    // 輔助函式：注入訊息回 GUI
    function injectMessage(ws, data) {
        const event = new MessageEvent('message', {
            data: JSON.stringify(data)
        });
        console.log('[Intersector] Injecting message to GUI:', data.method || 'response', data.method === 'onMessage' ? '(serial data)' : data);
        // dispatchEvent 已被覆寫，內部會自動呼叫 onmessage，無需額外呼叫
        ws.dispatchEvent(event);
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

            if (window.serialManager.isOpen) {
                // 燒錄後序列埠已重新開啟，無需再次請求，直接回報連線成功
                console.log('[Intersector] 序列埠已開啟，直接回報連線成功。');
            } else {
                console.log('[Intersector] 請求 Web Serial 存取權...');
                if (!window.serialManager.port) {
                    await window.serialManager.requestPort();
                }
                await window.serialManager.open(115200);
                console.log('[Intersector] 連線成功！');
            }

            // 連線成功後，設定 serial data callback 以便之後 read 時轉發資料
            activeFakeWs = ws;

            // 監聽 USB 斷線，主動通知 GUI
            window.serialManager.onDisconnected = function () {
                isSerialReading = false;
                console.warn('[Intersector] USB 裝置已拔除，通知 GUI 斷線');
                if (activeFakeWs) {
                    injectMessage(activeFakeWs, {
                        jsonrpc: "2.0",
                        method: "peripheralUnplug",
                        params: {}
                    });
                    activeFakeWs = null;
                }
            };

            window.serialManager.onDataReceived = function (value) {
                if (!isSerialReading || isUploading) return;
                // 將 Uint8Array 轉為 base64（符合 OpenBlock Link 原始協議）
                let binary = '';
                for (let i = 0; i < value.length; i++) {
                    binary += String.fromCharCode(value[i]);
                }
                const base64 = btoa(binary);
                injectMessage(activeFakeWs, {
                    jsonrpc: "2.0",
                    method: "onMessage",
                    params: {
                        encoding: 'base64',
                        message: base64
                    }
                });
            };

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

    // --- Serial Read：GUI 通知開始接收串口資料 ---
    async function handleInterceptedRead(ws, originalRequest) {
        isSerialReading = true;
        console.log('[Intersector] Serial Read 已啟動，開始轉發串口資料到 GUI');
        // read 是 notification，不需要 id 回覆
    }

    // --- Serial Write：GUI 發送資料到串口 ---
    async function handleInterceptedWrite(ws, originalRequest) {
        const { id, params } = originalRequest;
        try {
            if (!window.serialManager || !window.serialManager.isOpen) {
                throw new Error('序列埠尚未連線');
            }
            const { message, encoding } = params;
            let bytes;
            if (encoding === 'base64') {
                const binary = atob(message);
                bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
            } else {
                bytes = new TextEncoder().encode(message);
            }
            await window.serialManager.write(bytes);
            injectMessage(ws, {
                jsonrpc: "2.0",
                id: id,
                result: bytes.length
            });
        } catch (e) {
            console.error('[Intersector] Serial Write 失敗:', e);
            injectMessage(ws, {
                jsonrpc: "2.0",
                id: id,
                error: { message: e.message }
            });
        }
    }

    // --- Disconnect：斷開串口連線 ---
    async function handleInterceptedDisconnect(ws, originalRequest) {
        const { id } = originalRequest;
        isSerialReading = false;
        activeFakeWs = null;
        if (window.serialManager) {
            window.serialManager.onDataReceived = null;
            if (window.serialManager.isOpen) {
                await window.serialManager.close();
            }
        }
        console.log('[Intersector] 序列埠已斷開');
        if (id) {
            injectMessage(ws, {
                jsonrpc: "2.0",
                id: id,
                result: null
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
    async function getCurrentCodeFromGUI(logger) {
        if (logger) logger(`[Debug] 啟動智慧掃描所有程式碼視窗...`);
        let bestCode = '';
        let bestLength = 0;

        // 1. 抓取畫面上所有的 Ace Editor 實例 (舊版相容)
        const aceEditors = document.querySelectorAll('.ace_editor');
        aceEditors.forEach((aceEl, idx) => {
            if (aceEl && aceEl.env && aceEl.env.editor) {
                const code = aceEl.env.editor.getValue() || '';
                const isVisible = aceEl.offsetParent !== null;
                if (logger) logger(`[Debug] 找到 Ace 視窗 ${idx} (可見: ${isVisible}), 長度: ${code.length}`);
                
                if (code.length > bestLength) {
                    bestLength = code.length;
                    bestCode = code;
                }
            }
        });

        // 2. 抓取 Monaco Editor 實例 (OpenBlock / TubitBlockWeb 新版右側視窗所用)
        try {
            if (window.monaco && window.monaco.editor) {
                const models = window.monaco.editor.getModels();
                models.forEach((model, idx) => {
                    const code = model.getValue() || '';
                    if (logger) logger(`[Debug] 找到 Monaco 視窗模型 ${idx}, 長度: ${code.length}`);
                    
                    if (code.length > bestLength) {
                        bestLength = code.length;
                        bestCode = code;
                    }
                });
            } else {
                if (logger) logger(`[Debug] 未在全域找到 window.monaco 物件`);
            }
        } catch (e) {
            if (logger) logger(`[Debug] 掃描 Monaco 時發生錯誤: ${e.message}`);
        }

        // 如果成功抓到合理的長度，就直接回傳，不再經過複雜的切換手續！
        if (bestCode && bestCode.trim().length > 50) {
            if (logger) logger(`[Debug] 智慧掃描完成，採用視窗中找到的最長代碼 (${bestLength} 字元)`);
            return bestCode.replace(/\u00A0/g, ' ');
        }

        // --- 若以上都失敗，再使用終極保險：隱形切換分頁大法 ---
        const aceEl = document.querySelector('.ace_editor');
        const isCodeMode = aceEl && aceEl.offsetParent !== null;

        if (!isCodeMode) {
            try {
                const ALL_TABS = document.querySelectorAll('.react-tabs__tab');
                let codeTab = null;
                let blocksTab = null;

                ALL_TABS.forEach(tab => {
                    if (tab.textContent.includes('代碼') || tab.textContent.includes('程式碼') || tab.textContent.includes('Code')) {
                        codeTab = tab;
                    } else if (tab.textContent.includes('積木') || tab.textContent.includes('Blocks')) {
                        blocksTab = tab;
                    }
                });

                if (codeTab && blocksTab) {
                    if (logger) logger(`[Debug] DOM 找不到合理代碼，啟動終極絕招：隱形切換分頁...`);
                    codeTab.click();
                    await new Promise(resolve => setTimeout(resolve, 80));

                    const currentAce = document.querySelector('.ace_editor');
                    if (currentAce && currentAce.env && currentAce.env.editor) {
                        const freshCode = currentAce.env.editor.getValue();
                        if (logger) logger(`[Debug] 切換後成功讀取，新鮮代碼長度: ${freshCode ? freshCode.length : 0}`);
                        blocksTab.click();

                        if (freshCode && freshCode.trim().length > 0) {
                            return freshCode.replace(/\u00A0/g, ' ');
                        }
                    } else {
                        blocksTab.click();
                    }
                }
            } catch (err) {
                 if (logger) logger(`[Debug] 隱形切換分頁出錯: ${err.message}`);
            }
        }

        // 備援：DOM 行抓取（只含可見行，可能不完整）
        const aceLines = document.querySelectorAll('.ace_line');
        if (aceLines.length > 0) {
            // 替換掉 non-breaking space (\xA0) 為一般空白，否則 C++ 編譯會報錯 "extended character..."
            return Array.from(aceLines).map(l => l.textContent.replace(/\u00A0/g, ' ')).join('\n');
        }

        // 如果沒有 Ace editor，退路：嘗試取得 Monaco editor 內容
        const monacoLines = document.querySelectorAll('.view-line');
        if (monacoLines.length > 0) {
            return Array.from(monacoLines).map(l => l.textContent.replace(/\u00A0/g, ' ')).join('\n');
        }

        // 再退一步，如果只有純 text layer (雖然這會失去換行，但留作備用)
        const codeEditor = document.querySelector('.ace_text-layer');
        if (codeEditor) {
            return codeEditor.textContent || '';
        }

        return null;
    }

    async function handleCompileOnly(buttonElement) {
        if (isUploading) {
            alert('正在燒錄中，請等待燒錄完成後再編譯。');
            return;
        }
        if (isCompiling) {
            console.log('[Intersector] 正在編譯中，請稍候...');
            return;
        }
        isCompiling = true;

        const originalText = buttonElement.querySelector('span')?.textContent || '編譯';
        const textSpan = buttonElement.querySelector('span');

        // GUI 訊息輸出：透過 activeFakeWs 送 uploadStdout，讓使用者在 GUI 中看到訊息
        const ws = activeFakeWs;
        const logger = (msg) => {
            console.log('[WebFlasher]', msg);
            if (ws) {
                injectMessage(ws, {
                    jsonrpc: "2.0",
                    method: "uploadStdout",
                    params: { message: `\x1b[36m[WebFlasher] ${msg}\n\x1b[0m` }
                });
            }
        };

        try {
            // 更新按鈕狀態
            if (textSpan) textSpan.textContent = '⏳ 編譯中...';
            buttonElement.style.opacity = '0.7';
            buttonElement.style.pointerEvents = 'none';

            // 若有 ws，先送一個空 result 讓 GUI 顯示 console 面板
            if (ws) {
                injectMessage(ws, {
                    jsonrpc: "2.0",
                    id: 'compile-only-' + Date.now(),
                    result: null
                });
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // 取得當前程式碼
            const currentCode = await getCurrentCodeFromGUI(logger);
            if (!currentCode || currentCode.trim().length < 20) {
                throw new Error('無法從編輯器取得程式碼。請確認已選擇裝置並切換到程式碼檢視。');
            }
            if (!currentCode.includes('void setup') && !currentCode.includes('void loop')) {
                throw new Error('程式碼不完整（找不到 void setup 或 void loop）。請切換到程式碼檢視後再試。');
            }

            const codeHash = simpleHash(currentCode);
            
            // 如果程式碼沒有變更且已有快取，直接跳過
            if (cachedArtifacts && cachedCodeHash === codeHash) {
                logger('程式碼未變更，使用快取的編譯結果 ✅');
                if (textSpan) textSpan.textContent = '✅ 已編譯';
                setTimeout(() => { if (textSpan) textSpan.textContent = originalText; }, 2000);
                return;
            }

            const modeLabel = compileMode === 'local' ? '本地' : '線上';
            logger(`正在發起${modeLabel}編譯 (${COMPILE_SERVER_URL})...`);
            logger(`⏳ 等待${modeLabel}編譯中，請稍候...（依程式複雜度，約需 30 秒至 2 分鐘）`);

            // 每 15 秒送一次提示
            let waitSecs = 15;
            const compileHeartbeat = setInterval(() => {
                logger(`⏳ 仍在編譯中，已等待約 ${waitSecs} 秒，請繼續等候...`);
                waitSecs += 15;
            }, 15000);

            let response;
            try {
                response = await fetch(COMPILE_SERVER_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        code: currentCode,
                        board: 'esp32:esp32:esp32:JTAGAdapter=default,PSRAM=disabled,PartitionScheme=default,CPUFreq=240,FlashMode=qio,FlashFreq=80,FlashSize=4M,UploadSpeed=460800,LoopCore=1,EventsCore=1,DebugLevel=none,EraseFlash=none,ZigbeeMode=default'
                    })
                });
            } catch (fetchErr) {
                if (compileMode === 'local') {
                    throw new Error('無法連接本地編譯伺服器 (localhost:3000)。請確認已啟動本地編譯器。');
                }
                throw fetchErr;
            } finally {
                clearInterval(compileHeartbeat);
            }

            const result = await response.json();

            if (!response.ok || !result.success) {
                const errMsg = result.error || '編譯失敗';
                // 顯示編譯錯誤的詳細內容
                logger('❌ 編譯失敗！');
                if (errMsg.length > 200) {
                    // 多行錯誤訊息逐行送出
                    const lines = errMsg.split('\n');
                    for (const line of lines) {
                        if (line.trim()) {
                            if (ws) {
                                injectMessage(ws, {
                                    jsonrpc: "2.0",
                                    method: "uploadStdout",
                                    params: { message: `\x1b[31m${line}\n\x1b[0m` }
                                });
                            }
                        }
                    }
                }
                throw new Error(errMsg.slice(0, 500));
            }

            // 儲存快取
            cachedArtifacts = result.artifacts;
            cachedFlashAddresses = result.flashAddresses || null;
            cachedCodeHash = codeHash;

            const fileCount = result.artifactCount || Object.keys(result.artifacts).length;
            logger(`✅ 編譯成功！取得 ${fileCount} 個檔案`);

            // 顯示編譯產物詳情
            if (result.stdout) {
                const stdoutLines = result.stdout.split('\n').slice(-5); // 只顯示最後幾行
                for (const line of stdoutLines) {
                    if (line.trim()) logger(`  ${line.trim()}`);
                }
            }

            logger('可以按「上傳」按鈕燒錄到開發板。');

            if (textSpan) textSpan.textContent = '✅ 編譯成功';
            setTimeout(() => { if (textSpan) textSpan.textContent = originalText; }, 3000);

        } catch (err) {
            console.error('[Intersector] 編譯失敗:', err);
            if (textSpan) textSpan.textContent = '❌ 編譯失敗';

            // 送錯誤訊息到 GUI
            if (ws) {
                injectMessage(ws, {
                    jsonrpc: "2.0",
                    method: "uploadStdout",
                    params: { message: `\x1b[31m[WebFlasher] ❌ 編譯失敗：${err.message}\n\x1b[0m` }
                });
            } else {
                // 沒有 ws 時才用 alert
                alert(`編譯失敗：${err.message}`);
            }

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

        isUploading = true;

        try {
            // --- 重大修復：SecurityError ---
            // Web Serial 的 requestPort 必須在「使用者手勢」(User Gesture) 的 call stack 裡面執行。
            // 由於之前的 fetch 是非同步的，等 fetch 回來後就失去了手勢上下文。
            // 解決方案：在開始編譯 (fetch) 之前，就先檢查並請求 Port 權限。
            if (!window.serialManager.isOpen || !window.serialManager.port) {
                logger("偵測到序列埠尚未連線，正在請求存取權限...");
                await window.serialManager.requestPort();
                // 先用 115200 開啟（之後閃爍時會自動調整，或者是這裡直接用 460800 也可以）
                await window.serialManager.open(115200);
                logger("序列埠已就緒。");
            }

            // --- 提早回覆 JSON-RPC result，防止 GUI 因等待 >10 秒而顯示「上傳超時」---
            // 燒錄 ESP32 約需 20-30 秒，遠超過 GUI 的 JSON-RPC timeout。
            // 提前送出 result:null 讓 GUI 確認 RPC 已被接受，
            // 後續進度訊息 (uploadStdout) 與完成通知 (uploadSuccess) 仍會正常送到。
            injectMessage(ws, {
                jsonrpc: "2.0",
                id: id,
                result: null
            });

            // 等待 GUI 處理 result 並 re-render 出 console 面板後，再送 uploadStdout
            await new Promise(resolve => setTimeout(resolve, 200));

            let artifacts;
            let flashAddresses;

            // Phase 4: 優先檢查快取
            if (cachedArtifacts) {
                logger('偵測到已編譯的快取檔案，跳過編譯步驟！');
                artifacts = cachedArtifacts;
                flashAddresses = cachedFlashAddresses;
            } else {
                // 沒有快取：走原本的編譯流程
                logger(`正在發起線上編譯 (${COMPILE_SERVER_URL})...`);
                logger(`⏳ 等待雲端編譯中，請稍候...（依程式複雜度，約需 30 秒至 2 分鐘）`);

                // 每 15 秒送一次提示，避免使用者誤以為當機
                let waitSecs = 15;
                const compileHeartbeat = setInterval(() => {
                    logger(`⏳ 仍在編譯中，已等待約 ${waitSecs} 秒，請繼續等候...`);
                    waitSecs += 15;
                }, 15000);

                let response;
                try {
                    // 嘗試兩種請求格式：先用 GUI 原生的 params，再用簡潔版
                    response = await fetch(COMPILE_SERVER_URL, {
                        method: 'POST',
                        body: JSON.stringify(params),
                        headers: { 'Content-Type': 'application/json' }
                    });
                } finally {
                    clearInterval(compileHeartbeat);
                }

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
                flashAddresses = result.flashAddresses || null;
            }

            logger('編譯完成！正在處理 Binary 檔案...');

            // 判斷晶片類型 (安全轉型避免 fqbn 為 object 導致 includes is not a function)
            const fqbnRaw = (params && params.config && params.config.fqbn);
            const boardRaw = (params && params.board);
            const typeStr = JSON.stringify({ fqbn: fqbnRaw, board: boardRaw }).toLowerCase();

            if (typeStr.includes('esp32')) {
                await flashESP32(artifacts, flashAddresses, logger);
            } else {
                // 如果前端 API 有變無法分辨，但產出檔案裡有 bootloader，我們就假設是 ESP32
                const hasBootloader = Object.keys(artifacts).some(k => k.includes('bootloader'));
                if (hasBootloader) {
                    logger('無法從指令分辨硬體類型，但偵測到 bootloader 檔案，自動啟用 ESP32 燒錄模式');
                    await flashESP32(artifacts, flashAddresses, logger);
                } else {
                    throw new Error('無法判斷設備類型，或目前不支援該晶片的網頁直通燒錄 (僅支援 ESP32)');
                }
            }

            // 燒錄成功後清除快取（避免再次燒錄舊版）
            cachedArtifacts = null;
            cachedFlashAddresses = null;
            cachedCodeHash = null;

            logger('燒錄流程全數完成！');

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
        } finally {
            isUploading = false;
        }
    }

    async function flashESP32(artifacts, flashAddresses, logger) {
        if (!window.serialManager) throw new Error("SerialManager not initialized");
        if (!window.serialManager.isOpen || !window.serialManager.port) {
            logger("序列埠尚未開啟，正在請求權限並連線...");
            await window.serialManager.requestPort();
            await window.serialManager.open(460800);
        }

        const flasher = new window.Esp32WebFlasher(window.serialManager, logger);
        const fileArray = [];

        for (const [name, base64] of Object.entries(artifacts)) {
            const bn = name.includes('/') ? name.split('/').pop() : name;
            if (!bn.endsWith('.bin')) continue;  // 跳過 .hex / .elf

            let address;
            const hasServerMap = flashAddresses && Object.keys(flashAddresses).length > 0;
            if (hasServerMap) {
                // Server 有提供明確映射：只燒 server 清單內的檔案，其餘全部跳過
                // （避免 merged.bin 等合併映像被誤燒到錯誤地址）
                if (flashAddresses[name] === undefined) {
                    logger(`  跳過 ${name}（不在 server 燒錄清單中）`);
                    continue;
                }
                address = flashAddresses[name];
            } else {
                // 向下兼容 fallback：舊版 server 未回傳 flashAddresses 時依檔名推斷
                if (bn.includes('merged')) { logger(`  跳過 ${name}（merged binary）`); continue; }
                if (bn.includes('bootloader'))      address = 0x1000;
                else if (bn === 'boot_app0.bin')    address = 0xe000;
                else if (bn.includes('partitions')) address = 0x8000;
                else                                address = 0x10000;
                logger(`[警告] Server 未提供地址，使用檔名推斷: ${name} → 0x${address.toString(16)}`);
            }

            const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            fileArray.push({ data, address });
            logger(`  ${name} → 0x${address.toString(16).toUpperCase()} (${data.length} bytes)`);
        }

        if (fileArray.length === 0) throw new Error("編譯結果中找不到任何可燒錄的 .bin 檔案");
        logger(`準備燒錄 ${fileArray.length} 個分區...`);
        await flasher.flashData(fileArray);
    }

    console.log('[Intersector] LinkIntersector 已載入並掛載 HookedWebSocket');
})();
