@echo off
:loop
node index.js
timeout /t 3 >nul
goto loop
