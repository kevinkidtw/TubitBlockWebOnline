/* eslint-disable func-style */
/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
function registerBlocks (Blockly) {
    const wifiColor      = '#1565C0';
    const httpColor      = '#00838F';
    const sheetsColor    = '#2E7D32';
    const mqttColor      = '#E65100';
    const thingspeakColor = '#7B1FA2';

    // ── WiFi ──────────────────────────────────────────────────────────────

    Blockly.Blocks.tubitv2wifi_setup = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_SETUP,
                args0: [
                    { type: 'input_value', name: 'SSID', check: 'String' },
                    { type: 'input_value', name: 'PASSWORD', check: 'String' }
                ],
                colour: wifiColor,
                secondaryColour: wifiColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_connect = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_CONNECT,
                colour: wifiColor,
                secondaryColour: wifiColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_isConnected = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_IS_CONNECTED,
                colour: wifiColor,
                secondaryColour: wifiColor,
                extensions: ['output_boolean']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_getIP = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_GET_IP,
                colour: wifiColor,
                secondaryColour: wifiColor,
                extensions: ['output_string']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_ntpSetup = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_NTP_SETUP,
                colour: wifiColor,
                secondaryColour: wifiColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_getTime = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_GET_TIME,
                colour: wifiColor,
                secondaryColour: wifiColor,
                extensions: ['output_string']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_getDate = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_GET_DATE,
                colour: wifiColor,
                secondaryColour: wifiColor,
                extensions: ['output_string']
            });
        }
    };

    // ── HTTP ──────────────────────────────────────────────────────────────

    Blockly.Blocks.tubitv2wifi_httpGet = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_HTTP_GET,
                args0: [
                    { type: 'input_value', name: 'URL', check: 'String' }
                ],
                colour: httpColor,
                secondaryColour: httpColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_httpPost = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_HTTP_POST,
                args0: [
                    { type: 'input_value', name: 'URL', check: 'String' },
                    { type: 'input_value', name: 'DATA', check: 'String' }
                ],
                colour: httpColor,
                secondaryColour: httpColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_lastResponse = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_LAST_RESPONSE,
                colour: httpColor,
                secondaryColour: httpColor,
                extensions: ['output_string']
            });
        }
    };

    // ── Google 試算表 ──────────────────────────────────────────────────────

    Blockly.Blocks.tubitv2wifi_sheetsSetUrl = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_SHEETS_SET_URL,
                args0: [
                    { type: 'input_value', name: 'URL', check: 'String' }
                ],
                colour: sheetsColor,
                secondaryColour: sheetsColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_sheetsWrite = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_SHEETS_WRITE,
                args0: [
                    { type: 'input_value', name: 'FIELD', check: 'String' },
                    { type: 'input_value', name: 'VALUE', check: 'String' }
                ],
                colour: sheetsColor,
                secondaryColour: sheetsColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_sheetsRead = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_SHEETS_READ,
                args0: [
                    { type: 'input_value', name: 'FIELD', check: 'String' }
                ],
                colour: sheetsColor,
                secondaryColour: sheetsColor,
                extensions: ['output_string']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_sheetsWriteRow = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_SHEETS_WRITE_ROW,
                args0: [
                    { type: 'input_value', name: 'VALUE1' },
                    { type: 'input_value', name: 'VALUE2' },
                    { type: 'input_value', name: 'VALUE3' },
                    { type: 'input_value', name: 'VALUE4' }
                ],
                colour: sheetsColor,
                secondaryColour: sheetsColor,
                extensions: ['shape_statement']
            });
        }
    };

    // ── MQTT ──────────────────────────────────────────────────────────────

    Blockly.Blocks.tubitv2wifi_mqttSetup = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_MQTT_SETUP,
                args0: [
                    { type: 'input_value', name: 'HOST', check: 'String' },
                    { type: 'input_value', name: 'PORT' }
                ],
                colour: mqttColor,
                secondaryColour: mqttColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_mqttConnect = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_MQTT_CONNECT,
                args0: [
                    { type: 'input_value', name: 'CLIENT_ID', check: 'String' }
                ],
                colour: mqttColor,
                secondaryColour: mqttColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_mqttPublish = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_MQTT_PUBLISH,
                args0: [
                    { type: 'input_value', name: 'TOPIC', check: 'String' },
                    { type: 'input_value', name: 'MSG', check: 'String' }
                ],
                colour: mqttColor,
                secondaryColour: mqttColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_mqttSubscribe = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_MQTT_SUBSCRIBE,
                args0: [
                    { type: 'input_value', name: 'TOPIC', check: 'String' }
                ],
                colour: mqttColor,
                secondaryColour: mqttColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_mqttIsConnected = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_MQTT_IS_CONNECTED,
                colour: mqttColor,
                secondaryColour: mqttColor,
                extensions: ['output_boolean']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_mqttLoop = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_MQTT_LOOP,
                colour: mqttColor,
                secondaryColour: mqttColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_mqttLastMessage = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_MQTT_LAST_MSG,
                colour: mqttColor,
                secondaryColour: mqttColor,
                extensions: ['output_string']
            });
        }
    };

    // ── ThingSpeak ────────────────────────────────────────────────────────

    Blockly.Blocks.tubitv2wifi_thingspeakSetup = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_TS_SETUP,
                args0: [
                    { type: 'input_value', name: 'WRITE_KEY', check: 'String' }
                ],
                colour: thingspeakColor,
                secondaryColour: thingspeakColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_thingspeakWrite = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_TS_WRITE,
                args0: [
                    { type: 'input_value', name: 'F1' },
                    { type: 'input_value', name: 'F2' },
                    { type: 'input_value', name: 'F3' },
                    { type: 'input_value', name: 'F4' }
                ],
                colour: thingspeakColor,
                secondaryColour: thingspeakColor,
                extensions: ['shape_statement']
            });
        }
    };

    Blockly.Blocks.tubitv2wifi_thingspeakRead = {
        init: function () {
            this.jsonInit({
                message0: Blockly.Msg.TUBITV2WIFI_TS_READ,
                args0: [
                    { type: 'input_value', name: 'CHANNEL_ID', check: 'String' },
                    { type: 'input_value', name: 'READ_KEY',   check: 'String' },
                    { type: 'input_value', name: 'FIELD_NO' }
                ],
                colour: thingspeakColor,
                secondaryColour: thingspeakColor,
                extensions: ['output_string']
            });
        }
    };

    return Blockly;
}

exports = registerBlocks;
