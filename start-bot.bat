@echo off
rem QQ bot one-click start: NapCat Shell + bot brain
rem Run as administrator. Do NOT close the two windows it spawns.
cd /d "%~dp0"
start "NapCat" cmd /c launcher-user.bat
start "bot-brain" /min node bot.cjs
echo NapCat + bot.cjs started. Verify: http://127.0.0.1:3000/get_login_info
pause
