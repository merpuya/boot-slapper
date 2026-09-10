<#
install.ps1 — boot-slapper fresh-box shim (Windows)
  irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex
Ensures node >= 22.5 and git (winget), clones or fast-forwards $env:BOOT_SLAPPER_DIR (default ~\projects\boot-slapper),
builds, then runs `bs onboard`. Idempotent. `iex` cannot pass arguments: for flags run
  node "$HOME\projects\boot-slapper\dist\cli.js" onboard --auto
#>
$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/merpuya/boot-slapper.git"
$Dir = if ($env:BOOT_SLAPPER_DIR) { $env:BOOT_SLAPPER_DIR } else { Join-Path $HOME "projects\boot-slapper" }

function Say($m) { Write-Host "==> $m" -ForegroundColor Blue }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
function Test-NodeOk {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  $parts = ((& node --version) -replace '^v', '').Split('.')
  $maj = [int]$parts[0]; $min = [int]$parts[1]
  return ($maj -gt 22) -or ($maj -eq 22 -and $min -ge 5)
}

if (-not (Test-NodeOk)) {
  Say "installing Node.js LTS via winget"
  winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Test-NodeOk)) { throw "node >= 22.5 is still not on PATH — open a new terminal and re-run" }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Say "installing Git via winget"
  winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is still not on PATH — open a new terminal and re-run" }
}

if (Test-Path (Join-Path $Dir ".git")) {
  Say "updating $Dir"
  & git -C $Dir pull --ff-only --quiet
  if ($LASTEXITCODE -ne 0) { Write-Warning "pull failed — using the existing checkout" }
} else {
  Say "cloning boot-slapper to $Dir"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dir) | Out-Null
  & git clone --quiet $RepoUrl $Dir
  if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
}

Say "building"
& npm ci --no-audit --no-fund --prefix $Dir --silent
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
& npm --prefix $Dir run --silent build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

Say "bs onboard"
& node (Join-Path $Dir "dist\cli.js") onboard
exit $LASTEXITCODE
