; Do not leave a broken login command after the user uninstalls TokenDash.
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "TokenDash"
!macroend
