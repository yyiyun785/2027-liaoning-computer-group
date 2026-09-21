# 打包APK.ps1 —— 辽宁专升本备考助手 一键打包（已修复安装兼容性问题）
#
# 用法：右键此文件 → 使用 PowerShell 运行
#      或在 PowerShell 里执行:  powershell -ExecutionPolicy Bypass -File "打包APK.ps1"
#
# 关键修复点：
#   1. AndroidManifest.xml 里显式声明 minSdkVersion=24 / targetSdkVersion=35
#      （Android 14+ 会拒绝安装 targetSdkVersion 过低的应用）
#   2. resources.arsc 必须以「不压缩 + 4 字节对齐」写入
#      （Android 11+ 的硬性要求，否则报「兼容性问题」装不上）
#   3. 同时使用 v1 + v2 + v3 三种签名方案
#      （部分国产 ROM 只认 v1，缺了会被拦截）

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$root    = $PSScriptRoot
$bt      = 'C:\android-sdk\build-tools\35.0.0'
$androidJar = 'C:\android-sdk\platforms\android-35\android.jar'
$jdkBin  = 'F:\JDK\bin'
$ks      = Join-Path $root 'build\zsb.keystore'
$ksPass  = 'zsb123456'
$ksAlias = 'zsb'
$outApk  = Join-Path (Split-Path $root -Parent) '辽宁专升本备考助手.apk'

$buildDir   = Join-Path $root 'build'
$genDir     = Join-Path $buildDir 'gen'
$classesDir = Join-Path $buildDir 'classes'
$dexDir     = Join-Path $buildDir 'dex'
$addDir     = Join-Path $buildDir 'add'
# 注意：apksigner 是 Java 程序，遇到中文路径会抛 "Bad pathname"，
#       所以 APK 的中间产物一律放在纯英文的临时目录里，最后再拷回中文路径。
$tmpRoot = $env:TEMP
if ([string]::IsNullOrWhiteSpace($tmpRoot)) { $tmpRoot = [System.IO.Path]::GetTempPath() }
if ([string]::IsNullOrWhiteSpace($tmpRoot)) { $tmpRoot = Join-Path $env:USERPROFILE 'AppData\Local\Temp' }
if ([string]::IsNullOrWhiteSpace($tmpRoot)) { $tmpRoot = 'C:\Windows\Temp' }
$tmpDir = Join-Path $tmpRoot 'zsb-apk-build'

Write-Host "===== 辽宁专升本备考助手 打包 =====" -ForegroundColor Cyan

# ---------- 环境检查 ----------
foreach ($p in @("$bt\aapt.exe", "$bt\zipalign.exe", "$bt\apksigner.bat", "$bt\d8.bat", $androidJar, "$jdkBin\javac.exe", $ks)) {
    if (-not (Test-Path $p)) { throw "缺少必要文件: $p" }
}
Write-Host "[1/7] 环境检查通过" -ForegroundColor Green

# ---------- 清理 ----------
foreach ($d in @($genDir, $classesDir, $dexDir, $addDir, $tmpDir)) {
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# ---------- aapt: 编译资源与清单 ----------
Write-Host "[2/7] aapt 编译资源与清单..." -ForegroundColor Green
& "$bt\aapt.exe" package -f -m `
    -M (Join-Path $root 'AndroidManifest.xml') `
    -S (Join-Path $root 'res') `
    -I $androidJar `
    -J $genDir `
    -F (Join-Path $tmpDir 'base.apk') `
    --min-sdk-version 24 `
    --target-sdk-version 35
if ($LASTEXITCODE -ne 0) { throw 'aapt 打包失败' }

# ---------- javac: 编译 Java ----------
Write-Host "[3/7] javac 编译 Java 源码..." -ForegroundColor Green
$sources = @(Get-ChildItem (Join-Path $root 'src') -Recurse -Filter *.java | ForEach-Object { $_.FullName })
$sources += @(Get-ChildItem $genDir -Recurse -Filter *.java | ForEach-Object { $_.FullName })
& "$jdkBin\javac.exe" -encoding UTF-8 -source 8 -target 8 `
    -bootclasspath $androidJar -classpath $androidJar `
    -d $classesDir $sources
if ($LASTEXITCODE -ne 0) { throw 'javac 编译失败' }

# ---------- d8: 转成 dex ----------
Write-Host "[4/7] d8 生成 classes.dex..." -ForegroundColor Green
$classFiles = @(Get-ChildItem $classesDir -Recurse -Filter *.class | ForEach-Object { $_.FullName })
& "$bt\d8.bat" --lib $androidJar --min-api 24 --output $dexDir $classFiles
if ($LASTEXITCODE -ne 0) { throw 'd8 转换失败' }

# ---------- 组装附加文件 ----------
Copy-Item (Join-Path $dexDir 'classes.dex') (Join-Path $addDir 'classes.dex') -Force
$assetsSrc = Join-Path $root 'assets'
if (Test-Path $assetsSrc) {
    Copy-Item $assetsSrc (Join-Path $addDir 'assets') -Recurse -Force
} else {
    Write-Warning '未找到 assets 目录，网页内容将不会被打包！'
}

# ---------- 重新打包（关键：resources.arsc 不压缩）----------
Write-Host "[5/7] 重新打包（resources.arsc 保持不压缩）..." -ForegroundColor Green
& node (Join-Path $root 'tools\pack-apk.js') (Join-Path $tmpDir 'base.apk') (Join-Path $tmpDir 'packed.apk') $addDir
if ($LASTEXITCODE -ne 0) { throw '打包失败' }

# ---------- zipalign ----------
Write-Host "[6/7] zipalign 对齐..." -ForegroundColor Green
& "$bt\zipalign.exe" -f -v 4 (Join-Path $tmpDir 'packed.apk') (Join-Path $tmpDir 'aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'zipalign 失败' }

# ---------- 签名（v1 + v2 + v3）----------
Write-Host "[7/7] 签名（v1+v2+v3）..." -ForegroundColor Green
$signedApk = Join-Path $tmpDir 'signed.apk'
$ksAscii   = Join-Path $tmpDir 'sign.keystore'
Copy-Item $ks $ksAscii -Force
& "$bt\apksigner.bat" sign `
    --ks $ksAscii --ks-key-alias $ksAlias `
    --ks-pass "pass:$ksPass" --key-pass "pass:$ksPass" `
    --min-sdk-version 21 `
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true `
    --out $signedApk (Join-Path $tmpDir 'aligned.apk')
if ($LASTEXITCODE -ne 0) { throw '签名失败' }

# ---------- 验证 ----------
Write-Host ''
Write-Host "===== 验证 =====" -ForegroundColor Cyan
& "$bt\apksigner.bat" verify -v --min-sdk-version 21 $signedApk

# ---------- 拷回目标位置 ----------
Copy-Item $signedApk $outApk -Force

Write-Host ''
Write-Host "打包完成: $outApk" -ForegroundColor Green
Write-Host ("大小: {0} KB" -f [math]::Round((Get-Item $outApk).Length / 1KB, 1))
