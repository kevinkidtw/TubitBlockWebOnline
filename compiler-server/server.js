/**
 * TubitBlock Online Compiler Server
 *
 * 接收前端 POST 的 Arduino 原始碼，呼叫 arduino-cli 進行編譯，
 * 將產生的 .bin / .hex 檔案以 Base64 回傳給前端。
 */

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { exec, execSync } = require('child_process');
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
    // arduino-cli 資料目錄因作業系統而異：
    //   macOS  → ~/Library/Arduino15
    //   Linux  → ~/.arduino15
    //   Windows→ %APPDATA%/Arduino15
    const candidates = [
        path.join(os.homedir(), 'Library', 'Arduino15'),   // macOS
        path.join(os.homedir(), '.arduino15'),              // Linux / Docker
        path.join(process.env.APPDATA || '', 'Arduino15'), // Windows
    ];
    let espHwBase = null;
    for (const base of candidates) {
        const p = path.join(base, 'packages', 'esp32', 'hardware', 'esp32');
        if (fs.existsSync(p)) { espHwBase = p; break; }
    }
    if (!espHwBase) return null;
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
 * 遞迴收集 buildDir 中的 .bin/.hex 檔案（排除 merged.bin 和 .elf，避免回應過大）。
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
        } else if (entry.endsWith('.bin') || entry.endsWith('.hex')) {
            // 排除 merged.bin（全分區合併映像，4MB+）和 .elf（偵錯用，11MB+），不需要燒錄且會讓 JSON 回應過大
            if (entry.includes('merged') || entry.endsWith('.elf')) continue;
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

// --- BLE Seed Build (暖機) 設定 ---
// Docker image build 時會預先編譯一次完整的 BLE sketch，把 build 產物保存在 /arduino-ble-seed。
// 如果該目錄存在，每次編譯前先 cp 到本次的 buildDir，arduino-cli 就只需重新編譯 sketch.ino，
// 其餘大型 library 的 .o 直接重用，速度從 ~90s 降到 ~15s。
const BLE_SEED_DIR = '/arduino-ble-seed';
let bleSeedAvailable = fs.existsSync(BLE_SEED_DIR) &&
    fs.readdirSync(BLE_SEED_DIR).length > 0;
if (bleSeedAvailable) {
    console.log(`[Boot] ✅ BLE seed build 已偵測到: ${BLE_SEED_DIR}`);
} else {
    console.log(`[Boot] ⚠️ BLE seed build 不存在 (${BLE_SEED_DIR})，首次 BLE 編譯將較慢`);
}

// --- 靜態產物快取 ---
// bootloader、partitions、boot_app0.bin 在 FQBN 不變的情況下每次都一樣，
// 不需要每次編譯後重新收集。在首次成功編譯後快取起來。
let staticArtifactCache = null;  // { artifacts: {name: base64}, flashAddresses: {name: addr} }

/**
 * 從 seed build 或首次成功 build 中提取不會變的靜態產物（bootloader, partitions, boot_app0）。
 * @param {string} buildDir 編譯輸出目錄
 * @returns {{artifacts: Object, flashAddresses: Object} | null}
 */
function extractStaticArtifacts(buildDir) {
    const staticFiles = {};
    const staticAddresses = {};

    if (!fs.existsSync(buildDir)) return null;

    // 遞迴搜尋 buildDir 中的靜態檔案
    function scan(dir, prefix) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                scan(full, prefix ? `${prefix}/${entry}` : entry);
            } else if (entry.endsWith('.bin')) {
                const key = prefix ? `${prefix}/${entry}` : entry;
                if (entry.includes('bootloader')) {
                    staticFiles[key] = fs.readFileSync(full).toString('base64');
                    staticAddresses[key] = 0x1000;
                    console.log(`[Cache] 快取靜態產物: ${key} (${stat.size} bytes) → 0x1000`);
                } else if (entry.includes('partitions')) {
                    staticFiles[key] = fs.readFileSync(full).toString('base64');
                    staticAddresses[key] = 0x8000;
                    console.log(`[Cache] 快取靜態產物: ${key} (${stat.size} bytes) → 0x8000`);
                }
            }
        }
    }
    scan(buildDir, '');

    // boot_app0.bin（不在 build 目錄中，從 ESP32 core 讀取）
    const bootApp0Path = findBootApp0();
    if (bootApp0Path) {
        staticFiles['boot_app0.bin'] = fs.readFileSync(bootApp0Path).toString('base64');
        staticAddresses['boot_app0.bin'] = 0xe000;
        console.log(`[Cache] 快取靜態產物: boot_app0.bin (${fs.statSync(bootApp0Path).size} bytes) → 0xe000`);
    }

    if (Object.keys(staticFiles).length > 0) {
        return { artifacts: staticFiles, flashAddresses: staticAddresses };
    }
    return null;
}

