; FLUX 本地语音组件（可选组件）安装器
;
; 与主安装包完全解耦：主安装包 ~39MB 只装程序本体；本组件 ~2GB，只在需要的机器上装一次。
; 安装位置 %LOCALAPPDATA%\FLUX-TTS —— 刻意放在主程序安装目录之外，
; 这样 FLUX 升级/卸载不会把这 5GB 清掉。
;
; 依赖 Windows 10 1803+ 自带的 bsdtar（%SYSDIR%\tar.exe）解压 payload.zip，
; 不往安装器里塞 5GB（NSIS 的 32 位压缩器扛不住 >2GB 的负载）。

Unicode true

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define APP_NAME "FLUX 本地语音组件"
!define APP_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\FLUX-TTS"
!define PAYLOAD "FLUX-TTS-payload.zip"

Name "${APP_NAME}"
OutFile "FLUX-TTS-Setup.exe"
InstallDir "$LOCALAPPDATA\FLUX-TTS"
InstallDirRegKey HKCU "Software\FLUX\TTS" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "FLUX TTS Component"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "本地语音运行时（约 5 GB）" SecMain
  ; ── 前置检查（静默安装只设错误码，不弹窗阻塞）────────────────
  ${IfNot} ${FileExists} "$SYSDIR\tar.exe"
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP "系统缺少 tar.exe（Windows 10 1803 以下不支持）。请手动解压 $EXEDIR\${PAYLOAD} 到 $LOCALAPPDATA。"
    ${EndIf}
    SetErrorLevel 2
    Abort
  ${EndIf}

  ${IfNot} ${FileExists} "$EXEDIR\${PAYLOAD}"
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP "安装包不完整：同目录下缺少 ${PAYLOAD}。$\r$\n请把 FLUX-TTS-Setup.exe 与 ${PAYLOAD} 放在同一个文件夹里再运行。"
    ${EndIf}
    SetErrorLevel 3
    Abort
  ${EndIf}

  ; 解压至少需要 6GB 空闲（payload 5.0GB + 余量）
  ${GetRoot} "$INSTDIR" $0
  ${DriveSpace} "$0\" "/D=F /S=M" $1
  ${If} $1 < 6144
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP|MB_OK "磁盘空间不足：$0 只剩 $1 MB，至少需要 6144 MB。"
    ${EndIf}
    SetErrorLevel 4
    Abort
  ${EndIf}

  ${IfNot} ${Silent}
    ${If} ${FileExists} "$INSTDIR\venv\Scripts\python.exe"
      MessageBox MB_YESNO|MB_ICONQUESTION "检测到已安装的语音组件，是否覆盖重装？$\r$\n（建议先退出 FLUX，否则文件被占用会导致覆盖失败）" IDYES +2
      Abort
    ${EndIf}
  ${EndIf}

  ; ── 解压 ────────────────────────────────────────────────────
  DetailPrint "正在解压语音运行时（约 5 GB，首次安装需要几分钟）…"
  SetOutPath "$INSTDIR"
  nsExec::ExecToLog '"$SYSDIR\tar.exe" -xf "$EXEDIR\${PAYLOAD}" -C "$LOCALAPPDATA"'
  Pop $0
  ${If} $0 != 0
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP "解压失败（tar 退出码 $0）。$\r$\n常见原因：磁盘空间不足，或 FLUX / python 正在占用文件。请退出 FLUX 后重试。"
    ${EndIf}
    SetErrorLevel 5
    Abort
  ${EndIf}

  ${IfNot} ${FileExists} "$INSTDIR\venv\Scripts\python.exe"
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP "解压完成但未找到 venv\Scripts\python.exe，安装包可能损坏。"
    ${EndIf}
    SetErrorLevel 6
    Abort
  ${EndIf}

  ; ── 卸载器 + 系统记录 ────────────────────────────────────────
  WriteUninstaller "$INSTDIR\Uninstall-FLUX-TTS.exe"
  WriteRegStr HKCU "Software\FLUX\TTS" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${APP_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${APP_KEY}" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "${APP_KEY}" "Publisher" "FLUX"
  WriteRegStr HKCU "${APP_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${APP_KEY}" "UninstallString" '"$INSTDIR\Uninstall-FLUX-TTS.exe"'
  WriteRegDWORD HKCU "${APP_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${APP_KEY}" "NoRepair" 1

  DetailPrint "完成：$INSTDIR"
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${APP_KEY}"
  DeleteRegKey HKCU "Software\FLUX\TTS"
SectionEnd
