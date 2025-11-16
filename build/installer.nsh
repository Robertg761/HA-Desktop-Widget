!macro preInit
  # Delete old desktop shortcuts before new one is created
  # This ensures icon updates are visible to users
  Delete "$DESKTOP\Home Assistant Widget.lnk"
  Delete "$DESKTOP\HA Desktop Widget.lnk"
!macroend

!macro customInstall
  # After installation completes, refresh icon cache
  # This ensures the new icon is visible and not cached with old icon
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'

  # Additional cache refresh for reliability
  Sleep 500
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
