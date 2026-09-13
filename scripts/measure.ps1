# Run the isolated measurement sweep from PowerShell.
#
#   .\scripts\measure.ps1              # one pass over all 24 folders
#   .\scripts\measure.ps1 -Passes 10   # the full campaign (~20 min)
#   .\scripts\measure.ps1 -Folder depth-001
#
# Exists because three separate things go wrong doing this by hand in PowerShell,
# and all three fail QUIETLY:
#
#   1. `NODE_OPTIONS=--expose-gc cmd` is bash syntax. PowerShell reads it as a
#      command name and stops. Setting it per-session is easy to forget, and
#      forgetting it does not error -- it records gcForced:false and an
#      unreliable heap baseline that is not comparable with the committed data.
#   2. `tail -1` does not exist in PowerShell; the equivalent is
#      `Select-Object -Last 1`.
#   3. `>>` writes a UTF-8 BOM at the head of the file, which lands on the first
#      character of the first JSON record. The collector strips it defensively,
#      but -Encoding ascii avoids writing it at all.
#
# Append-only: this never rewrites runs.ndjson, so stopping and resuming is safe.
param(
  [int]$Passes = 1,
  [string]$Folder = "",
  [string]$Out = "runs.ndjson"
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Set for THIS process, so it cannot be lost between commands.
$env:NODE_OPTIONS = "--expose-gc"

$root = "../test_input/measurement"
if ($Folder -ne "") {
  $folders = @(Join-Path $root $Folder)
} else {
  $folders = Get-ChildItem -Path $root -Directory | Sort-Object Name | ForEach-Object { Join-Path $root $_.Name }
}
if ($folders.Count -eq 0) { Write-Error "no folders found under $root"; exit 1 }

Write-Host ("measuring {0} folder(s) x {1} pass(es) -> {2}" -f $folders.Count, $Passes, $Out)
$started = Get-Date

for ($p = 1; $p -le $Passes; $p++) {
  $i = 0
  foreach ($f in $folders) {
    $i++
    $name = Split-Path $f -Leaf
    Write-Host ("  pass {0}/{1}  [{2,2}/{3}] {4}" -f $p, $Passes, $i, $folders.Count, $name) -NoNewline
    $line = npx vite-node scripts/benchmark.ts $f | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($line) -or -not $line.StartsWith("{")) {
      Write-Host "  FAILED (no JSON returned)" -ForegroundColor Red
      Write-Error "benchmark failed for $name -- run it alone to see the error"
      exit 1
    }
    # ascii: the payload is ASCII, and it keeps a BOM out of the file.
    Add-Content -Path $Out -Value $line -Encoding ascii
    $ms = ($line | ConvertFrom-Json).tTotal
    Write-Host ("  {0} ms" -f $ms)
  }
}

$elapsed = (Get-Date) - $started
Write-Host ("done in {0:mm}m{0:ss}s" -f $elapsed)
Write-Host ""
node scripts/measure-status.mjs $Out
