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
New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
$savedModesPath = Join-Path $StateDirectory 'windows-detached-modes.json'
switch ($Action) {
    'off' {
        $active = @([NativeMonitorValidation]::List())
        $virtual = @($active | Where-Object isVirtual)
        if ($virtual.Count -eq 0) { throw 'No active MttVDD outputs were found.' }
        if (@($active | Where-Object { $_.primary -and -not $_.isVirtual }).Count -ne 1) {
            throw 'Refusing to detach virtual outputs without an active nonvirtual primary display.'
        }
        $savedModes = @($virtual | ForEach-Object {
            [ordered]@{ name=$_.name; mode=[NativeMonitorValidation]::SaveMode($_.name); scalePercent=$_.scalePercent }
        })
        $savedModes | ConvertTo-Json -Depth 4 | Set-Content $savedModesPath -Encoding UTF8
        foreach ($display in $virtual) { [NativeMonitorValidation]::StageDetach($display.name) }
        [NativeMonitorValidation]::CommitModes()
        Start-Sleep -Seconds 4
        if (@([NativeMonitorValidation]::List() | Where-Object isVirtual).Count -gt 0) {
            throw 'Virtual display detach did not remove every VDD output from the desktop.'
        }
    }
    'on' {
        if (-not (Test-Path $savedModesPath)) { throw 'No saved display modes exist. Call off before on.' }
        # Windows PowerShell 5.1 returns a JSON array as one pipeline object.
        # An outer @() would nest it; foreach would then receive the whole array.
        $savedModes = Get-Content $savedModesPath -Raw | ConvertFrom-Json
        if ($null -eq $savedModes) { throw 'The saved display mode list is empty.' }
        foreach ($display in $savedModes) {
            if ($display.name -isnot [string] -or $display.mode -isnot [string]) {
                throw 'Each saved display mode must have scalar string name and mode fields.'
            }
            if ([string]::IsNullOrWhiteSpace($display.name) -or [string]::IsNullOrWhiteSpace($display.mode)) {
                throw 'A saved display name or mode is empty.'
            }
            # Validate every record before staging any changes.
            if ([Convert]::FromBase64String($display.mode).Length -ne 220) {
                throw "Saved DEVMODE has an unexpected length for $($display.name)."
            }
        }
        foreach ($display in $savedModes) { [NativeMonitorValidation]::StageRestore($display.name, $display.mode) }
        [NativeMonitorValidation]::CommitModes()
        Start-Sleep -Seconds 3
        $active = @([NativeMonitorValidation]::List())
        foreach ($display in $savedModes) {
            if ($display.name -notin $active.name) { throw "Restored source is absent: $($display.name)" }
            if ($display.scalePercent -gt 0) { [NativeMonitorValidation]::SetScale($display.name, $display.scalePercent) }
        }
        Start-Sleep -Seconds 2
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
$result = [ordered]@{ action=$Action; timestamp=[DateTime]::UtcNow.ToString('o'); displays=$inventory; connectionMechanism='GDI desktop source detach/restore; adapter remains enabled' }
New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
$json = $result | ConvertTo-Json -Depth 6
$json | Set-Content -Path (Join-Path $StateDirectory "windows-$Action.json") -Encoding UTF8
$json
