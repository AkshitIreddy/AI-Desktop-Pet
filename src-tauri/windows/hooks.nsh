; Convai Desktop Pets — NSIS installer hooks (wired via
; tauri.conf.json > bundle.windows.nsis.installerHooks).
;
; App data lives in two places (installMode: currentUser):
;   $APPDATA\com.akshitireddy.convai-desktop-pet       (store: app-data.json, sprites\)
;   $LOCALAPPDATA\com.akshitireddy.convai-desktop-pet  (WebView2 profile, caches)
;
; Both hooks default to KEEPING data: /SD picks No for silent runs and
; MB_DEFBUTTON2 makes No the default button on the pre-install prompt.

!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$APPDATA\com.akshitireddy.convai-desktop-pet\app-data.json" 0 convai_preinstall_done
  MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONEXCLAMATION \
    "${U+26A0} Data from a previous install of Convai Desktop Pets was found.$\r$\n$\r$\nStart completely fresh and DELETE it? Your API key, characters and reminders would be lost.$\r$\n$\r$\n(Recommended: No)" \
    /SD IDNO IDYES convai_preinstall_wipe
  Goto convai_preinstall_done
convai_preinstall_wipe:
  RMDir /r "$APPDATA\com.akshitireddy.convai-desktop-pet"
  RMDir /r "$LOCALAPPDATA\com.akshitireddy.convai-desktop-pet"
convai_preinstall_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Also remove all Convai Desktop Pets data?$\r$\n$\r$\nThis deletes your API key, characters, reminders and imported sprite sets." \
    /SD IDNO IDYES convai_postuninstall_wipe
  Goto convai_postuninstall_done
convai_postuninstall_wipe:
  RMDir /r "$APPDATA\com.akshitireddy.convai-desktop-pet"
  RMDir /r "$LOCALAPPDATA\com.akshitireddy.convai-desktop-pet"
convai_postuninstall_done:
!macroend
