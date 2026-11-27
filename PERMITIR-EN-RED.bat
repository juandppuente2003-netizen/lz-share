@echo off
title LZ-SHARE - Permitir en la red
:: Pide permiso de administrador y abre el puerto 8090 en el Firewall de Windows
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath \"%~f0\" -Verb RunAs" & exit /b)
netsh advfirewall firewall delete rule name="LZ-SHARE 8090" >nul 2>&1
netsh advfirewall firewall add rule name="LZ-SHARE 8090" dir=in action=allow protocol=TCP localport=8090 profile=any
echo.
echo Listo. La TV ya puede abrir LZ-SHARE.
pause
