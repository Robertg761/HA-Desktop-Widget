[CmdletBinding()]
param([string]$StateDirectory = $(if ($env:HA184_OUTPUT) { $env:HA184_OUTPUT } else { Join-Path (Get-Location) 'monitor-validation-results' }))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
Start-Transcript -Path (Join-Path $StateDirectory 'windows-setup.log') -Force | Out-Null
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Driver installation requires an elevated disposable Windows runner.'
    }
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-native.cs')
    $before = @([NativeMonitorValidation]::List())
    $before | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $StateDirectory 'windows-before.json') -Encoding UTF8
    if ($before.Count -lt 1) { throw 'No interactive Windows display is available before driver installation.' }
    $download = Join-Path $StateDirectory 'driver'
    New-Item -ItemType Directory -Path $download -Force | Out-Null
    # Pinned releases from the driver project's reviewed Community Scripts/silent-install.ps1.
    # https://github.com/VirtualDrivers/Virtual-Display-Driver/blob/master/Community%20Scripts/silent-install.ps1
    Invoke-WebRequest 'https://github.com/nefarius/nefcon/releases/download/v1.14.0/nefcon_v1.14.0.zip' -OutFile "$download\nefcon.zip" -UseBasicParsing
    Invoke-WebRequest 'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip' -OutFile "$download\vdd.zip" -UseBasicParsing
    Get-FileHash "$download\nefcon.zip", "$download\vdd.zip" | Format-List
    Expand-Archive "$download\nefcon.zip" $download -Force
    Expand-Archive "$download\vdd.zip" $download -Force
    $driverDirectory = Join-Path $download 'VirtualDisplayDriver'
    [xml]$settings = Get-Content "$driverDirectory\vdd_settings.xml"
    $settings.vdd_settings.monitors.count = '2'
    $settings.vdd_settings.options.logging = 'true'
    # Limit modes so both independent outputs start at a useful and predictable resolution.
    foreach ($mode in @($settings.vdd_settings.resolutions.resolution)) {
        if ($mode.width -ne '1920' -or $mode.height -ne '1080') { [void]$settings.vdd_settings.resolutions.RemoveChild($mode) }
    }
    New-Item -ItemType Directory -Path 'C:\VirtualDisplayDriver' -Force | Out-Null
    $settings.Save('C:\VirtualDisplayDriver\vdd_settings.xml')
    $settings.Save("$driverDirectory\vdd_settings.xml")
    Copy-Item 'C:\VirtualDisplayDriver\vdd_settings.xml' (Join-Path $StateDirectory 'windows-vdd-settings.xml') -Force
    $certificates = New-Object Security.Cryptography.X509Certificates.X509Certificate2Collection
    $certificates.Import([IO.File]::ReadAllBytes("$driverDirectory\mttvdd.cat"))
    foreach ($certificate in $certificates) {
        $certificatePath = Join-Path $download ($certificate.Thumbprint + '.cer')
        [IO.File]::WriteAllBytes($certificatePath, $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
        Import-Certificate -FilePath $certificatePath -CertStoreLocation 'Cert:\LocalMachine\TrustedPublisher' | Out-Null
    }
    & "$download\x64\nefconw.exe" install "$driverDirectory\MttVDD.inf" 'Root\MttVDD'
    if ($LASTEXITCODE -ne 0) { throw "nefcon driver install failed: $LASTEXITCODE" }
    Start-Sleep -Seconds 12
    Get-PnpDevice -Class Display | Format-List | Out-String | Set-Content (Join-Path $StateDirectory 'windows-adapters.txt')
    [NativeMonitorValidation]::Extend()
    Start-Sleep -Seconds 5
    [NativeMonitorValidation]::Layout($false)
    $monitors = @([NativeMonitorValidation]::List())
    $virtual = @($monitors | Where-Object isVirtual)
    if ($virtual.Count -lt 2) {
        $monitors | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $StateDirectory 'windows-failed-inventory.json')
        throw "Expected two active MttVDD outputs; found $($virtual.Count)."
    }
    # DPI control uses private Windows packets; record unsupported runners without claiming coverage.
    $dpiErrors = @()
    foreach ($monitor in $monitors) {
        $percent = if ($monitor.name -eq $virtual[0].name) { 150 } else { 100 }
        try { [NativeMonitorValidation]::SetScale($monitor.name, $percent) }
        catch { $dpiErrors += $_.Exception.Message; Write-Warning $_.Exception.Message }
    }
    Start-Sleep -Seconds 5
    $actual = @([NativeMonitorValidation]::List())
    $scales = @($actual | Where-Object { $_.scalePercent -gt 0 } | Select-Object -ExpandProperty scalePercent -Unique)
    [ordered]@{
        timestamp=[DateTime]::UtcNow.ToString('o'); displays=$actual;
        mixedDpiAvailable=($scales.Count -ge 2); dpiErrors=$dpiErrors;
        driverRelease='25.7.23'; nefconRelease='1.14.0';
        dpiMechanism='Private DisplayConfigGet/SetDeviceInfo types -3/-4; confirmed by actual returned scale percentages'
    } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $StateDirectory 'windows-setup.json') -Encoding UTF8
    Get-Content (Join-Path $StateDirectory 'windows-setup.json')
}
finally { Stop-Transcript | Out-Null }
