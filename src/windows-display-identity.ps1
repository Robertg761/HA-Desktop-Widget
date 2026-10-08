# Read-only display identity query. No display configuration or registry writes.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WindowsDisplayIdentity {
    [StructLayout(LayoutKind.Sequential)]
    public struct Luid { public uint low; public int high; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Source {
        public Luid adapter;
        public uint id, modeIndex, status;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct Rational { public uint numerator, denominator; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Target {
        public Luid adapter;
        public uint id, modeIndex, technology, rotation, scaling;
        public Rational refresh;
        public uint scanLineOrdering;
        [MarshalAs(UnmanagedType.Bool)] public bool available;
        public uint status;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct PathInfo { public Source source; public Target target; public uint flags; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Header { public uint type, size; public Luid adapter; public uint id; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct TargetName {
        public Header header;
        public uint flags, technology;
        public ushort manufacturer, product;
        public uint connector;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string friendlyName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string monitorDevicePath;
    }
    public class Identity {
        public uint adapterLow, targetId;
        public int adapterHigh;
        public string monitorDevicePath;
    }
    [DllImport("user32.dll")]
    static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
    [DllImport("user32.dll")]
    static extern int QueryDisplayConfig(uint flags, ref uint paths, [Out] PathInfo[] pathInfo,
        ref uint modes, IntPtr modeInfo, IntPtr topology);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    static extern int DisplayConfigGetDeviceInfo(ref TargetName target);

    public static Identity[] Read() {
        // QDC_ONLY_ACTIVE_PATHS. Retry if the topology changes between size and query.
        for (int attempt=0; attempt<3; attempt++) {
            uint pathCount, modeCount;
            int result=GetDisplayConfigBufferSizes(2,out pathCount,out modeCount);
            if(result!=0) throw new Exception("GetDisplayConfigBufferSizes failed: "+result);
            PathInfo[] paths=new PathInfo[pathCount];
            // DISPLAYCONFIG_MODE_INFO is 64 bytes: a 16-byte header and a 48-byte union.
            IntPtr modes=Marshal.AllocHGlobal(checked((int)modeCount*64));
            try {
                result=QueryDisplayConfig(2,ref pathCount,paths,ref modeCount,modes,IntPtr.Zero);
                if(result==122) continue; // ERROR_INSUFFICIENT_BUFFER
                if(result!=0) throw new Exception("QueryDisplayConfig failed: "+result);
                List<Identity> identities=new List<Identity>();
                for(int i=0;i<pathCount;i++) {
                    Target target=paths[i].target;
                    TargetName name=new TargetName();
                    name.header.type=2; // DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME
                    name.header.size=(uint)Marshal.SizeOf(typeof(TargetName));
                    name.header.adapter=target.adapter;
                    name.header.id=target.id;
                    result=DisplayConfigGetDeviceInfo(ref name);
                    // A driver may expose an active display without a monitor device path.
                    // Leave it unassociated rather than infer identity from its label/position.
                    if(result!=0 || String.IsNullOrWhiteSpace(name.monitorDevicePath)) continue;
                    identities.Add(new Identity {adapterLow=target.adapter.low,
                        adapterHigh=target.adapter.high,targetId=target.id,
                        monitorDevicePath=name.monitorDevicePath});
                }
                return identities.ToArray();
            } finally { Marshal.FreeHGlobal(modes); }
        }
        throw new Exception("Display topology changed during every identity query");
    }
}
'@
$identities = @([WindowsDisplayIdentity]::Read())
ConvertTo-Json -InputObject $identities -Depth 3 -Compress
