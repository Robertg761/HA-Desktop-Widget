[CmdletBinding()]
param(
    [ValidateSet('list','off','on','scale','layout')][string]$Action = 'list',
    [string]$DisplayName,
    [int]$ScalePercent = 150,
    [switch]$Reverse,
    [string]$StateDirectory = $(if ($env:HA184_OUTPUT) { $env:HA184_OUTPUT } else { Join-Path (Get-Location) 'monitor-validation-results' })
)
$ErrorActionPreference = 'Stop'
if (-not ('NativeMonitorValidation' -as [type])) {
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-native.cs')
}
function Get-TestAdapter {
    @(Get-PnpDevice -Class Display | Where-Object {
        $hardware = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_HardwareIds' -ErrorAction SilentlyContinue
        @($hardware.Data) -contains 'Root\MttVDD'
    })
}
switch ($Action) {
    'off' {
        $devices = @(Get-TestAdapter)
        if ($devices.Count -eq 0) { throw 'The test MttVDD adapter was not found.' }
        foreach ($device in $devices) { Disable-PnpDevice -InstanceId $device.InstanceId -Confirm:$false | Out-Null }
        Start-Sleep -Seconds 4
    }
    'on' {
        $devices = @(Get-TestAdapter)
        if ($devices.Count -eq 0) { throw 'The test MttVDD adapter was not found.' }
        foreach ($device in $devices) { Enable-PnpDevice -InstanceId $device.InstanceId -Confirm:$false | Out-Null }
        Start-Sleep -Seconds 6
        [NativeMonitorValidation]::Extend()
        Start-Sleep -Seconds 3
    }
    'scale' {
        if (-not $DisplayName) {
            $virtual = @([NativeMonitorValidation]::List() | Where-Object isVirtual)
            if ($virtual.Count -eq 0) { throw 'No active virtual display exists for DPI scaling.' }
            $DisplayName = $virtual[0].name
        }
        [NativeMonitorValidation]::SetScale($DisplayName, $ScalePercent)
        Start-Sleep -Seconds 3
    }
    'layout' { [NativeMonitorValidation]::Layout($Reverse.IsPresent); Start-Sleep -Seconds 3 }
}
$inventory = @([NativeMonitorValidation]::List())
$result = [ordered]@{ action=$Action; timestamp=[DateTime]::UtcNow.ToString('o'); displays=$inventory }
New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
$json = $result | ConvertTo-Json -Depth 6
$json | Set-Content -Path (Join-Path $StateDirectory "windows-$Action.json") -Encoding UTF8
$json