// 嘗試從 seed build 中預先提取靜態產物
if (bleSeedAvailable) {
    staticArtifactCache = extractStaticArtifacts(BLE_SEED_DIR);
    if (staticArtifactCache) {
        console.log(`[Boot] ✅ 已從 seed build 預先快取 ${Object.keys(staticArtifactCache.artifacts).length} 個靜態產物`);
    }
}

/**
 * 將 seed build 目錄複製到目標 buildDir，實現增量編譯。
 * 使用系統 cp 指令以獲得最佳效能（避免 Node.js 逐檔複製的開銷）。
 * @param {string} targetBuildDir 目標 build 目錄
 * @returns {boolean} 是否成功複製
 */
function copySeedBuild(targetBuildDir, sketchDir) {
    if (!bleSeedAvailable) return false;
    try {
        const start = Date.now();
        if (process.platform === 'win32') {
            execSync(`xcopy /E /I /Q /Y "${BLE_SEED_DIR}" "${targetBuildDir}"`, { stdio: 'ignore' });
        } else {
            // cp -a 保留 timestamp（讓 arduino-cli 的增量編譯判斷生效）
            execSync(`cp -a "${BLE_SEED_DIR}/." "${targetBuildDir}/"`, { stdio: 'ignore' });
        }
        const elapsed = Date.now() - start;

        // 修補 build.options.json：把 sketchLocation 換成本次的 sketch 路徑。
        // 重要：只修改 sketchLocation，其他欄位（如 otherLibrariesFolders）
        // 必須與 student compile 完全一致，否則 arduino-cli 會認為設定已變更而重編所有 .o。
        // 這也是為何 Dockerfile 暖機指令不能加 --libraries 旗標：
        // 加了之後 build.options.json 會多一個 libraries 欄位，與 student compile 不符。
        const buildOptionsPath = path.join(targetBuildDir, 'build.options.json');
        if (fs.existsSync(buildOptionsPath) && sketchDir) {
            try {
                const opts = JSON.parse(fs.readFileSync(buildOptionsPath, 'utf8'));
                opts.sketchLocation = sketchDir;
                fs.writeFileSync(buildOptionsPath, JSON.stringify(opts, null, '  '), 'utf8');
                console.log(`[Compile] ✅ build.options.json sketchLocation 已修補`);
            } catch (patchErr) {
                console.warn(`[Compile] ⚠️ 無法更新 build.options.json: ${patchErr.message}`);
            }
        }

        // 修補所有 .d 依賴檔案：把 seed 的舊路徑換成新的 buildDir 路徑。
        // .d 檔案格式：第一行是 "<target-path>/<file>.o: ..."
        // arduino-cli 用 target-path 來驗證 .o 是否屬於當前 build，
        // 若路徑不符就判定快取無效並強制全部重編。
        try {
            execSync(
                `find "${targetBuildDir}" -name "*.d" | xargs sed -i "s|${BLE_SEED_DIR}/|${targetBuildDir}/|g"`,
                { stdio: 'ignore' }
            );
        } catch (sedErr) {
            console.warn(`[Compile] ⚠️ 修補 .d 檔案失敗（不影響功能，但增量編譯可能失效）: ${sedErr.message}`);
        }

        console.log(`[Compile] ✅ Seed build 已複製並修補 .d 路徑 (${elapsed}ms)`);
        return true;
    } catch (e) {
        console.warn(`[Compile] ⚠️ 複製 seed build 失敗: ${e.message}`);
        return false;
    }
}

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
    
    // 從平台物件 {darwin:..., linux:..., win32:...} 中選出當前平台的 FQBN
    function extractFqbn(val) {
        if (!val) return null;
        if (typeof val === 'string') return val;
        // 優先用當前平台的 key，其次 linux，最後任意字串值
        const platform = process.platform; // 'win32' | 'darwin' | 'linux'
        if (val[platform] && typeof val[platform] === 'string') return val[platform];
        if (val['linux']  && typeof val['linux']  === 'string') return val['linux'];
        return Object.values(val).find(v => typeof v === 'string') || null;
    }

    if (boardFqbn && typeof boardFqbn !== 'string') {
        boardFqbn = extractFqbn(boardFqbn);
    }

    if (!boardFqbn && req.body.config && req.body.config.fqbn) {
        const configFqbn = req.body.config.fqbn;
        console.log(`[Compile] config.fqbn from object:`, JSON.stringify(configFqbn));
        boardFqbn = extractFqbn(configFqbn);
        console.log(`[Compile] Extracted boardFqbn from object: ${boardFqbn}`);
    }
    
    // 如果真的還是沒有，因為我們現在都在燒 ESP32，先給一個預設值
    if (!boardFqbn) {
        const uploadSpeed = process.platform === 'win32' ? '921600' : '460800';
        boardFqbn = `esp32:esp32:esp32:JTAGAdapter=default,PSRAM=disabled,PartitionScheme=default,CPUFreq=240,FlashMode=qio,FlashFreq=80,FlashSize=4M,UploadSpeed=${uploadSpeed},LoopCore=1,EventsCore=1,DebugLevel=none,EraseFlash=none,ZigbeeMode=default`;
        console.warn(`[Compile] Warning: boardFqbn missing in payload, defaulting to full esp32 FQBN. Payload was:`, JSON.stringify(req.body).slice(0, 300));
    }
    
    // 確保最終是字串並去除空白
    if (typeof boardFqbn === 'string') {
        boardFqbn = boardFqbn.trim();
    }

    // Windows arduino-cli 不接受 UploadSpeed=460800，強制替換為 921600
    if (process.platform === 'win32' && typeof boardFqbn === 'string') {
        boardFqbn = boardFqbn.replace(/UploadSpeed=460800/g, 'UploadSpeed=921600');
    }

    if (!sourceCode) {
        return res.status(400).json({ success: false, error: '缺少必要參數: code (原始碼)' });
    }
    if (!boardFqbn) {
        return res.status(400).json({ success: false, error: '缺少必要參數: board 或 fqbn (硬體版型)' });
    }

    const buildId = uuidv4();
    // Windows：os.tmpdir() 可能含中文路徑（如 C:\Users\教師\...），
    // 導致 esp32 core 3.1.x 的 Rust toolchain wrapper 以 ANSI API 解析時 panic（Error code 123）。
    // 固定使用 ASCII 路徑 C:\TubitBlock\build\ 完全繞過此問題。
    const buildRoot = process.platform === 'win32'
        ? 'C:\\TubitBlock\\build'
        : path.join(os.tmpdir(), 'tubitblock-compile');
    const tmpDir = path.join(buildRoot, buildId);
    const sketchDir = path.join(tmpDir, 'sketch');
    const buildDir = path.join(tmpDir, 'build');

    console.log(`[Compile] Build ${buildId} started for board: ${boardFqbn}`);
    console.log(`[Compile] Code length: ${sourceCode.length} chars`);
    console.log(`[Compile] Code preview: ${sourceCode.slice(0, 300).replace(/\n/g, '\\n')}`);

    try {
        fs.mkdirSync(sketchDir, { recursive: true });
        fs.mkdirSync(buildDir, { recursive: true });

        // === 暖機加速：複製 seed build 到本次的 buildDir ===
        // 如果有 BLE seed build，先將預編譯好的 .o 檔案複製過來，
        // 讓 arduino-cli 進行增量編譯（只重編 sketch.ino，跳過已編譯的 library）
        const isEsp32 = boardFqbn.toLowerCase().includes('esp32');
        let seedUsed = false;
        if (isEsp32) {
            seedUsed = copySeedBuild(buildDir, sketchDir);
        }

        // TubitBlock 產生的程式碼有時會把 #include 放在 setup()/loop() 之後，
        // 這在 C++ 中是非法的。將所有 #include 行提到最頂端。
        {
            const lines = sourceCode.split('\n');
            const includes = lines.filter(l => /^\s*#include\s/.test(l));
            const rest     = lines.filter(l => !/^\s*#include\s/.test(l));
            if (includes.length > 0) {
                sourceCode = includes.join('\n') + '\n' + rest.join('\n');
                console.log(`[Compile] Hoisted ${includes.length} #include(s) to top`);
            }
        }

        if (!/void\s+setup\s*\(\s*\)/.test(sourceCode)) {
            sourceCode += '\nvoid setup() {\n}\n';
            console.log(`[Compile] Injected missing void setup()`);
        }
        if (!/void\s+loop\s*\(\s*\)/.test(sourceCode)) {
            sourceCode += '\nvoid loop() {\n}\n';
            console.log(`[Compile] Injected missing void loop()`);
        }

        // 補全缺少的結尾大括號（TubitBlock 有時會少產生一個 }）
        {
            const opens  = (sourceCode.match(/\{/g) || []).length;
            const closes = (sourceCode.match(/\}/g) || []).length;
            const diff = opens - closes;
            if (diff > 0) {
                sourceCode += '\n' + '}'.repeat(diff);
                console.log(`[Compile] Appended ${diff} missing closing brace(s)`);
            }
        }

        const sketchFile = path.join(sketchDir, 'sketch.ino');
        fs.writeFileSync(sketchFile, sourceCode, 'utf8');

        // 使用 shell exec (而非 execFile) 以正確捕捉 stderr+stdout
        // 自動偵測 custom_libraries 資料夾（與 server.js 同目錄）
        const customLibDir = path.join(__dirname, 'custom_libraries');
        let librariesFlag = '';
        if (libraries) {
            librariesFlag = `--libraries "${libraries}"`;
        } else if (fs.existsSync(customLibDir)) {
            librariesFlag = `--libraries "${customLibDir}"`;
            console.log(`[Compile] 自動載入自訂函式庫: ${customLibDir}`);
        }
        // 所有路徑加雙引號，防止路徑含空白（Windows 使用者名稱可能含空白）
        const buildCacheDir = fs.existsSync('/arduino-cache') ? '/arduino-cache'
            : path.join(require('os').tmpdir(), 'arduino-build-cache');
        const cmd = `"${ARDUINO_CLI}" compile --fqbn "${boardFqbn}" ${librariesFlag} --build-cache-path "${buildCacheDir}" --build-path "${buildDir}" "${sketchDir}" 2>&1`;

        console.log(`[Compile] Running: ${cmd}`);
        const compileStart = Date.now();

        const result = await new Promise((resolve, reject) => {
            exec(cmd, {
                timeout: 300000,  // BLE 首次編譯約需 2 分鐘，設 5 分鐘留足餘量
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

        const compileElapsed = Date.now() - compileStart;
        console.log(`[Compile] Build ${buildId} succeeded in ${compileElapsed}ms${seedUsed ? ' (seed-accelerated)' : ''}`);
        console.log('[Compile] output:', result.output.slice(0, 500));

        // 遞迴收集編譯產物 (.bin, .hex, .elf)
        const artifacts = {};
        collectArtifactsRecursive(buildDir, artifacts);

        if (Object.keys(artifacts).length === 0) {
            throw {
                output: `${result.output}\n⚠️ 編譯成功但找不到任何 .bin/.hex 產物，請確認 board FQBN 正確。`
            };
        }

        // 建構 flashAddresses：server 端明確指定每個 artifact 的 flash 燒錄地址
        const flashAddresses = {};
        const isEsp32Board = boardFqbn.toLowerCase().includes('esp32');

        if (isEsp32Board) {
            // === 靜態產物快取策略 ===
            // bootloader、partitions、boot_app0.bin 在 FQBN 不變時內容完全一樣。
            // 如果已有快取，直接合併進去，不需要從 buildDir 重新讀取。
            // 如果沒有快取，先從這次的 buildDir 提取並建立快取。
            if (!staticArtifactCache) {
                staticArtifactCache = extractStaticArtifacts(buildDir);
                if (staticArtifactCache) {
                    console.log(`[Cache] ✅ 首次編譯完成，已快取 ${Object.keys(staticArtifactCache.artifacts).length} 個靜態產物`);
                }
            }

            // 合併靜態快取到本次 artifacts
            if (staticArtifactCache) {
                for (const [name, data] of Object.entries(staticArtifactCache.artifacts)) {
                    if (!artifacts[name]) {
                        artifacts[name] = data;
                        console.log(`[Compile]   injected cached: ${name} → 0x${staticArtifactCache.flashAddresses[name].toString(16)}`);
                    }
                }
                Object.assign(flashAddresses, staticArtifactCache.flashAddresses);
            }

            // 為非靜態產物（sketch.ino.bin 等）設定 flash 地址
            for (const name of Object.keys(artifacts)) {
                if (flashAddresses[name] !== undefined) continue; // 已在靜態快取中
                const bn = name.includes('/') ? name.split('/').pop() : name;
                if (bn.includes('bootloader'))                          flashAddresses[name] = 0x1000;
                else if (bn === 'boot_app0.bin')                        flashAddresses[name] = 0xe000;
                else if (bn.includes('partitions'))                     flashAddresses[name] = 0x8000;
                else if (bn.endsWith('.bin') && !bn.includes('merged')) flashAddresses[name] = 0x10000;
            }

            // 如果靜態快取中沒有 boot_app0.bin，嘗試注入
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
    console.log(`  TubitBlock Compiler Server v1.2`);
    console.log(`  Listening on http://0.0.0.0:${PORT}`);
    console.log(`  BLE Seed: ${bleSeedAvailable ? '✅ Ready' : '⚠️ Not available'}`);
    console.log(`  Static Cache: ${staticArtifactCache ? '✅ ' + Object.keys(staticArtifactCache.artifacts).length + ' files' : '⚠️ Pending first compile'}`);
    console.log(`==============================================\n`);

    // 啟動時診斷
    exec(`${ARDUINO_CLI} version 2>&1`, (err, stdout) => {
        console.log('[Boot] arduino-cli:', err ? `NOT FOUND: ${err.message}` : stdout.trim());
    });
    exec(`${ARDUINO_CLI} core list 2>&1`, (err, stdout) => {
        console.log('[Boot] Installed cores:\n', err ? `ERROR: ${err.message}` : stdout);
    });

    // --- 非 Docker 環境：嘗試自動暖機 ---
    // 如果沒有 seed build（本機開發環境），在伺服器啟動後背景執行一次暖機編譯。
    // 這樣第一個學生的編譯請求就能享受到增量編譯的加速。
    if (!bleSeedAvailable) {
        const warmupSketch = path.join(__dirname, 'ble_warmup');
        if (fs.existsSync(path.join(warmupSketch, 'sketch.ino'))) {
            console.log('[Boot] 🔥 啟動背景暖機編譯（本機模式）...');
            const localSeedDir = path.join(os.tmpdir(), 'tubitblock-ble-seed');
            const localCacheDir = path.join(os.tmpdir(), 'arduino-build-cache');
            fs.mkdirSync(localSeedDir, { recursive: true });
            fs.mkdirSync(localCacheDir, { recursive: true });

            const customLibDir = path.join(__dirname, 'custom_libraries');
            const libFlag = fs.existsSync(customLibDir) ? `--libraries "${customLibDir}"` : '';
            const defaultFqbn = 'esp32:esp32:esp32:JTAGAdapter=default,PSRAM=disabled,PartitionScheme=default,CPUFreq=240,FlashMode=qio,FlashFreq=80,FlashSize=4M,UploadSpeed=460800,LoopCore=1,EventsCore=1,DebugLevel=none,EraseFlash=none,ZigbeeMode=default';

            const warmCmd = `"${ARDUINO_CLI}" compile --fqbn "${defaultFqbn}" ${libFlag} --build-cache-path "${localCacheDir}" --build-path "${localSeedDir}" "${warmupSketch}" 2>&1`;
            console.log(`[Boot] Warmup cmd: ${warmCmd.slice(0, 200)}...`);

            const warmStart = Date.now();
            exec(warmCmd, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                const elapsed = Math.round((Date.now() - warmStart) / 1000);
                if (err) {
                    console.error(`[Boot] ❌ 暖機編譯失敗 (${elapsed}s): ${(stdout || err.message).slice(0, 500)}`);
                } else {
                    console.log(`[Boot] ✅ 暖機編譯完成 (${elapsed}s)`);
                    // 更新全域狀態，讓後續編譯請求可以使用 seed
                    bleSeedAvailable = true;
                    // 將 BLE_SEED_DIR 指向本地 seed（透過修改 copySeedBuild 的來源）
                    // 由於 BLE_SEED_DIR 是 const，改用動態檢查
                    try {
                        // 建立 symlink 讓 copySeedBuild 可以找到
                        if (!fs.existsSync(BLE_SEED_DIR)) {
                            fs.symlinkSync(localSeedDir, BLE_SEED_DIR);
                            console.log(`[Boot] 已建立 symlink: ${BLE_SEED_DIR} → ${localSeedDir}`);
                        }
                    } catch (linkErr) {
                        // symlink 失敗（可能沒權限），直接複製
                        console.log(`[Boot] Symlink 失敗，直接使用本地 seed: ${localSeedDir}`);
                    }

                    // 提取靜態產物快取
                    if (!staticArtifactCache) {
                        staticArtifactCache = extractStaticArtifacts(localSeedDir);
                        if (staticArtifactCache) {
                            console.log(`[Boot] ✅ 已從暖機結果快取 ${Object.keys(staticArtifactCache.artifacts).length} 個靜態產物`);
                        }
                    }
                }
            });
        }
    }
});
