/**
 * TubitBlock Online Compiler Server
 *
 * 接收前端 POST 的 Arduino 原始碼，呼叫 arduino-cli 進行編譯，
 * 將產生的 .bin / .hex 檔案以 Base64 回傳給前端。
 *
 * 設計原則：
 * - 每個編譯請求使用獨立的 UUID 暫存資料夾，確保併發安全。
 * - 編譯完畢（無論成功或失敗）後自動清除暫存資料夾。
 * - 支援 CORS，允許任何前端來源存取。
 */

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// arduino-cli 路徑，Docker 環境中安裝在 /usr/local/bin
const ARDUINO_CLI = process.env.ARDUINO_CLI_PATH || 'arduino-cli';

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '5mb' })); // Arduino 程式碼通常不會太大

// --- Health Check ---
app.get('/', (req, res) => {
    res.json({
        service: 'tubitblock-compiler-server',
        status: 'running',
        version: '1.0.0'
    });
});

// --- 編譯 API ---
app.post('/compile', async (req, res) => {
    const { code, board, fqbn, libraries } = req.body;

    // 支援多種輸入格式：
    // 格式 A (簡潔版): { code: "...", board: "esp32:esp32:esp32" }
    // 格式 B (GUI 相容): { message: "base64...", config: { fqbn: "..." }, encoding: "base64" }
    let sourceCode = code;
    let boardFqbn = fqbn || board;

    // 相容 LinkIntersector 的 params 格式
    if (!sourceCode && req.body.message) {
        const encoding = req.body.encoding || 'utf8';
        sourceCode = Buffer.from(req.body.message, encoding).toString();
    }
    if (!boardFqbn && req.body.config && req.body.config.fqbn) {
        boardFqbn = req.body.config.fqbn;
    }

    // 參數驗證
    if (!sourceCode) {
        return res.status(400).json({
            success: false,
            error: '缺少必要參數: code (原始碼)'
        });
    }
    if (!boardFqbn) {
        return res.status(400).json({
            success: false,
            error: '缺少必要參數: board 或 fqbn (硬體版型)'
        });
    }

    // 建立獨立的暫存資料夾 (UUID)
    const buildId = uuidv4();
    const tmpDir = path.join(os.tmpdir(), 'tubitblock-compile', buildId);
    const sketchDir = path.join(tmpDir, 'sketch');
    const buildDir = path.join(tmpDir, 'build');

    console.log(`[Compile] Build ${buildId} started for board: ${boardFqbn}`);

    try {
        // 1. 建立暫存目錄
        fs.mkdirSync(sketchDir, { recursive: true });
        fs.mkdirSync(buildDir, { recursive: true });

        // 2. 寫入 .ino 檔案（檔名必須與資料夾同名）
        const sketchFile = path.join(sketchDir, 'sketch.ino');
        fs.writeFileSync(sketchFile, sourceCode, 'utf8');

        // 3. 組裝 arduino-cli 編譯指令
        const args = [
            'compile',
            '--fqbn', boardFqbn,
            '--build-path', buildDir,
            sketchDir
        ];

        // 如果有指定額外函式庫路徑
        if (libraries) {
            args.push('--libraries', libraries);
        }

        console.log(`[Compile] Running: ${ARDUINO_CLI} ${args.join(' ')}`);

        // 4. 執行 arduino-cli compile
        const result = await new Promise((resolve, reject) => {
            execFile(ARDUINO_CLI, args, {
                timeout: 120000, // 2 分鐘超時
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            }, (error, stdout, stderr) => {
                if (error) {
                    reject({
                        exitCode: error.code,
                        stdout: stdout,
                        stderr: stderr,
                        message: error.message
                    });
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });

        console.log(`[Compile] Build ${buildId} succeeded`);
        if (result.stdout) console.log('[Compile] stdout:', result.stdout.slice(0, 500));

        // 5. 收集編譯產物 (.bin, .hex, .elf)
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
                stderr: '編譯成功但找不到任何產物檔案 (.bin/.hex)。請確認 board 設定正確。',
                stdout: result.stdout
            };
        }

        // 6. 回傳成功結果
        res.json({
            success: true,
            buildId: buildId,
            board: boardFqbn,
            artifacts: artifacts,
            stdout: result.stdout || '',
            artifactCount: Object.keys(artifacts).length
        });

    } catch (err) {
        console.error(`[Compile] Build ${buildId} FAILED:`, err.stderr || err.message);
        console.error(`[Compile] Failed Source Code length:`, sourceCode.length);
        console.error(`[Compile] First 300 chars:`, sourceCode.slice(0, 300));

        // 回傳編譯錯誤（包含 arduino-cli 的 stderr）
        res.status(400).json({
            success: false,
            buildId: buildId,
            error: err.stderr || err.message || '未知的編譯錯誤',
            stdout: err.stdout || ''
        });

    } finally {
        // 7. 清除暫存資料夾
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            console.log(`[Compile] Cleaned up temp dir for build ${buildId}`);
        } catch (cleanupErr) {
            console.warn(`[Compile] Failed to clean temp dir: ${cleanupErr.message}`);
        }
    }
});

// --- 查詢已安裝的 Board ---
app.get('/boards', async (req, res) => {
    try {
        const result = await new Promise((resolve, reject) => {
            execFile(ARDUINO_CLI, ['board', 'listall', '--format', 'json'], {
                timeout: 30000
            }, (error, stdout, stderr) => {
                if (error) reject({ stderr, message: error.message });
                else resolve(JSON.parse(stdout));
            });
        });
        res.json({ success: true, boards: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.stderr || err.message });
    }
});

// --- 啟動伺服器 ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==============================================`);
    console.log(`  TubitBlock Compiler Server`);
    console.log(`  Listening on http://0.0.0.0:${PORT}`);
    console.log(`  POST /compile  - 編譯 Arduino 程式碼`);
    console.log(`  GET  /boards   - 列出已安裝的開發板`);
    console.log(`==============================================\n`);
});
