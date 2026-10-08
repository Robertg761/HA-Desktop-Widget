# Disposable GitHub runner only. Exercise the real OS caption-drag path.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][long]$WindowHandle,
    [Parameter(Mandatory=$true)][int]$OwnerProcessId,
    [Parameter(Mandatory=$true)][int]$StartX,
    [Parameter(Mandatory=$true)][int]$StartY,
    [Parameter(Mandatory=$true)][int]$EndX,
    [Parameter(Mandatory=$true)][int]$EndY
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Native drag input is restricted to the disposable GitHub Actions runner.' }
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
public static class NativeWidgetDrag {
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {
        public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mouse; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION data; }
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
    static void Input(uint flags, int x, int y) {
        var input = new INPUT { type=0, data=new INPUTUNION { mouse=new MOUSEINPUT { dx=x, dy=y, dwFlags=flags } } };
        if (SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SendInput failed");
    }
    public static string Drag(long handle, int owner, int startX, int startY, int endX, int endY) {
        IntPtr window = new IntPtr(handle), previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
        POINT previousCursor; GetCursorPos(out previousCursor);
        bool pressed = false;
        try {
            uint actualOwner; GetWindowThreadProcessId(window, out actualOwner);
            if (!IsWindow(window) || actualOwner != (uint)owner) throw new Exception("Window owner does not match test Electron process");
            SetForegroundWindow(window); Thread.Sleep(200);
            if (GetForegroundWindow() != window) throw new Exception("Test window could not receive foreground input");
            if (!SetCursorPos(startX, startY)) throw new Win32Exception(Marshal.GetLastWin32Error());
            Thread.Sleep(150);
            UIntPtr hit;
            long packed = ((long)(ushort)startY << 16) | (ushort)startX;
            if (SendMessageTimeout(window, 0x0084, UIntPtr.Zero, new IntPtr(packed), 2, 2000, out hit) == IntPtr.Zero)
                throw new Exception("Native caption hit-test timed out");
            if (hit.ToUInt64() != 2) throw new Exception("Drag origin is not native HTCAPTION: " + hit.ToUInt64());
            RECT before; GetWindowRect(window, out before);
            int vx=GetSystemMetrics(76), vy=GetSystemMetrics(77), vw=GetSystemMetrics(78), vh=GetSystemMetrics(79);
            if (vw < 2 || vh < 2) throw new Exception("Invalid virtual desktop size");
            Input(0x0002, 0, 0); pressed=true; Thread.Sleep(150);
            const int steps=40;
            for (int i=1; i<=steps; i++) {
                int x=startX+(int)Math.Round((endX-startX)*(double)i/steps);
                int y=startY+(int)Math.Round((endY-startY)*(double)i/steps);
                int nx=(int)Math.Round((x-vx)*65535.0/(vw-1));
                int ny=(int)Math.Round((y-vy)*65535.0/(vh-1));
                Input(0x0001 | 0x8000 | 0x4000, nx, ny); Thread.Sleep(35);
            }
            Input(0x0004, 0, 0); pressed=false; Thread.Sleep(250);
            RECT after; GetWindowRect(window, out after);
            POINT cursor; GetCursorPos(out cursor);
            return String.Format("{{\"mechanism\":\"SendInput caption drag\",\"hitTest\":2,\"steps\":40,\"cursor\":{{\"x\":{0},\"y\":{1}}},\"nativeBefore\":{{\"x\":{2},\"y\":{3},\"width\":{4},\"height\":{5}}},\"nativeAfter\":{{\"x\":{6},\"y\":{7},\"width\":{8},\"height\":{9}}}}}", cursor.X,cursor.Y,before.Left,before.Top,before.Right-before.Left,before.Bottom-before.Top,after.Left,after.Top,after.Right-after.Left,after.Bottom-after.Top);
        } finally {
            if (pressed) Input(0x0004, 0, 0);
            SetCursorPos(previousCursor.X, previousCursor.Y);
            if (previousDpi != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi);
        }
    }
}
'@
[NativeWidgetDrag]::Drag($WindowHandle, $OwnerProcessId, $StartX, $StartY, $EndX, $EndY)
