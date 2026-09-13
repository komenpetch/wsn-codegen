# INTEGRATED measurement campaign, PowerShell port of scripts/bench-integrated.sh.
#
#   .\scripts\bench-integrated.ps1
#   .\scripts\bench-integrated.ps1 -Campaigns 1        # quick smoke test
#   .\scripts\bench-integrated.ps1 -Out ../paper/data/bench-integrated.json
#
# Measures the whole pipeline on the REAL Rodin project this work uses as input, and
# answers "what does generation cost on the model we actually have". The companion is
# scripts/measure.ps1, which sweeps one synthetic scale parameter at a time.
#
# WHY A PORT EXISTS. The .sh version needs bash AND needs `node` on the PATH that bash
# inherits; invoked from PowerShell on Windows it typically finds neither, and fails
# midway with "node: command not found" after already printing a header, which looks
# like a broken script rather than a missing tool. This version has no bash dependency.
# The .sh remains the reference for anyone on a Unix shell; both write the same document.
#
# Defaults to ../paper2/data/. The .sh defaults to ../paper/ for backward compatibility,
# which is the wrong target for this paper and is the most common way to measure into the
# wrong place.
param(
  [int]$Campaigns = 10,
  [string]$Out = "../paper2/data/bench-integrated.json"
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Set for THIS process so it cannot be lost: without it the heap baseline is an upper
# bound rather than an exact post-GC figure, and gcForced is recorded false.
$env:NODE_OPTIONS = "--expose-gc"

# C0_project is the REPORTED case study. WSN_Pattern_shDecom6_3 is a generation smoke
# test that is NOT reported in the paper; it is measured when present and skipped when
# not, exactly as in the .sh.
$models = @(
  "../Update_wsn/C0_project",
  "../test_input/test_input/WSN_Pattern_shDecom6_3"
)

$records = @()
foreach ($m in $models) {
  if (-not (Test-Path $m -PathType Container)) {
    Write-Host "skip (missing): $m"
    continue
  }
  Write-Host ("{0}: {1} campaigns" -f $m, $Campaigns)
  $lines = New-Object System.Collections.Generic.List[string]
  for ($i = 1; $i -le $Campaigns; $i++) {
    Write-Host ("  campaign {0}/{1}" -f $i, $Campaigns) -NoNewline
    $line = npx vite-node scripts/benchmark.ts $m | Select-Object -Last 1
    if ([string]::IsNullOrWhiteSpace($line) -or -not $line.StartsWith("{")) {
      Write-Host "  FAILED" -ForegroundColor Red
      Write-Error "benchmark failed for $m -- run it alone to see the error"
      exit 1
    }
    $lines.Add($line)
    Write-Host ("  {0} ms" -f ($line | ConvertFrom-Json).tTotal)
  }
  # Same aggregator the .sh and the sweep use: median of the stage times, T_total derived
  # as their sum, spread fields carried through. Never reimplemented.
  $agg = ($lines -join "`n") | node scripts/aggregate-campaigns.mjs
  if ([string]::IsNullOrWhiteSpace($agg)) { Write-Error "aggregation failed for $m"; exit 1 }
  $records += $agg.Trim()
}

if ($records.Count -eq 0) { Write-Error "no models measured"; exit 1 }

$json = "[`n" + ($records -join ",`n") + "`n]`n"
# ascii keeps a BOM out of the file; the payload is ASCII.
Set-Content -Path $Out -Value $json -Encoding ascii -NoNewline

# Fail loudly if what was written is not parseable, rather than leaving a broken file.
node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" $Out
if ($LASTEXITCODE -ne 0) { Write-Error "$Out is not valid JSON"; exit 1 }

Write-Host ""
Write-Host "wrote $Out"
foreach ($r in $records) {
  $x = $r | ConvertFrom-Json
  Write-Host ("  {0,-24} clauses={1} kB={2} outLines={3} untranslated={4} tTotal={5} ms peak={6} MB" -f `
    $x.model, $x.clauses, $x.inputKB, $x.outLines, $x.untranslated, $x.tTotal, $x.peakMB)
}
