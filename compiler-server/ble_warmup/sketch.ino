// =====================================================
// TubitBlock BLE Warmup Sketch — 全擴展預編譯
// =====================================================
// 此 sketch 的用途是讓 arduino-cli 在 Docker build 或 server 啟動時
// 預先編譯所有 TUBITV2 常用 library，產生 .o 目標檔案。
// 後續學生的程式碼只需要重新編譯 sketch.ino，
// 已編譯好的 library .o 會被增量編譯機制直接重用。
//
// 重要：這裡必須 include 所有可能用到的 library header，
// 否則對應 library 的 .o 就不會被預先產生。
//
// 已知不能共存的互斥 library（各自在獨立使用時沒問題）：
//   - V7RC_BT vs V7RC_WIFI：共用全域變數 V7RC_A / V7RC_B / numberBase
//   - ATARM vs PPGUN：共用全域變數 panPin / panDeg
//   以上兩組選一個代表即可，另一個讓 arduino-cli 在首次使用時編譯。
// =====================================================

// --- TUBITV2_SET (核心) ---
#include <Arduino.h>
#include <TuBitCore.h>
#include <Wire.h>

// --- TUBITV2_MTC (麥克納姆輪底盤) ---
#include <TuMTC.h>

// --- TUBITV2_DTC (差速底盤) ---
#include <TuDTC.h>

// --- TUBITV2_OTC (全向輪底盤) ---
#include <TuOTC.h>

// --- TUBITV2_ATARM (機械手臂) ---
// 注意：不可與 PPGUN 同時 include（全域變數名稱衝突）
#include <ATARM.h>

// --- v7rc 藍牙遙控 ---
// 注意：V7RC_BT 與 V7RC_WIFI 不可同時 include（全域變數名稱衝突），
// 選用 V7RC_BT，BLE 是最耗時的部分（約 60 秒），暖機效益最大。
#include <V7RC_BT.h>

// --- PS3 (PS3 手把) ---
#include <Ps3Controller.h>

// --- ESP32Servo (伺服馬達，TUBITV2_SERVOMOTOR 間接使用) ---
#include <ESP32Servo.h>

// =====================================================
// 全域物件初始化
// =====================================================
TuBitCore tubit;
V7RC_BT v7rc;
TuMTC mtc(tubit);
TuDTC dtc(tubit);
TuOTC otc(tubit);

void setup() {
  // 核心初始化
  tubit.init();

  // BLE 藍牙（BLE 堆疊編譯最耗時，約 60 秒）
  v7rc.setupBLE("warmup");

  // 機械手臂
  ATARM_INIT(S0, S7, S6);
  ATARM_SetLiftRange(0, 65);
  ATARM_SetPanRange(55, 125);
  ATARM_SetClawRange(120, 50);
}

void loop() {
  // 觸發各模組的基本方法，確保對應程式碼路徑被編譯
  if (v7rc.connect()) {
    if (v7rc.setMode("SRT")) {
      mtc.driveVectorOpen(0, 0, 0);
    }
  }
}
