; Installer tweaks for the DM and Player apps.
; Always install for the current user (no "all users or just me" page and no request for admin rights):
; that page stopped the installer on some PCs. The next page still lets you choose the install folder.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
