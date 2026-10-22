# 重新打包 FLUX 本地语音组件（可选组件）
#
# 产物：
#   FLUX-TTS-Setup.exe      安装器（~80 KB，负责解压 + 写卸载项）
#   FLUX-TTS-payload.zip    负载（~3.4 GB，解压后 ~5.1 GB）
#
# 用法：
#   pwsh -File build-tts-component.ps1
#   pwsh -File build-tts-component.ps1 -Source "C:\path\to\FLUX-TTS" -OutDir "F:\tts-component"
#
# 前置条件（源目录必须是“便携布局”，否则换机器会跑不起来）：
#   venv\Scripts\python.exe          自带解释器（不是 pyvenv 的启动器）
#   venv\Scripts\python3.dll         稳定 ABI 转发 DLL —— safetensors 等原生扩展依赖它
#   venv\Scripts\python311.dll
#   venv\Scripts\vcruntime140*.dll
#   venv\Scripts\DLLs\               CPython 扩展
#   venv\Scripts\Lib\                标准库（不含 site-packages）
#   venv\Scripts\Lib\site-packages\  torch / kokoro / fastapi ...
#   venv\pyvenv.cfg                  必须不存在（存在就会回去找本机 Python）
#   server.py, model\, start_server.bat

param(
    [string]$Source = "$env:LOCALAPPDATA\FLUX-TTS",
    [string]$OutDir = "F:\tts-component"
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$nsi = Join-Path $here 'installer.nsi'

function Fail($msg) { Write-Host "FAIL: $msg" -ForegroundColor Red; exit 1 }

# ── 1. 校验便携布局 ─────────────────────────────────────────────
$checks = @(
    'venv\Scripts\python.exe',
    'venv\Scripts\python3.dll',
    'venv\Scripts\python311.dll',
    'venv\Scripts\Lib\site-packages\torch\__init__.py',
    'server.py',
    'model\kokoro-v1_1-zh.pth'
)
foreach ($c in $checks) {
    if (-not (Test-Path (Join-Path $Source $c))) { Fail "缺少 $c（源目录不是便携布局）" }
}
if (Test-Path (Join-Path $Source 'venv\pyvenv.cfg')) {
    Fail 'venv\pyvenv.cfg 仍然存在：解释器会回退到本机 Python，换机器必挂。先删除它。'
}

# 冒烟：解释器 + 原生扩展都能起来
$py = Join-Path $Source 'venv\Scripts\python.exe'
& $py -c "import torch, safetensors; assert torch.cuda.is_available() or True" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail '便携解释器自检失败（torch / safetensors 导入不通过）' }

# ── 2. 打 zip（zip64，Fastest；约 6-8 分钟）─────────────────────
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$zipPath = Join-Path $OutDir 'FLUX-TTS-payload.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Write-Host "打包 $Source -> $zipPath ..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sw = [Diagnostics.Stopwatch]::StartNew()
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $Source, $zipPath,
    [System.IO.Compression.CompressionLevel]::Fastest,
    $true   # 保留顶层 FLUX-TTS/ 目录
)
$sw.Stop()
Write-Host ("zip 完成：{0:N2} GB，用时 {1:N1} 分钟" -f ((Get-Item $zipPath).Length / 1GB), $sw.Elapsed.TotalMinutes)

# ── 3. 编译安装器 ──────────────────────────────────────────────
$makensis = Join-Path $env:LOCALAPPDATA 'tauri\NSIS\makensis.exe'
if (-not (Test-Path $makensis)) { Fail "找不到 makensis：$makensis" }

$tmpOut = Join-Path $OutDir 'FLUX-TTS-Setup.exe'
if (Test-Path $tmpOut) { Remove-Item $tmpOut -Force }
# OutFile 相对 .nsi 所在目录，编译后拷到 OutDir
& $makensis /INPUTCHARSET UTF8 $nsi
if ($LASTEXITCODE -ne 0) { Fail "makensis 失败（$LASTEXITCODE）" }
Copy-Item (Join-Path $here 'FLUX-TTS-Setup.exe') $tmpOut -Force

Write-Host ''
Write-Host '产物：'
Get-ChildItem $OutDir -File | Select-Object Name, @{n='Size'; e={ '{0:N1} MB' -f ($_.Length / 1MB) } } | Format-Table -AutoSize
Write-Host '提醒：FLUX-TTS-Setup.exe 必须与 FLUX-TTS-payload.zip 放在同一目录。'
