@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'node.exe' -ArgumentList 'controller.cjs --start' -WorkingDirectory '%~dp0' -Verb RunAs"
