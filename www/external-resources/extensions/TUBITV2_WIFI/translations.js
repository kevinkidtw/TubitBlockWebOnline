// This file was automatically generated.  Do not modify.
/* eslint-disable func-style */
/* eslint-disable require-jsdoc */
/* eslint-disable quote-props */
/* eslint-disable quotes */
/* eslint-disable dot-notation */

function getInterfaceTranslations () {
    return {
        "en": {
            "tubitv2wifi.name": "WiFi / IoT",
            "tubitv2wifi.description": "ESP32 WiFi, HTTP, NTP time, Google Sheets, ThingSpeak, MQTT IoT blocks."
        },
        "zh-cn": {
            "tubitv2wifi.name": "WiFi / IoT",
            "tubitv2wifi.description": "ESP32 WiFi连线、HTTP请求、NTP网络时间、Google表格、ThingSpeak、MQTT物联网积木。"
        },
        "zh-tw": {
            "tubitv2wifi.name": "WiFi / IoT",
            "tubitv2wifi.description": "ESP32 WiFi 連線、HTTP 請求、NTP 網路時間、Google 試算表、ThingSpeak、MQTT 物聯網積木。"
        }
    };
}

function registerScratchExtensionTranslations () {
    return {};
}

function registerBlocksMessages (Blockly) {

    Object.assign(Blockly.ScratchMsgs.locales["en"], {
        "TUBITV2WIFI_CATEGORY_WIFI":    "WiFi",
        "TUBITV2WIFI_CATEGORY_HTTP":    "HTTP",
        "TUBITV2WIFI_CATEGORY_SHEETS":  "Google Sheets",
        "TUBITV2WIFI_CATEGORY_MQTT":    "MQTT",

        "TUBITV2WIFI_SETUP":            "set WiFi SSID %1 password %2",
        "TUBITV2WIFI_CONNECT":          "connect WiFi (wait until connected)",
        "TUBITV2WIFI_IS_CONNECTED":     "WiFi connected?",
        "TUBITV2WIFI_GET_IP":           "get IP address",

        "TUBITV2WIFI_HTTP_GET":         "HTTP GET %1",
        "TUBITV2WIFI_HTTP_POST":        "HTTP POST %1 data %2",
        "TUBITV2WIFI_LAST_RESPONSE":    "last HTTP response",

        "TUBITV2WIFI_SHEETS_SET_URL":   "set Google Sheets URL %1",
        "TUBITV2WIFI_SHEETS_WRITE":     "write to Sheets field %1 value %2",
        "TUBITV2WIFI_SHEETS_READ":      "read from Sheets field %1",

        "TUBITV2WIFI_MQTT_SETUP":       "set MQTT broker %1 port %2",
        "TUBITV2WIFI_MQTT_CONNECT":     "connect MQTT client ID %1",
        "TUBITV2WIFI_MQTT_PUBLISH":     "publish topic %1 message %2",
        "TUBITV2WIFI_MQTT_SUBSCRIBE":   "subscribe topic %1",
        "TUBITV2WIFI_MQTT_IS_CONNECTED":"MQTT connected?",
        "TUBITV2WIFI_MQTT_LOOP":        "MQTT keep alive (run in loop)",
        "TUBITV2WIFI_MQTT_LAST_MSG":    "last MQTT message",

        "TUBITV2WIFI_CATEGORY_NTP":     "NTP Time",
        "TUBITV2WIFI_NTP_SETUP":        "sync NTP time (Taiwan UTC+8)",
        "TUBITV2WIFI_GET_TIME":         "get time HH:MM:SS",
        "TUBITV2WIFI_GET_DATE":         "get date YYYY-MM-DD",

        "TUBITV2WIFI_SHEETS_WRITE_ROW": "write row col1 %1 col2 %2 col3 %3 col4 %4",

        "TUBITV2WIFI_CATEGORY_TS":      "ThingSpeak",
        "TUBITV2WIFI_TS_SETUP":         "set ThingSpeak Write Key %1",
        "TUBITV2WIFI_TS_WRITE":         "upload field1=%1 field2=%2 field3=%3 field4=%4",
        "TUBITV2WIFI_TS_READ":          "read channel %1 ReadKey %2 field %3"
    });

    Object.assign(Blockly.ScratchMsgs.locales["zh-cn"], {
        "TUBITV2WIFI_CATEGORY_WIFI":    "WiFi",
        "TUBITV2WIFI_CATEGORY_HTTP":    "HTTP",
        "TUBITV2WIFI_CATEGORY_SHEETS":  "Google表格",
        "TUBITV2WIFI_CATEGORY_MQTT":    "MQTT",

        "TUBITV2WIFI_SETUP":            "设置 WiFi 名称 %1 密码 %2",
        "TUBITV2WIFI_CONNECT":          "连接 WiFi（等待连线完成）",
        "TUBITV2WIFI_IS_CONNECTED":     "WiFi 已连线？",
        "TUBITV2WIFI_GET_IP":           "取得 IP 位址",

        "TUBITV2WIFI_HTTP_GET":         "HTTP GET %1",
        "TUBITV2WIFI_HTTP_POST":        "HTTP POST %1 资料 %2",
        "TUBITV2WIFI_LAST_RESPONSE":    "上次 HTTP 回应",

        "TUBITV2WIFI_SHEETS_SET_URL":   "设定试算表网址 %1",
        "TUBITV2WIFI_SHEETS_WRITE":     "写入试算表 栏位 %1 值 %2",
        "TUBITV2WIFI_SHEETS_READ":      "读取试算表 栏位 %1",

        "TUBITV2WIFI_MQTT_SETUP":       "设定 MQTT Broker %1 埠 %2",
        "TUBITV2WIFI_MQTT_CONNECT":     "连接 MQTT 名称 %1",
        "TUBITV2WIFI_MQTT_PUBLISH":     "发布 主题 %1 讯息 %2",
        "TUBITV2WIFI_MQTT_SUBSCRIBE":   "订阅 主题 %1",
        "TUBITV2WIFI_MQTT_IS_CONNECTED":"MQTT 已连线？",
        "TUBITV2WIFI_MQTT_LOOP":        "MQTT 持续运行（放在重复执行中）",
        "TUBITV2WIFI_MQTT_LAST_MSG":    "最后收到的 MQTT 讯息",

        "TUBITV2WIFI_CATEGORY_NTP":     "网络时间",
        "TUBITV2WIFI_NTP_SETUP":        "同步网络时间（台湾 UTC+8）",
        "TUBITV2WIFI_GET_TIME":         "取得时间 HH:MM:SS",
        "TUBITV2WIFI_GET_DATE":         "取得日期 YYYY-MM-DD",

        "TUBITV2WIFI_SHEETS_WRITE_ROW": "写入一行资料 第1欄 %1 第2欄 %2 第3欄 %3 第4欄 %4",

        "TUBITV2WIFI_CATEGORY_TS":      "ThingSpeak",
        "TUBITV2WIFI_TS_SETUP":         "设定 ThingSpeak Write Key %1",
        "TUBITV2WIFI_TS_WRITE":         "上传 field1=%1 field2=%2 field3=%3 field4=%4",
        "TUBITV2WIFI_TS_READ":          "读取频道 %1 ReadKey %2 第 %3 欄位"
    });

    Object.assign(Blockly.ScratchMsgs.locales["zh-tw"], {
        "TUBITV2WIFI_CATEGORY_WIFI":    "WiFi",
        "TUBITV2WIFI_CATEGORY_HTTP":    "HTTP",
        "TUBITV2WIFI_CATEGORY_SHEETS":  "Google 試算表",
        "TUBITV2WIFI_CATEGORY_MQTT":    "MQTT",

        "TUBITV2WIFI_SETUP":            "設定 WiFi 名稱 %1 密碼 %2",
        "TUBITV2WIFI_CONNECT":          "連接 WiFi（等待連線完成）",
        "TUBITV2WIFI_IS_CONNECTED":     "WiFi 已連線？",
        "TUBITV2WIFI_GET_IP":           "取得 IP 位址",

        "TUBITV2WIFI_HTTP_GET":         "HTTP GET %1",
        "TUBITV2WIFI_HTTP_POST":        "HTTP POST %1 資料 %2",
        "TUBITV2WIFI_LAST_RESPONSE":    "上次 HTTP 回應",

        "TUBITV2WIFI_SHEETS_SET_URL":   "設定試算表網址 %1",
        "TUBITV2WIFI_SHEETS_WRITE":     "寫入試算表 欄位 %1 值 %2",
        "TUBITV2WIFI_SHEETS_READ":      "讀取試算表 欄位 %1",

        "TUBITV2WIFI_MQTT_SETUP":       "設定 MQTT Broker %1 埠 %2",
        "TUBITV2WIFI_MQTT_CONNECT":     "連接 MQTT 名稱 %1",
        "TUBITV2WIFI_MQTT_PUBLISH":     "發佈 主題 %1 訊息 %2",
        "TUBITV2WIFI_MQTT_SUBSCRIBE":   "訂閱 主題 %1",
        "TUBITV2WIFI_MQTT_IS_CONNECTED":"MQTT 已連線？",
        "TUBITV2WIFI_MQTT_LOOP":        "MQTT 持續運行（放在重複執行中）",
        "TUBITV2WIFI_MQTT_LAST_MSG":    "最後收到的 MQTT 訊息",

        "TUBITV2WIFI_CATEGORY_NTP":     "網路時間",
        "TUBITV2WIFI_NTP_SETUP":        "同步網路時間（台灣 UTC+8）",
        "TUBITV2WIFI_GET_TIME":         "取得時間 HH:MM:SS",
        "TUBITV2WIFI_GET_DATE":         "取得日期 YYYY-MM-DD",

        "TUBITV2WIFI_SHEETS_WRITE_ROW": "寫入一行資料 第1欄 %1 第2欄 %2 第3欄 %3 第4欄 %4",

        "TUBITV2WIFI_CATEGORY_TS":      "ThingSpeak",
        "TUBITV2WIFI_TS_SETUP":         "設定 ThingSpeak Write Key %1",
        "TUBITV2WIFI_TS_WRITE":         "上傳 field1=%1 field2=%2 field3=%3 field4=%4",
        "TUBITV2WIFI_TS_READ":          "讀取頻道 %1 ReadKey %2 第 %3 欄位"
    });

    return Blockly;
}

if (typeof module !== 'undefined') {
    module.exports = {getInterfaceTranslations};
}

exports = registerScratchExtensionTranslations;
exports = registerBlocksMessages;
