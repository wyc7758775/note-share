@echo off
cd /d D:\programer\note-share
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
npm run tauri dev
