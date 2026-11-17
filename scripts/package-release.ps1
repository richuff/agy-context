param(
  [string]$Version
)

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifest = Get-Content -LiteralPath (Join-Path $repo 'plugin.json') -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = $manifest.version }
$dist = Join-Path $repo 'dist'
$stage = Join-Path $dist '.package-root'
$verify = Join-Path $dist '.zip-verify'
$zip = Join-Path $dist "agy-context-$Version.zip"

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path -LiteralPath $stage) {
  $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
  if (-not $resolvedStage.StartsWith($dist, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove a staging directory outside dist.'
  }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
if (Test-Path -LiteralPath $zip) {
  throw "Release asset already exists: $zip"
}

New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'plugin.json'), (Join-Path $repo 'README.md'), (Join-Path $repo 'README_zh.md'), (Join-Path $repo 'CHANGELOG.md'), (Join-Path $repo 'LICENSE') -Destination $stage
foreach ($path in @('assets', 'sidecars', 'skills')) {
  Copy-Item -LiteralPath (Join-Path $repo $path) -Destination $stage -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'scripts/stats.mjs') -Destination (Join-Path $stage 'scripts')

agy plugin validate $stage --json
if ($LASTEXITCODE -ne 0) { throw 'Staged package validation failed.' }

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
if (Test-Path -LiteralPath $verify) {
  $resolvedVerify = (Resolve-Path -LiteralPath $verify).Path
  if (-not $resolvedVerify.StartsWith($dist, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove a verification directory outside dist.'
  }
  Remove-Item -LiteralPath $resolvedVerify -Recurse -Force
}
Expand-Archive -LiteralPath $zip -DestinationPath $verify
if (-not (Test-Path -LiteralPath (Join-Path $verify 'plugin.json')) -or
    -not (Test-Path -LiteralPath (Join-Path $verify 'sidecars/context-panel/panel.js'))) {
  throw 'The ZIP is missing required plugin files at its root.'
}
agy plugin validate $verify --json
if ($LASTEXITCODE -ne 0) { throw 'Extracted ZIP validation failed.' }
Write-Output "Package: $zip"

foreach ($path in @($stage, $verify)) {
  $resolved = (Resolve-Path -LiteralPath $path).Path
  if ($resolved.StartsWith($dist, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
