@echo off
rem ==========================================================================
rem  Pendientes 3D - compila el APK firmado en este ordenador (Windows)
rem  Doble clic en este archivo. Deja el APK en la carpeta principal del
rem  proyecto y el registro completo en compilar-apk.log.
rem
rem  La primera vez crea la clave de firma privada:
rem    android\app\pendientes3d-privada.jks  y  android\keystore.properties
rem  Guarda copia de esos dos archivos: sin ellos no podras actualizar la app
rem  instalada. Nunca se suben a GitHub (estan en .gitignore).
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."
set "ROOT=%CD%"
set "LOG=%ROOT%\compilar-apk.log"

echo.
echo   PENDIENTES 3D - compilando el APK...
echo   (la primera vez puede tardar varios minutos)
echo.

call :main > "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" (
  for /f "usebackq delims=" %%a in ("%ROOT%\apk-generado.txt") do set "APK=%%a"
  echo   LISTO: !APK!
  echo.
  start "" explorer /select,"!APK!"
) else (
  echo   ERROR al compilar. Ultimas lineas del registro:
  echo   ------------------------------------------------
  powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG%' -Tail 25"
  echo   ------------------------------------------------
  echo   Registro completo: %LOG%
)
echo.
if not defined NOPAUSE pause
exit /b %RC%


:main
echo === Pendientes 3D - compilacion local ===
echo Fecha: %DATE% %TIME%
echo Carpeta: %ROOT%

rem ---------- Java (el JDK que trae Android Studio) ----------
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" goto java_ok
set "JAVA_HOME="
for %%d in ("%ProgramFiles%\Android\Android Studio\jbr" "%LOCALAPPDATA%\Programs\Android Studio\jbr" "%ProgramFiles%\Android\Android Studio1\jbr" "%ProgramFiles(x86)%\Android\Android Studio\jbr") do (
  if not defined JAVA_HOME if exist "%%~d\bin\java.exe" set "JAVA_HOME=%%~d"
)
if not defined JAVA_HOME (
  for /d %%d in ("%USERPROFILE%\.jdks\*21*" "%USERPROFILE%\.jdks\*") do (
    if not defined JAVA_HOME if exist "%%~d\bin\java.exe" set "JAVA_HOME=%%~d"
  )
)
if not defined JAVA_HOME (
  echo ERROR: no encuentro Java. Instala Android Studio o define JAVA_HOME.
  exit /b 1
)
:java_ok
echo JAVA_HOME=%JAVA_HOME%
"%JAVA_HOME%\bin\java.exe" -version
set "PATH=%JAVA_HOME%\bin;%PATH%"

rem ---------- SDK de Android ----------
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not exist "%ANDROID_HOME%\platforms" (
  echo ERROR: no encuentro el SDK de Android en %ANDROID_HOME%
  echo Abre Android Studio una vez para que lo instale, o define ANDROID_HOME.
  exit /b 1
)
echo ANDROID_HOME=%ANDROID_HOME%
echo Plataformas instaladas:
dir /b "%ANDROID_HOME%\platforms"
if not exist "%ANDROID_HOME%\platforms\android-36" (
  echo AVISO: falta la plataforma android-36. Gradle intentara descargarla.
  echo Si falla, instalala en Android Studio: Tools - SDK Manager - Android 16 ^(API 36^).
)
set "SDKF=%ANDROID_HOME:\=/%"
> "%ROOT%\android\local.properties" echo sdk.dir=%SDKF%

rem ---------- Web dentro del proyecto Android ----------
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado: uso la web ya copiada en el proyecto.
  if not exist "%ROOT%\node_modules\@capacitor\android" (
    echo ERROR: faltan node_modules y no hay Node.js para instalarlos.
    exit /b 1
  )
  if not exist "%ROOT%\android\app\src\main\assets\public\index.html" (
    echo ERROR: falta la web en android\app\src\main\assets\public.
    exit /b 1
  )
) else (
  echo Node:
  node -v
  if not exist "%ROOT%\node_modules\@capacitor\android" (
    echo Instalando dependencias...
    call npm ci --no-audit --no-fund
    if errorlevel 1 exit /b 1
  )
  echo Copiando la web al proyecto Android...
  call npm run android:sync
  if errorlevel 1 exit /b 1
)

rem ---------- Clave de firma privada (solo la primera vez) ----------
if not exist "%ROOT%\android\keystore.properties" (
  echo Creando la clave de firma privada...
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[guid]::NewGuid().ToString('N').Substring(0,24)"`) do set "PW=%%p"
  if exist "%ROOT%\android\app\pendientes3d-privada.jks" (
    echo ERROR: existe pendientes3d-privada.jks pero falta keystore.properties.
    echo Recupera keystore.properties de tu copia de seguridad.
    exit /b 1
  )
  "%JAVA_HOME%\bin\keytool.exe" -genkeypair -noprompt -keystore "%ROOT%\android\app\pendientes3d-privada.jks" -storetype PKCS12 -alias pendientes3d -keyalg RSA -keysize 2048 -validity 10000 -storepass !PW! -keypass !PW! -dname "CN=Pendientes 3D, O=viferor, C=ES"
  if errorlevel 1 exit /b 1
  (
    echo # Clave de firma de Pendientes 3D. NO subir a GitHub. Guarda copia de este archivo y del .jks.
    echo storeFile=pendientes3d-privada.jks
    echo storePassword=!PW!
    echo keyAlias=pendientes3d
    echo keyPassword=!PW!
  ) > "%ROOT%\android\keystore.properties"
  echo Clave creada en android\app\pendientes3d-privada.jks
) else (
  echo Usando la clave existente de android\keystore.properties
)

rem ---------- Version: crece con cada compilacion ----------
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "[int][math]::Floor(((Get-Date).ToUniversalTime() - [datetime]'2026-01-01').TotalMinutes / 10)"`) do set "VCODE=%%v"
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content -Raw '%ROOT%\package.json' | ConvertFrom-Json).version"`) do set "VBASE=%%v"
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd.HHmm"`) do set "VDATE=%%v"
set "VNAME=%VBASE%-%VDATE%"
echo versionCode=%VCODE%  versionName=%VNAME%

rem ---------- Compilar ----------
pushd "%ROOT%\android"
call gradlew.bat assembleRelease --no-daemon --console=plain -PversionCode=%VCODE% -PversionName=%VNAME%
set "GRC=%ERRORLEVEL%"
popd
if not "%GRC%"=="0" (
  echo ERROR: Gradle termino con codigo %GRC%
  exit /b 1
)

set "OUT=%ROOT%\android\app\build\outputs\apk\release\app-release.apk"
if not exist "%OUT%" (
  echo ERROR: Gradle termino pero no aparece app-release.apk - sin firmar?
  dir "%ROOT%\android\app\build\outputs\apk\release"
  exit /b 1
)
set "DEST=%ROOT%\Pendientes3D-%VNAME%.apk"
copy /y "%OUT%" "%DEST%" >nul
> "%ROOT%\apk-generado.txt" echo %DEST%
echo APK: %DEST%
echo RESULTADO: OK
exit /b 0
