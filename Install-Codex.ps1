$ErrorActionPreference = 'Stop'
$bridgeNode = (Get-Command node -ErrorAction Stop).Source
$bridgeCodex = (Get-Command codex -ErrorAction Stop).Source
$bridgeEntry = Join-Path $PSScriptRoot 'server/mcp.mjs'
& $bridgeCodex mcp add figma-local-bridge -- $bridgeNode $bridgeEntry
if ($LASTEXITCODE -ne 0) { throw 'Codex MCP registration failed.' }
Write-Host 'Registered figma-local-bridge. Open a new Codex task, start Start-Bridge.ps1, and pair the Figma plugin.'
