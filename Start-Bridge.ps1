$ErrorActionPreference = 'Stop'
$bridgeNode = (Get-Command node -ErrorAction Stop).Source
& $bridgeNode (Join-Path $PSScriptRoot 'server/broker.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Bridge exited with an error.' }
