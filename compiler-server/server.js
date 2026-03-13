/**
 * TubitBlock Online Compiler Server
 *
 * 接收前端 POST 的 Arduino 原始碼，呼叫 arduino-cli 進行編譯，
 * 將產生的 .bin / .hex 檔案以 Base64 回傳給前端。
 */

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 動態定位 boot_app0.bin 的路徑。
 * 此檔案不在 arduino-cli 的 build 輸出目錄，而在 ESP32 core 的 tools/partitions/ 下。
 * 版本目錄自動排序取最新版，未來升級 core 版本時不需修改此函式。
 * @returns {string|null}
 */
function findBootApp0() {
    const espHwBase = path.join(os.homedir(), '.arduino15', 'packages', 'esp32', 'hardware', 'esp32');
    if (!fs.existsSync(espHwBase)) return null;
    let versions;
    try {
        versions = fs.readdirSync(espHwBase).filter(n => fs.statSync(path.join(espHwBase, n)).isDirectory());
    } catch (e) { return null; }
    if (!versions.length) return null;
    versions.sort((a, b) => {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const d = (pb[i] || 0) - (pa[i] || 0);
            if (d) return d;
        }
        return 0;
    });
    for (const ver of versions) {
        const p = path.join(espHwBase, ver, 'tools', 'partitions', 'boot_app0.bin');
        if (fs.existsSync(p)) {
            console.log(`[Compile] Found boot_app0.bin: ${p} (core v${ver})`);
            return p;
        }
    }
    console.warn('[Compile] boot_app0.bin not found in any installed ESP32 core version');
    return null;
}

/**
 * 遞迴收集 buildDir 中的所有 .bin/.hex/.elf 檔案。
 * 防禦性地處理子目錄，避免未來 core 版本更新造成 artifact 遺漏。
 * @param {string} dir
 * @param {Object} artifacts  結果物件 { key: base64 }
 * @param {string} relPrefix  遞迴用相對路徑前綴
 */
function collectArtifactsRecursive(dir, artifacts, relPrefix = '') {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            collectArtifactsRecursive(full, artifacts, relPrefix ? `${relPrefix}/${entry}` : entry);
        } else if (entry.endsWith('.bin') || entry.endsWith('.hex') || entry.endsWith('.elf')) {
            const key = relPrefix ? `${relPrefix}/${entry}` : entry;
            artifacts[key] = fs.readFileSync(full).toString('base64');
            console.log(`[Compile]   artifact: ${key} (${stat.size} bytes)`);
        }
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// arduino-cli 路徑，Docker 環境中安裝在 /usr/local/bin
const ARDUINO_CLI = process.env.ARDUINO_CLI_PATH || 'arduino-cli';

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// --- Health Check with diagnostics ---
app.get('/', async (req, res) => {
    const cliVersion = await new Promise(resolve => {
        exec(`${ARDUINO_CLI} version 2>&1`, (err, stdout) => {
            resolve(err ? `ERROR: ${err.message}` : stdout.trim());
        });
    });
    const boards = await new Promise(resolve => {
        exec(`${ARDUINO_CLI} core list 2>&1`, (err, stdout) => {
            resolve(err ? `ERROR: ${err.message}` : stdout.trim());
        });
    });
    res.json({
        service: 'tubitblock-compiler-server',
        status: 'running',
        version: '1.1.0',
        arduino_cli: cliVersion,
        installed_cores: boards
    });
});

