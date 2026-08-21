; Close only DeepSeekHarness.exe. electron-builder's default check (when
; PowerShell is available) treats any process whose path starts with $INSTDIR
; as the app, so a browser, the installer, or another Program Files process
; can block setup while DeepSeekHarness.exe is not running.
!include "getProcessInfo.nsh"
Var pid

!macro customFindAppProcess _RETURN
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  Pop ${_RETURN}
!macroend

; Remove the installed tree where it stands. electron-builder's update path
; first renames every installed file into $PLUGINSDIR\old-install; that
; destination prefix is longer than the install directory, so the deepest
; resources\runtime\node_modules entries cross MAX_PATH, the rename fails, the
; uninstaller aborts, and setup reports that the app cannot be closed. In-place
; removal keeps every path at its installed length; it gives up the rename's
; restore-on-failure step, so a partial delete leaves the new files to overwrite
; what remains.
!macro customRemoveFiles
  SetOutPath $TEMP
  RMDir /r $INSTDIR
!macroend

!macro customCheckAppRunning
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    ${if} ${isUpdated}
      Sleep 300
    ${endIf}

    !insertmacro customFindAppProcess $R0
    ${if} $R0 == 0
      ${if} ${isUpdated}
        Sleep 1000
        Goto doStopProcess
      ${endIf}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
      Quit

      doStopProcess:
      DetailPrint "$(appClosing)"
      nsExec::Exec `taskkill /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $pid"`
      Pop $0
      Sleep 300
      StrCpy $R1 0

      loop:
        IntOp $R1 $R1 + 1
        !insertmacro customFindAppProcess $R0
        ${if} $R0 == 0
          Sleep 1000
          nsExec::Exec `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $pid"`
          Pop $0
          !insertmacro customFindAppProcess $R0
          ${if} $R0 == 0
            DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
            Sleep 2000
          ${else}
            Goto not_running
          ${endIf}
        ${else}
          Goto not_running
        ${endIf}

        ${if} $R1 > 1
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY loop
          Quit
        ${else}
          Goto loop
        ${endIf}
      not_running:
    ${endIf}
  ${endIf}
!macroend
