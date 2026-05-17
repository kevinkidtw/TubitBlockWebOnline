/* eslint-disable func-style */
/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
function registerGenerators (Blockly) {

    // ── WiFi ──────────────────────────────────────────────────────────────

    Blockly.Arduino.tubitv2wifi_setup = function (block) {
        const ssid = Blockly.Arduino.valueToCode(block, 'SSID', Blockly.Arduino.ORDER_ATOMIC) || '""';
        const password = Blockly.Arduino.valueToCode(block, 'PASSWORD', Blockly.Arduino.ORDER_ATOMIC) || '""';

        Blockly.Arduino.definitions_['include_WiFi'] = '#include <WiFi.h>';
        Blockly.Arduino.definitions_['include_HTTPClient'] = '#include <HTTPClient.h>';
        Blockly.Arduino.definitions_['wifi_globals'] =
            `char _wifi_ssid[64];\nchar _wifi_pass[64];\nString _http_response = "";\nString _sheets_url = "";`;

        return `strncpy(_wifi_ssid, ${ssid}, 63);\nstrncpy(_wifi_pass, ${password}, 63);\n`;
    };

    Blockly.Arduino.tubitv2wifi_connect = function () {
        Blockly.Arduino.definitions_['include_WiFi'] = '#include <WiFi.h>';
        return `WiFi.begin(_wifi_ssid, _wifi_pass);\nwhile (WiFi.status() != WL_CONNECTED) { delay(500); }\n`;
    };

    Blockly.Arduino.tubitv2wifi_isConnected = function () {
        return ['(WiFi.status() == WL_CONNECTED)', Blockly.Arduino.ORDER_ATOMIC];
    };

    Blockly.Arduino.tubitv2wifi_getIP = function () {
        return ['WiFi.localIP().toString()', Blockly.Arduino.ORDER_ATOMIC];
    };

    // ── HTTP ──────────────────────────────────────────────────────────────

    Blockly.Arduino.tubitv2wifi_httpGet = function (block) {
        const url = Blockly.Arduino.valueToCode(block, 'URL', Blockly.Arduino.ORDER_ATOMIC) || '""';

        Blockly.Arduino.definitions_['include_HTTPClient'] = '#include <HTTPClient.h>';
        Blockly.Arduino.definitions_['wifi_globals'] =
            Blockly.Arduino.definitions_['wifi_globals'] ||
            `char _wifi_ssid[64];\nchar _wifi_pass[64];\nString _http_response = "";\nString _sheets_url = "";`;

        return (
            `{\n` +
            `  HTTPClient _http;\n` +
            `  _http.begin(${url});\n` +
            `  _http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);\n` +
            `  int _code = _http.GET();\n` +
            `  if (_code > 0) { _http_response = _http.getString(); }\n` +
            `  else { _http_response = ""; }\n` +
            `  _http.end();\n` +
            `}\n`
        );
    };

    Blockly.Arduino.tubitv2wifi_httpPost = function (block) {
        const url  = Blockly.Arduino.valueToCode(block, 'URL',  Blockly.Arduino.ORDER_ATOMIC) || '""';
        const data = Blockly.Arduino.valueToCode(block, 'DATA', Blockly.Arduino.ORDER_ATOMIC) || '""';

        Blockly.Arduino.definitions_['include_HTTPClient'] = '#include <HTTPClient.h>';

        return (
            `{\n` +
            `  HTTPClient _http;\n` +
            `  _http.begin(${url});\n` +
            `  _http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);\n` +
            `  _http.addHeader("Content-Type", "text/plain");\n` +
            `  int _code = _http.POST(${data});\n` +
            `  if (_code > 0) { _http_response = _http.getString(); }\n` +
            `  else { _http_response = ""; }\n` +
            `  _http.end();\n` +
            `}\n`
        );
    };

    Blockly.Arduino.tubitv2wifi_lastResponse = function () {
        return ['_http_response', Blockly.Arduino.ORDER_ATOMIC];
    };

    // ── Google 試算表 ──────────────────────────────────────────────────────

    Blockly.Arduino.tubitv2wifi_sheetsSetUrl = function (block) {
        const url = Blockly.Arduino.valueToCode(block, 'URL', Blockly.Arduino.ORDER_ATOMIC) || '""';

        Blockly.Arduino.definitions_['include_HTTPClient'] = '#include <HTTPClient.h>';
        Blockly.Arduino.definitions_['wifi_globals'] =
            Blockly.Arduino.definitions_['wifi_globals'] ||
            `char _wifi_ssid[64];\nchar _wifi_pass[64];\nString _http_response = "";\nString _sheets_url = "";`;

        return `_sheets_url = ${url};\n`;
    };

    Blockly.Arduino.tubitv2wifi_sheetsWrite = function (block) {
        const field = Blockly.Arduino.valueToCode(block, 'FIELD', Blockly.Arduino.ORDER_ATOMIC) || '""';
        const value = Blockly.Arduino.valueToCode(block, 'VALUE', Blockly.Arduino.ORDER_ATOMIC) || '""';

        Blockly.Arduino.definitions_['include_HTTPClient'] = '#include <HTTPClient.h>';

        return (
            `{\n` +
            `  HTTPClient _http;\n` +
            `  _http.begin(_sheets_url);\n` +
            `  _http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);\n` +
            `  _http.addHeader("Content-Type", "application/x-www-form-urlencoded");\n` +
            `  String _payload = "field=" + String(${field}) + "&value=" + String(${value});\n` +
            `  int _code = _http.POST(_payload);\n` +
            `  if (_code > 0) { _http_response = _http.getString(); }\n` +
            `  _http.end();\n` +
            `}\n`
        );
    };

    Blockly.Arduino.tubitv2wifi_sheetsRead = function (block) {
        const field = Blockly.Arduino.valueToCode(block, 'FIELD', Blockly.Arduino.ORDER_ATOMIC) || '""';

        Blockly.Arduino.definitions_['include_HTTPClient'] = '#include <HTTPClient.h>';
        // 宣告一個輔助函式，用 findFirstValue 解析 JSON {"value":"..."}
        Blockly.Arduino.definitions_['fn_sheetsReadField'] =
            `String _sheetsReadField(String url, String field) {\n` +
            `  HTTPClient _h;\n` +
            `  _h.begin(url + "?action=read&field=" + field);\n` +
            `  _h.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);\n` +
            `  int code = _h.GET();\n` +
            `  String result = "";\n` +
            `  if (code > 0) {\n` +
            `    String body = _h.getString();\n` +
            `    int vi = body.indexOf("\\"value\\":");\n` +
            `    if (vi >= 0) {\n` +
            `      int s = body.indexOf('"', vi + 8) + 1;\n` +
            `      int e = body.indexOf('"', s);\n` +
            `      if (s > 0 && e > s) result = body.substring(s, e);\n` +
            `    }\n` +
            `  }\n` +
            `  _h.end();\n` +
            `  return result;\n` +
            `}`;

        return [`_sheetsReadField(_sheets_url, ${field})`, Blockly.Arduino.ORDER_ATOMIC];
    };

    // ── MQTT ──────────────────────────────────────────────────────────────

    function ensureMqttGlobals () {
        Blockly.Arduino.definitions_['include_WiFi']       = '#include <WiFi.h>';
        Blockly.Arduino.definitions_['include_PubSubClient'] = '#include <PubSubClient.h>';
        Blockly.Arduino.definitions_['mqtt_globals'] =
            `WiFiClient _wifiClient;\n` +
            `PubSubClient _mqttClient(_wifiClient);\n` +
            `String _mqtt_last_msg = "";`;
        Blockly.Arduino.definitions_['mqtt_callback'] =
            `void _mqttCallback(char* topic, byte* payload, unsigned int length) {\n` +
            `  _mqtt_last_msg = "";\n` +
            `  for (unsigned int i = 0; i < length; i++) _mqtt_last_msg += (char)payload[i];\n` +
            `}`;
    }

    Blockly.Arduino.tubitv2wifi_mqttSetup = function (block) {
        const host = Blockly.Arduino.valueToCode(block, 'HOST', Blockly.Arduino.ORDER_ATOMIC) || '"broker.hivemq.com"';
        const port = Blockly.Arduino.valueToCode(block, 'PORT', Blockly.Arduino.ORDER_ATOMIC) || '1883';

        ensureMqttGlobals();

        return (
            `_mqttClient.setServer(${host}, ${port});\n` +
            `_mqttClient.setCallback(_mqttCallback);\n`
        );
    };

    Blockly.Arduino.tubitv2wifi_mqttConnect = function (block) {
        const clientId = Blockly.Arduino.valueToCode(block, 'CLIENT_ID', Blockly.Arduino.ORDER_ATOMIC) || '"ESP32Client"';

        ensureMqttGlobals();

        return (
            `if (!_mqttClient.connected()) {\n` +
            `  _mqttClient.connect(${clientId});\n` +
            `}\n`
        );
    };

    Blockly.Arduino.tubitv2wifi_mqttPublish = function (block) {
        const topic = Blockly.Arduino.valueToCode(block, 'TOPIC', Blockly.Arduino.ORDER_ATOMIC) || '""';
        const msg   = Blockly.Arduino.valueToCode(block, 'MSG',   Blockly.Arduino.ORDER_ATOMIC) || '""';

        ensureMqttGlobals();

        return `_mqttClient.publish(${topic}, String(${msg}).c_str());\n`;
    };

    Blockly.Arduino.tubitv2wifi_mqttSubscribe = function (block) {
        const topic = Blockly.Arduino.valueToCode(block, 'TOPIC', Blockly.Arduino.ORDER_ATOMIC) || '""';

        ensureMqttGlobals();

        return `_mqttClient.subscribe(${topic});\n`;
    };

    Blockly.Arduino.tubitv2wifi_mqttIsConnected = function () {
        return ['_mqttClient.connected()', Blockly.Arduino.ORDER_ATOMIC];
    };

    Blockly.Arduino.tubitv2wifi_mqttLoop = function () {
        ensureMqttGlobals();
        return `_mqttClient.loop();\n`;
    };

    Blockly.Arduino.tubitv2wifi_mqttLastMessage = function () {
        return ['_mqtt_last_msg', Blockly.Arduino.ORDER_ATOMIC];
    };

    return Blockly;
}

exports = registerGenerators;
