# TubitBlock Online Compiler Server

線上 Arduino/ESP32 編譯伺服器，用於 TubitBlock Web 的遠端編譯服務。

## 本地開發

```bash
cd compiler-server
npm install
node server.js
```

伺服器會在 `http://localhost:3000` 啟動。

## Docker 部署

```bash
# 建置映像檔（首次需下載 ESP32 核心，約需 5-10 分鐘）
docker build -t tubitblock-compiler .

# 執行容器
docker run -p 3000:3000 tubitblock-compiler
```

## API 文件

### `POST /compile`

編譯 Arduino 程式碼。

**Request Body (JSON):**

```json
{
  "code": "void setup() { }\nvoid loop() { }",
  "board": "esp32:esp32:esp32"
}
```

或（GUI 相容格式）：

```json
{
  "message": "base64_encoded_code",
  "config": { "fqbn": "esp32:esp32:esp32" },
  "encoding": "base64"
}
```

**Response (成功):**

```json
{
  "success": true,
  "buildId": "uuid-string",
  "board": "esp32:esp32:esp32",
  "artifacts": {
    "sketch.ino.bin": "base64...",
    "sketch.ino.bootloader.bin": "base64...",
    "sketch.ino.partitions.bin": "base64..."
  },
  "artifactCount": 3
}
```

**Response (失敗):**

```json
{
  "success": false,
  "error": "arduino-cli 的錯誤訊息..."
}
```

### `GET /boards`

列出已安裝的開發板。

## 部署到雲端

此伺服器已設計為可直接部署到 Zeabur、Render 或 Railway 等服務。
只需將 `compiler-server/` 目錄指定為根目錄即可。
