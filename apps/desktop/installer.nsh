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
