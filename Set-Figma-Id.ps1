param([Parameter(Mandatory=$true)][ValidatePattern('^\d+$')][string]$PluginId)
$ErrorActionPreference = 'Stop'
$bridgeManifestPath = Join-Path $PSScriptRoot 'figma/manifest.json'
$bridgeManifest = Get-Content -LiteralPath $bridgeManifestPath -Raw | ConvertFrom-Json
$bridgeManifest | Add-Member -NotePropertyName id -NotePropertyValue $PluginId -Force
$bridgeJson = $bridgeManifest | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($bridgeManifestPath, $bridgeJson, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Figma-assigned ID saved. Import figma/manifest.json in Figma Desktop.'
