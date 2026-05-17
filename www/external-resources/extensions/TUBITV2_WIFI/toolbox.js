/* eslint-disable func-style */
/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
function registerToolboxs () {
    return `
    <category name="%{BKY_TUBITV2WIFI_CATEGORY_WIFI}" id="TUBITV2WIFI_CATEGORY_WIFI" colour="#1565C0" secondaryColour="#1565C0" iconURI="../external-resources/extensions/TUBITV2_WIFI/assets/wifi.png">

      <block type="tubitv2wifi_setup" id="tubitv2wifi_setup">
        <value name="SSID">
          <shadow type="text"><field name="TEXT">MyWiFi</field></shadow>
        </value>
        <value name="PASSWORD">
          <shadow type="text"><field name="TEXT">password123</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_connect" id="tubitv2wifi_connect"/>

      <block type="tubitv2wifi_isConnected" id="tubitv2wifi_isConnected"/>

      <block type="tubitv2wifi_getIP" id="tubitv2wifi_getIP"/>

    </category>

    <category name="%{BKY_TUBITV2WIFI_CATEGORY_NTP}" id="TUBITV2WIFI_CATEGORY_NTP" colour="#1565C0" secondaryColour="#1565C0" iconURI="../external-resources/extensions/TUBITV2_WIFI/assets/wifi.png">

      <block type="tubitv2wifi_ntpSetup" id="tubitv2wifi_ntpSetup"/>

      <block type="tubitv2wifi_getTime" id="tubitv2wifi_getTime"/>

      <block type="tubitv2wifi_getDate" id="tubitv2wifi_getDate"/>

    </category>

    <category name="%{BKY_TUBITV2WIFI_CATEGORY_HTTP}" id="TUBITV2WIFI_CATEGORY_HTTP" colour="#00838F" secondaryColour="#00838F" iconURI="../external-resources/extensions/TUBITV2_WIFI/assets/wifi.png">

      <block type="tubitv2wifi_httpGet" id="tubitv2wifi_httpGet">
        <value name="URL">
          <shadow type="text"><field name="TEXT">http://example.com/api</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_httpPost" id="tubitv2wifi_httpPost">
        <value name="URL">
          <shadow type="text"><field name="TEXT">http://example.com/api</field></shadow>
        </value>
        <value name="DATA">
          <shadow type="text"><field name="TEXT">key=value</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_lastResponse" id="tubitv2wifi_lastResponse"/>

    </category>

    <category name="%{BKY_TUBITV2WIFI_CATEGORY_SHEETS}" id="TUBITV2WIFI_CATEGORY_SHEETS" colour="#2E7D32" secondaryColour="#2E7D32" iconURI="../external-resources/extensions/TUBITV2_WIFI/assets/wifi.png">

      <block type="tubitv2wifi_sheetsSetUrl" id="tubitv2wifi_sheetsSetUrl">
        <value name="URL">
          <shadow type="text"><field name="TEXT">https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_sheetsWrite" id="tubitv2wifi_sheetsWrite">
        <value name="FIELD">
          <shadow type="text"><field name="TEXT">temperature</field></shadow>
        </value>
        <value name="VALUE">
          <shadow type="text"><field name="TEXT">25</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_sheetsRead" id="tubitv2wifi_sheetsRead">
        <value name="FIELD">
          <shadow type="text"><field name="TEXT">temperature</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_sheetsWriteRow" id="tubitv2wifi_sheetsWriteRow">
        <value name="VALUE1">
          <shadow type="text"><field name="TEXT">25.3</field></shadow>
        </value>
        <value name="VALUE2">
          <shadow type="text"><field name="TEXT">65</field></shadow>
        </value>
        <value name="VALUE3">
          <shadow type="text"><field name="TEXT">0</field></shadow>
        </value>
        <value name="VALUE4">
          <shadow type="text"><field name="TEXT">0</field></shadow>
        </value>
      </block>

    </category>

    <category name="%{BKY_TUBITV2WIFI_CATEGORY_MQTT}" id="TUBITV2WIFI_CATEGORY_MQTT" colour="#E65100" secondaryColour="#E65100" iconURI="../external-resources/extensions/TUBITV2_WIFI/assets/wifi.png">

      <block type="tubitv2wifi_mqttSetup" id="tubitv2wifi_mqttSetup">
        <value name="HOST">
          <shadow type="text"><field name="TEXT">broker.hivemq.com</field></shadow>
        </value>
        <value name="PORT">
          <shadow type="math_number"><field name="NUM">1883</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_mqttConnect" id="tubitv2wifi_mqttConnect">
        <value name="CLIENT_ID">
          <shadow type="text"><field name="TEXT">ESP32Client</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_mqttPublish" id="tubitv2wifi_mqttPublish">
        <value name="TOPIC">
          <shadow type="text"><field name="TEXT">tubit/sensor</field></shadow>
        </value>
        <value name="MSG">
          <shadow type="text"><field name="TEXT">hello</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_mqttSubscribe" id="tubitv2wifi_mqttSubscribe">
        <value name="TOPIC">
          <shadow type="text"><field name="TEXT">tubit/control</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_mqttIsConnected" id="tubitv2wifi_mqttIsConnected"/>

      <block type="tubitv2wifi_mqttLoop" id="tubitv2wifi_mqttLoop"/>

      <block type="tubitv2wifi_mqttLastMessage" id="tubitv2wifi_mqttLastMessage"/>

    </category>

    <category name="%{BKY_TUBITV2WIFI_CATEGORY_TS}" id="TUBITV2WIFI_CATEGORY_TS" colour="#7B1FA2" secondaryColour="#7B1FA2" iconURI="../external-resources/extensions/TUBITV2_WIFI/assets/wifi.png">

      <block type="tubitv2wifi_thingspeakSetup" id="tubitv2wifi_thingspeakSetup">
        <value name="WRITE_KEY">
          <shadow type="text"><field name="TEXT">YOUR_WRITE_KEY</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_thingspeakWrite" id="tubitv2wifi_thingspeakWrite">
        <value name="F1">
          <shadow type="math_number"><field name="NUM">0</field></shadow>
        </value>
        <value name="F2">
          <shadow type="math_number"><field name="NUM">0</field></shadow>
        </value>
        <value name="F3">
          <shadow type="math_number"><field name="NUM">0</field></shadow>
        </value>
        <value name="F4">
          <shadow type="math_number"><field name="NUM">0</field></shadow>
        </value>
      </block>

      <block type="tubitv2wifi_thingspeakRead" id="tubitv2wifi_thingspeakRead">
        <value name="CHANNEL_ID">
          <shadow type="text"><field name="TEXT">123456</field></shadow>
        </value>
        <value name="READ_KEY">
          <shadow type="text"><field name="TEXT">YOUR_READ_KEY</field></shadow>
        </value>
        <value name="FIELD_NO">
          <shadow type="math_number"><field name="NUM">1</field></shadow>
        </value>
      </block>

    </category>`;
}

exports = registerToolboxs;
