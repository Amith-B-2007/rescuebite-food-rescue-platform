@echo off
setlocal
title RescueBite - Surplus Food Rescue Platform (Java Server)

set "JAVA_BIN=C:\Program Files\Android\Android Studio\jbr\bin"
where javac >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set "JAVAC_CMD=javac"
    set "JAVA_CMD=java"
) else (
    set "JAVAC_CMD=%JAVA_BIN%\javac.exe"
    set "JAVA_CMD=%JAVA_BIN%\java.exe"
)

echo [1/2] Compiling Java PriorityQueue Backend & Geo-Distance Engine...
if not exist "target\classes" mkdir "target\classes"
"%JAVAC_CMD%" -d "target\classes" src\main\java\com\foodrescue\util\DistanceCalculator.java src\main\java\com\foodrescue\model\FoodBatch.java src\main\java\com\foodrescue\model\AlertEvent.java src\main\java\com\foodrescue\service\ExpiryPriorityQueueService.java src\main\java\com\foodrescue\FoodRescueServer.java

if %ERRORLEVEL% NEQ 0 (
    echo Compilation failed!
    pause
    exit /b 1
)

echo [2/2] Starting RescueBite Web Server on http://localhost:8080 ...
"%JAVA_CMD%" -cp "target\classes" com.foodrescue.FoodRescueServer 8080
