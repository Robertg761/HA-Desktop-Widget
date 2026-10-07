# The desktop of a hosted Windows runner, cleared for the visual snapshots. Each scene also captures
# the real screen around the widget (run.cjs), so whatever else is on the desktop is in the picture,
# and a desktop pin sits under every window, so a window over one hides the pin outright.
#
#   windows-desktop.ps1          end the WSL prompt, minimize every window but the desktop and the
#                                taskbar, park the pointer, then list what is still on screen
#   windows-desktop.ps1 -Check   only list what is on screen
#   windows-desktop.ps1 -Keep    stay running beside the snapshots and clear the screen again
#                                before each capture (desktop-keeper.cjs)
#
# Every window still on screen becomes a warning on the run's summary page, so a reviewer knows
# which captures to distrust. Nothing here fails the job: the snapshots are informational.
param([switch]$Check, [switch]$Keep)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace Win32 -Name Desktop -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);'

# Minimizing the main window Get-Process gave for wsl.exe left its console on screen: a console
# belongs to the program that hosts it (conhost or Windows Terminal), which a process's
# MainWindowHandle need not name. So every window on screen is listed, as Windows itself has them.
$windowList = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class SnapshotDesktop {
  [StructLayout(LayoutKind.Sequential)]
  public struct Rect { public int Left, Top, Right, Bottom; }

  public class Window {
    public IntPtr Handle;
    public int ProcessId;
    public string ClassName;
    public string Title;
    public Rect Bounds;
  }

  delegate bool EnumWindowsProc(IntPtr window, IntPtr data);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect bounds);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);

  const int DWMWA_CLOAKED = 14;

  // The top-level windows that draw something: shown, not minimized, more than a dot, and not
  // cloaked (Windows keeps suspended Store apps' windows "visible" but draws nothing of them).
  public static List<Window> OnScreen() {
    var found = new List<Window>();
    EnumWindows(delegate (IntPtr window, IntPtr data) {
      if (!IsWindowVisible(window) || IsIconic(window)) return true;
      int cloaked;
      if (DwmGetWindowAttribute(window, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
      Rect bounds;
      if (!GetWindowRect(window, out bounds) || bounds.Right - bounds.Left < 2 || bounds.Bottom - bounds.Top < 2) return true;
      var name = new StringBuilder(256);
      GetClassName(window, name, name.Capacity);
      var title = new StringBuilder(256);
      GetWindowText(window, title, title.Capacity);
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      found.Add(new Window {
        Handle = window,
        ProcessId = (int)processId,
        ClassName = name.ToString(),
        Title = title.ToString(),
        Bounds = bounds
      });
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

# A warning is a workflow command, which ends at a line break and reads '%' as the start of an
# escape, and window titles and error messages can hold either. They are escaped as GitHub expects.
function Write-DesktopWarning([string]$Message) {
  $escaped = $Message -replace '%', '%25' -replace "`r", '%0D' -replace "`n", '%0A'
  Write-Output "::warning title=Snapshot desktop::$escaped"
}

# Should the list not compile on some image, the run still goes ahead, with each process's main
# window as before.
$canList = $true
try {
  Add-Type -TypeDefinition $windowList
} catch {
  $canList = $false
  Write-DesktopWarning "Could not list the windows on screen, so only each process's main window is checked: $($_.Exception.Message)"
}

# Explorer draws the desktop and the taskbar, which belong in the captures. Its other windows do
# not: a folder window or a dialog of its own covers a pin as any other window would.
$desktopClasses = @('Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow')

# Every window on screen but the desktop and the taskbar.
function Get-StrayWindow {
  $explorer = @(Get-Process -Name explorer -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if (-not $canList) {
    # Without the list there are no class names, so all of explorer is left alone, as before.
    return Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $explorer -notcontains $_.Id } |
      ForEach-Object {
        [pscustomobject]@{
          Process = $_.ProcessName; Id = $_.Id; Class = ''; Title = $_.MainWindowTitle; Bounds = ''
          Handle = $_.MainWindowHandle
        }
      }
  }
  [SnapshotDesktop]::OnScreen() |
    Where-Object { $explorer -notcontains $_.ProcessId -or $desktopClasses -notcontains $_.ClassName } |
    ForEach-Object {
      $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
      $box = $_.Bounds
      [pscustomobject]@{
        Process = $(if ($process) { $process.ProcessName } else { "pid $($_.ProcessId)" })
        Id = $_.ProcessId
        Class = $_.ClassName
        Title = $_.Title
        Bounds = '{0},{1} {2}x{3}' -f $box.Left, $box.Top, ($box.Right - $box.Left), ($box.Bottom - $box.Top)
        Handle = $_.Handle
      }
    }
}

# The runner's own windows can open during the run, after the desktop was cleared: on the Windows 11
# image the console asking for a WSL update opened minutes into it and sat under every pin captured
# after that. So the snapshot runner keeps this script running and asks it, a line `sweep <pid>` at a
# time, to clear the screen again before each capture. It ends wsl.exe and minimizes every window
# but those of the app (process <pid>), the desktop and the taskbar, answers a line for each, and
# ends the answer with `done`; see desktop-keeper.cjs.
if ($Keep) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $say = {
    param([string]$Line)
    # One answer line each, whatever a window title holds.
    [Console]::Out.WriteLine(($Line -replace '[\r\n]+', ' '))
  }
  while ($null -ne ($request = [Console]::In.ReadLine())) {
    $appId = 0
    [void][int]::TryParse(($request -replace '^sweep\s*', ''), [ref]$appId)
    try {
      Get-Process -Name wsl -ErrorAction SilentlyContinue | ForEach-Object {
        & $say "stopped $($_.ProcessName) ($($_.Id))"
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      }
      $stray = @(Get-StrayWindow | Where-Object { $_.Id -ne $appId })
      foreach ($window in $stray) {
        & $say "cleared $($window.Process) ($($window.Id)) $($window.Class): $($window.Title)"
        # SW_SHOWMINNOACTIVE: minimized without activating the next window, which could be the
        # app's, so a scene keeps the focus it set up.
        [Win32.Desktop]::ShowWindow($window.Handle, 7) | Out-Null
      }
      if ($stray.Count -gt 0) {
        # A window takes a moment to minimize; what is still there after it is in the capture.
        Start-Sleep -Milliseconds 500
        foreach ($window in @(Get-StrayWindow | Where-Object { $_.Id -ne $appId })) {
          & $say "left $($window.Process) ($($window.Id)) $($window.Class) at $($window.Bounds): $($window.Title)"
        }
      }
    } catch {
      & $say "error $($_.Exception.Message)"
    }
    & $say 'done'
    [Console]::Out.Flush()
  }
  return
}

if (-not $Check) {
  # The Windows 11 image starts wsl.exe at sign-in, and it waits in a console for WSL to be updated.
  # That console covered every pin in the Windows 11 captures. Nothing here uses WSL, and ending the
  # program closes its console.
  Get-Process -Name wsl -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Output "Stopping $($_.ProcessName) ($($_.Id))"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  foreach ($window in @(Get-StrayWindow)) {
    Write-Output "Minimizing $($window.Process) ($($window.Id)) $($window.Class): $($window.Title)"
    # SW_MINIMIZE
    [Win32.Desktop]::ShowWindow($window.Handle, 6) | Out-Null
  }
  # The pointer rests in the middle of the screen, where the widget opens, and the first capture
  # showed the native tooltip of the tile under it. The top-left corner is clear of the widget and
  # its pins. The run never moves the real pointer: scenes click through the page, not the mouse.
  [Win32.Desktop]::SetCursorPos(0, 0) | Out-Null
  Start-Sleep -Seconds 2
}

$left = @(Get-StrayWindow)
if ($left.Count -eq 0) {
  Write-Output 'Only the desktop and the taskbar are on screen.'
} else {
  $left | Format-Table Process, Id, Class, Title, Bounds -AutoSize | Out-String -Width 200 | Write-Output
  foreach ($window in $left) {
    Write-DesktopWarning "$($window.Process) ($($window.Class)) has a window on screen at $($window.Bounds), which can be in the screen captures: $($window.Title)"
  }
}
