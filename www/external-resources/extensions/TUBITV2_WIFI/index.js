const tubitv2wifi = formatMessage => ({
    name: formatMessage({
        id: 'tubitv2wifi.name',
        default: 'WiFi / IoT'
    }),
    extensionId: 'tubitv2wifi',
    version: '1.0.0',
    supportDevice: ['arduinoEsp32'],
    author: 'HUNG TU 鴻兔科技',
    iconURL: 'assets/wifi.png',
    description: formatMessage({
        id: 'tubitv2wifi.description',
        default: 'ESP32 WiFi 連線、HTTP 請求、Google 試算表、MQTT 物聯網積木。'
    }),
    featured: true,
    blocks: 'blocks.js',
    generator: 'generator.js',
    toolbox: 'toolbox.js',
    translations: 'translations.js',
    library: 'lib',
    official: true,
    tags: ['iot', 'network'],
    helpLink: ''
});

module.exports = tubitv2wifi;
