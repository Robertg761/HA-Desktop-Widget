// Disposable Windows CI monitor validation only. No application code depends on this.
// Win32 layouts: Microsoft Learn DEVMODEW, DISPLAY_DEVICEW, and
// D3DKMT_OPENADAPTERFROMGDIDISPLAYNAME documentation.
// Private DPI packets: https://github.com/lihas/windows-DPI-scaling-sample
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class NativeMonitorValidation {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct Device {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string description;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string id;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string key;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct Mode {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string device;
        public ushort spec, driver, size, extra;
        public uint fields;
        public int x,y;
        public uint orientation, fixedOutput;
        public short color, duplex, resolution, tt, collate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string form;
        public ushort logPixels;
        public uint bits, width, height, flags, frequency, icmMethod, icmIntent, media, dither, reserved1, reserved2, panWidth, panHeight;
    }
    [StructLayout(LayoutKind.Sequential)] public struct Luid { public uint lo; public int hi; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct OpenAdapter {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name;
        public uint handle;
        public Luid adapter;
        public uint source;
    }
    [StructLayout(LayoutKind.Sequential)] public struct Header { public int type; public uint size; public Luid adapter; public uint source; }
    [StructLayout(LayoutKind.Sequential)] public struct DpiGet { public Header header; public int minimum, current, maximum; }
    [StructLayout(LayoutKind.Sequential)] public struct DpiSet { public Header header; public int scale; }
    public class Monitor {
        public string name, description, deviceId;
        public bool primary, isVirtual;
        public int x,y,width,height,scalePercent,dpiQueryStatus;
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevices(string name,uint index,ref Device device,uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplaySettingsEx(string name,int index,ref Mode mode,uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string name,ref Mode mode,IntPtr window,uint flags,IntPtr parameter);
    [DllImport("user32.dll", EntryPoint="ChangeDisplaySettingsExW")] static extern int ApplySettings(IntPtr name,IntPtr mode,IntPtr window,uint flags,IntPtr parameter);
    [DllImport("user32.dll")] static extern int SetDisplayConfig(uint pathCount,IntPtr paths,uint modeCount,IntPtr modes,uint flags);
    [DllImport("gdi32.dll")] static extern int D3DKMTOpenAdapterFromGdiDisplayName(ref OpenAdapter adapter);
    [DllImport("gdi32.dll")] static extern int D3DKMTCloseAdapter(ref uint adapter);
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref DpiGet request);
    [DllImport("user32.dll")] static extern int DisplayConfigSetDeviceInfo(ref DpiSet request);
    static int[] scales = {100,125,150,175,200,225,250,300,350,400,450,500};
    static Mode GetMode(string name) {
        Mode mode = new Mode(); mode.size = (ushort)Marshal.SizeOf(typeof(Mode));
        if (!EnumDisplaySettingsEx(name,-1,ref mode,0)) throw new Exception("EnumDisplaySettingsEx failed: " + name);
        return mode;
    }
    static DpiGet GetDpi(string name, out int result) {
        OpenAdapter adapter = new OpenAdapter(); adapter.name=name;
        DpiGet get = new DpiGet();
        result=D3DKMTOpenAdapterFromGdiDisplayName(ref adapter);
        if(result!=0) return get;
        get.header.type=-3; get.header.size=(uint)Marshal.SizeOf(typeof(DpiGet));
        get.header.adapter=adapter.adapter; get.header.source=adapter.source;
        D3DKMTCloseAdapter(ref adapter.handle);
        result=DisplayConfigGetDeviceInfo(ref get); return get;
    }
    public static Monitor[] List() {
        List<Monitor> list = new List<Monitor>();
        for(uint index=0;;index++) {
            Device device = new Device(); device.cb=Marshal.SizeOf(typeof(Device));
            if(!EnumDisplayDevices(null,index,ref device,0)) break;
            if((device.flags&1)==0 || (device.flags&8)!=0) continue;
            Mode mode=GetMode(device.name);
            int result; DpiGet dpi=GetDpi(device.name,out result);
            int scaleIndex=dpi.current-dpi.minimum;
            string identity=(device.description+" "+device.id).ToLowerInvariant();
            list.Add(new Monitor {name=device.name,description=device.description,deviceId=device.id,
                primary=(device.flags&4)!=0,isVirtual=identity.Contains("mttvdd")||identity.Contains("iddsample")||identity.Contains("virtual display")||identity.Contains("virtualdisplaydriver"),
                x=mode.x,y=mode.y,width=(int)mode.width,height=(int)mode.height,
                scalePercent=result==0 && scaleIndex>=0 && scaleIndex<scales.Length?scales[scaleIndex]:0,dpiQueryStatus=result});
        }
        return list.ToArray();
    }
    public static void Extend() {
        int result=SetDisplayConfig(0,IntPtr.Zero,0,IntPtr.Zero,0x80|0x4);
        if(result!=0) throw new Exception("SetDisplayConfig EXTEND failed: "+result);
    }
    public static string SaveMode(string name) {
        Mode mode=GetMode(name);
        int size=Marshal.SizeOf(typeof(Mode));
        IntPtr pointer=Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(mode,pointer,false);
            byte[] bytes=new byte[size];
            Marshal.Copy(pointer,bytes,0,size);
            return Convert.ToBase64String(bytes);
        } finally { Marshal.FreeHGlobal(pointer); }
    }
    // Detach the source from the desktop without destroying its PnP monitor or
    // restarting its adapter. Stage all changes before CommitModes().
    // https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-changedisplaysettingsexw
    public static void StageDetach(string name) {
        Mode mode=GetMode(name);
        mode.fields=0x180020; // DM_POSITION | DM_PELSWIDTH | DM_PELSHEIGHT
        mode.width=0;mode.height=0;mode.x=0;mode.y=0;
        int result=ChangeDisplaySettingsEx(name,ref mode,IntPtr.Zero,0x10000001,IntPtr.Zero);
        if(result!=0) throw new Exception("Stage display detach failed: "+name+" result="+result);
    }
    public static void StageRestore(string name,string savedMode) {
        byte[] bytes=Convert.FromBase64String(savedMode);
        int size=Marshal.SizeOf(typeof(Mode));
        if(bytes.Length!=size) throw new Exception("Saved DEVMODE has an unexpected size");
        IntPtr pointer=Marshal.AllocHGlobal(size);
        Mode mode;
        try {
            Marshal.Copy(bytes,0,pointer,size);
            mode=(Mode)Marshal.PtrToStructure(pointer,typeof(Mode));
        } finally { Marshal.FreeHGlobal(pointer); }
        mode.fields|=0x180020;
        int result=ChangeDisplaySettingsEx(name,ref mode,IntPtr.Zero,0x10000001,IntPtr.Zero);
        if(result!=0) throw new Exception("Stage display restore failed: "+name+" result="+result);
    }
    public static void CommitModes() {
        int result=ApplySettings(IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,0,IntPtr.Zero);
        if(result!=0) throw new Exception("Apply display mode changes failed: "+result);
    }
    public static void Layout(bool reverse) {
        List<Monitor> monitors=new List<Monitor>(List());
        monitors.Sort(delegate(Monitor a,Monitor b) { if(a.primary!=b.primary) return a.primary?-1:1; return String.CompareOrdinal(a.name,b.name); });
        int x=0;
        foreach(Monitor monitor in monitors) {
            Mode mode=GetMode(monitor.name);
            if(monitor.primary) {mode.x=0;mode.y=0;x=reverse?0:(int)mode.width;}
            else {mode.x=reverse?-x-(int)mode.width:x;mode.y=0;x+=(int)mode.width;}
            mode.fields=0x20; // DM_POSITION; preserve each actual display mode.
            int result=ChangeDisplaySettingsEx(monitor.name,ref mode,IntPtr.Zero,0x10000001,IntPtr.Zero);
            if(result!=0) throw new Exception("Stage display position failed: "+monitor.name+" result="+result);
        }
        int applied=ApplySettings(IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,0,IntPtr.Zero);
        if(applied!=0) throw new Exception("Apply display positions failed: "+applied);
    }
    public static void SetScale(string name,int percent) {
        int result; DpiGet get=GetDpi(name,out result);
        if(result!=0) throw new Exception("DPI query unsupported for "+name+": "+result);
        int index=Array.IndexOf(scales,percent);
        if(index<0) throw new Exception("Unsupported scale percentage: "+percent);
        int relative=index+get.minimum;
        if(relative<get.minimum||relative>get.maximum) throw new Exception("Requested DPI outside supported range for "+name);
        DpiSet set=new DpiSet(); set.header=get.header;set.header.type=-4;set.header.size=(uint)Marshal.SizeOf(typeof(DpiSet));set.scale=relative;
        result=DisplayConfigSetDeviceInfo(ref set);
        if(result!=0) throw new Exception("DPI set failed for "+name+": "+result);
    }
}
