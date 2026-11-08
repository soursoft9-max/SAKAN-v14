@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist node_modules (
  echo تثبيت المكتبات لأول مرة...
  call npm install
)
:loop
node zk-bridge.js
echo توقف البرنامج، إعادة التشغيل بعد 10 ثوانٍ...
timeout /t 10 >nul
goto loop
