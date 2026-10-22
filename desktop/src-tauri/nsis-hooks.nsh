; FLUX NSIS 安装器钩子：
; 升级/卸载流程会清空 $INSTDIR（含运行时数据目录 data —— 数据库/浏览器登录态/截图缓存），
; 这里在卸载前把 data 备份到 FLUX 自己的 LocalAppData，安装完成后回填。
; 关键：只使用 %LocalAppData%\FLUX，绝不读写 %LocalAppData%\baize——白泽与 FLUX
; 可能同时安装，共用备份目录会把白泽的数据回填进 FLUX（或反向覆盖）。
; （与 Rust 侧 paths.rs 的 backup_to_appdata / migrate_legacy 互为双保险）

!include "LogicLib.nsh"

; 卸载前（升级安装器会静默先卸载旧版）：备份 data。
; 兼容早期 FLUX 的 baize.db 命名，但备份仍写入 FLUX 自己的目录。
!macro NSIS_HOOK_PREUNINSTALL
  ${If} ${FileExists} "$INSTDIR\data\flux.db"
  ${OrIf} ${FileExists} "$INSTDIR\data\baize.db"
    RMDir /r "$LOCALAPPDATA\FLUX\update-backup"
    CreateDirectory "$LOCALAPPDATA\FLUX\update-backup"
    CopyFiles /SILENT "$INSTDIR\data\*.*" "$LOCALAPPDATA\FLUX\update-backup"
  ${EndIf}
!macroend

; 安装完成后：若 data 缺主库（升级/重装场景）且有 FLUX 备份，则回填。
!macro NSIS_HOOK_POSTINSTALL
  ${Unless} ${FileExists} "$INSTDIR\data\flux.db"
    ${If} ${FileExists} "$LOCALAPPDATA\FLUX\update-backup\flux.db"
    ${OrIf} ${FileExists} "$LOCALAPPDATA\FLUX\update-backup\baize.db"
      CreateDirectory "$INSTDIR\data"
      CopyFiles /SILENT "$LOCALAPPDATA\FLUX\update-backup\*.*" "$INSTDIR\data"
    ${EndIf}
  ${EndUnless}
!macroend