// --- 編譯 API ---
app.post('/compile', async (req, res) => {
    const { code, board, fqbn, libraries } = req.body;

    let sourceCode = code;
    let boardFqbn = fqbn || board;

    // 相容 LinkIntersector 的 params 格式 (message+config+encoding)
    if (!sourceCode && req.body.message) {
        const encoding = req.body.encoding || 'utf8';
        sourceCode = Buffer.from(req.body.message, encoding).toString();
    }
    
    // 如果 req.body.fqbn 或 req.body.config.fqbn 是物件，嘗試提取它裡面的字串值
    if (boardFqbn && typeof boardFqbn !== 'string') {
        boardFqbn = boardFqbn.fqbn || boardFqbn.board || Object.values(boardFqbn).find(v => typeof v === 'string') || JSON.stringify(boardFqbn);
    }
    
    if (!boardFqbn && req.body.config && req.body.config.fqbn) {
        const configFqbn = req.body.config.fqbn;
        if (typeof configFqbn === 'string') {
            boardFqbn = configFqbn;
        } else {
            console.log(`[Compile] config.fqbn is an object:`, JSON.stringify(configFqbn));
            // 嘗試找到任何字串值，或是直接預設為 esp32
            boardFqbn = configFqbn.fqbn || configFqbn.board || Object.values(configFqbn).find(v => typeof v === 'string' && v.includes('esp32')) || 'esp32:esp32:esp32:JTAGAdapter=default,PSRAM=disabled,PartitionScheme=default,CPUFreq=240,FlashMode=qio,FlashFreq=80,FlashSize=4M,UploadSpeed=460800,LoopCore=1,EventsCore=1,DebugLevel=none,EraseFlash=none,ZigbeeMode=default';
            console.log(`[Compile] Extracted boardFqbn from object: ${boardFqbn}`);
        }
    }
    
    // 如果真的還是沒有，因為我們現在都在燒 ESP32，先給一個預設值
    if (!boardFqbn) {
        boardFqbn = 'esp32:esp32:esp32:JTAGAdapter=default,PSRAM=disabled,PartitionScheme=default,CPUFreq=240,FlashMode=qio,FlashFreq=80,FlashSize=4M,UploadSpeed=460800,LoopCore=1,EventsCore=1,DebugLevel=none,EraseFlash=none,ZigbeeMode=default';
        console.warn(`[Compile] Warning: boardFqbn missing in payload, defaulting to full esp32 FQBN. Payload was:`, JSON.stringify(req.body).slice(0, 300));
    }
    
    // 確保最終是字串並去除空白
    if (typeof boardFqbn === 'string') {
        boardFqbn = boardFqbn.trim();
    }

    if (!sourceCode) {
        return res.status(400).json({ success: false, error: '缺少必要參數: code (原始碼)' });
    }
    if (!boardFqbn) {
        return res.status(400).json({ success: false, error: '缺少必要參數: board 或 fqbn (硬體版型)' });
    }

    const buildId = uuidv4();
    const tmpDir = path.join(os.tmpdir(), 'tubitblock-compile', buildId);
    const sketchDir = path.join(tmpDir, 'sketch');
    const buildDir = path.join(tmpDir, 'build');

    console.log(`[Compile] Build ${buildId} started for board: ${boardFqbn}`);
    console.log(`[Compile] Code length: ${sourceCode.length} chars`);
    console.log(`[Compile] Code preview: ${sourceCode.slice(0, 300).replace(/\n/g, '\\n')}`);

    try {
        fs.mkdirSync(sketchDir, { recursive: true });
        fs.mkdirSync(buildDir, { recursive: true });

        const sketchFile = path.join(sketchDir, 'sketch.ino');
        fs.writeFileSync(sketchFile, sourceCode, 'utf8');

        // 使用 shell exec (而非 execFile) 以正確捕捉 stderr+stdout
        const librariesFlag = libraries ? `--libraries "${libraries}"` : '';
        // 加雙引號包住 fqbn 防止有空白被切斷
        const cmd = `${ARDUINO_CLI} compile --fqbn "${boardFqbn}" ${librariesFlag} --build-path "${buildDir}" "${sketchDir}" 2>&1`;

        console.log(`[Compile] Running: ${cmd}`);

        const result = await new Promise((resolve, reject) => {
            exec(cmd, {
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024
            }, (error, stdout) => {
                // 使用 2>&1 合併 stderr 到 stdout，所以只需讀 stdout
                const output = stdout || '';
                if (error) {
                    reject({ exitCode: error.code, output, message: error.message });
                } else {
                    resolve({ output });
                }
            });
        });

        console.log(`[Compile] Build ${buildId} succeeded`);
        console.log('[Compile] output:', result.output.slice(0, 500));

        // 遞迴收集編譯產物 (.bin, .hex, .elf)
        const artifacts = {};
        collectArtifactsRecursive(buildDir, artifacts);

        if (Object.keys(artifacts).length === 0) {
            throw {
                output: `${result.output}\n⚠️ 編譯成功但找不到任何 .bin/.hex 產物，請確認 board FQBN 正確。`
            };
        }

        // 建構 flashAddresses：server 端明確指定每個 artifact 的 flash 燒錄地址，
        // 讓 client 不需依賴檔名猜測。
        const flashAddresses = {};
        const isEsp32Board = boardFqbn.toLowerCase().includes('esp32');

        if (isEsp32Board) {
            for (const name of Object.keys(artifacts)) {
                const bn = name.includes('/') ? name.split('/').pop() : name;
                if (bn.includes('bootloader'))                      flashAddresses[name] = 0x1000;
                else if (bn === 'boot_app0.bin')                    flashAddresses[name] = 0xe000;
                else if (bn.includes('partitions'))                 flashAddresses[name] = 0x8000;
                else if (bn.endsWith('.bin') && !bn.includes('merged'))  flashAddresses[name] = 0x10000;
                // merged.bin（所有分區合併的映像）不加入 flashAddresses，讓 client 跳過
                // .hex / .elf 不需要 flash 地址
            }

            // 注入 boot_app0.bin（OTA data 分區，0xe000）
            // 此檔案不在 arduino-cli 的 build 輸出目錄，需從 ESP32 core 讀取。
            // 沒有它，bootloader 無法確定從哪個 factory partition 啟動應用程式。
            const hasBootApp0 = Object.keys(artifacts).some(k => {
                const bn = k.includes('/') ? k.split('/').pop() : k;
                return bn === 'boot_app0.bin';
            });
            if (!hasBootApp0) {
                const bootApp0Path = findBootApp0();
                if (bootApp0Path) {
                    artifacts['boot_app0.bin'] = fs.readFileSync(bootApp0Path).toString('base64');
                    flashAddresses['boot_app0.bin'] = 0xe000;
                    console.log(`[Compile]   injected boot_app0.bin @ 0xe000 (${fs.statSync(bootApp0Path).size} bytes)`);
                } else {
                    console.warn('[Compile]   WARNING: boot_app0.bin not found! ESP32 may not boot after flashing.');
                }
            }
        }

        console.log(`[Compile] Build ${buildId} artifacts (${Object.keys(artifacts).length}):`, Object.keys(artifacts));
        console.log(`[Compile] flashAddresses:`, flashAddresses);

        res.json({
            success: true,
            buildId,
            board: boardFqbn,
            artifacts,
            flashAddresses,
            stdout: result.output || '',
            artifactCount: Object.keys(artifacts).length
        });

    } catch (err) {
        const errOutput = err.output || err.message || '未知編譯錯誤';
        console.error(`[Compile] Build ${buildId} FAILED`);
        console.error(`[Compile] Full error output:\n${errOutput.slice(0, 2000)}`);

        res.status(400).json({
            success: false,
            buildId,
            error: errOutput
        });

    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
});

// --- 列出已安裝的 Board ---
app.get('/boards', async (req, res) => {
    exec(`${ARDUINO_CLI} board listall --format json 2>&1`, { timeout: 30000 }, (err, stdout) => {
        if (err) return res.status(500).json({ success: false, error: stdout });
        try { res.json({ success: true, boards: JSON.parse(stdout) }); }
        catch (e) { res.status(500).json({ success: false, error: stdout }); }
    });
});

// --- 啟動伺服器 ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==============================================`);
    console.log(`  TubitBlock Compiler Server v1.1`);
    console.log(`  Listening on http://0.0.0.0:${PORT}`);
    console.log(`==============================================\n`);

    // 啟動時診斷
    exec(`${ARDUINO_CLI} version 2>&1`, (err, stdout) => {
        console.log('[Boot] arduino-cli:', err ? `NOT FOUND: ${err.message}` : stdout.trim());
    });
    exec(`${ARDUINO_CLI} core list 2>&1`, (err, stdout) => {
        console.log('[Boot] Installed cores:\n', err ? `ERROR: ${err.message}` : stdout);
    });
});
