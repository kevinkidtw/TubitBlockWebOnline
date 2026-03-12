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
        boardFqbn = typeof configFqbn === 'string' ? configFqbn : configFqbn.fqbn || configFqbn.board || '';
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

        // 收集編譯產物 (.bin, .hex, .elf)
        const artifacts = {};
        if (fs.existsSync(buildDir)) {
            const files = fs.readdirSync(buildDir);
            for (const file of files) {
                if (file.endsWith('.bin') || file.endsWith('.hex') || file.endsWith('.elf')) {
                    const filePath = path.join(buildDir, file);
                    const stat = fs.statSync(filePath);
                    if (stat.isFile()) {
                        artifacts[file] = fs.readFileSync(filePath).toString('base64');
                        console.log(`[Compile]   artifact: ${file} (${stat.size} bytes)`);
                    }
                }
            }
        }

        if (Object.keys(artifacts).length === 0) {
            throw {
                output: `${result.output}\n⚠️ 編譯成功但找不到任何 .bin/.hex 產物，請確認 board FQBN 正確。`
            };
        }

        res.json({
            success: true,
            buildId,
            board: boardFqbn,
            artifacts,
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
