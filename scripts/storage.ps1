# storage.ps1 - HyperZenith Antigravity Storage Controller
param (
    [Parameter(Mandatory = $true)]
    [ValidateSet("MOUNT", "UNMOUNT", "HYDRATE", "ANTIGRAVITY")]
    [string]$Action,
    
    [int]$SizeGB = 4,
    [string]$DriveLetter = "Z",
    [string]$SourcePath = "",
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
$RamDiskRoot = "${DriveLetter}:\HyperZenithCache"

function Get-RedirectPaths {
    param([string]$Root)
    $androidRoot = if (Test-Path "$Root\android") { "$Root\android" } else { $Root }
    return @(
        @{ Source = "$androidRoot\app\build\intermediates"; Dest = "$RamDiskRoot\intermediates" },
        @{ Source = "$androidRoot\app\build\tmp"; Dest = "$RamDiskRoot\tmp" },
        @{ Source = "$androidRoot\app\build\generated"; Dest = "$RamDiskRoot\generated" }
    )
}

function Start-RamDiskMount {
    Write-Host "[HyperZenith] Mounting ${SizeGB}GB RAM Disk to ${DriveLetter}:\" -ForegroundColor Cyan
    $imdisk = Get-Command imdisk -ErrorAction SilentlyContinue
    if (-not $imdisk) { Write-Error "ImDisk Toolkit not found."; exit 1 }
    if (Test-Path "${DriveLetter}:\") { Write-Host "  -> Already mounted." -ForegroundColor Yellow; return }
    $sizeBytes = $SizeGB * 1024 * 1024 * 1024
    imdisk -a -s $sizeBytes -m "${DriveLetter}:" -p "/fs:ntfs /q /y" | Out-Null
    New-Item -ItemType Directory -Force -Path $RamDiskRoot | Out-Null
    Write-Host "  -> RAM Disk mounted!" -ForegroundColor Green
}

function Stop-RamDiskMount {
    Write-Host "[HyperZenith] Unmounting RAM Disk" -ForegroundColor Cyan
    if (-not (Test-Path "${DriveLetter}:\")) { Write-Host "  -> Not mounted." -ForegroundColor Yellow; return }
    imdisk -D -m "${DriveLetter}:" | Out-Null
    Write-Host "  -> Unmounted." -ForegroundColor Green
}

function Start-CacheHydration {
    param([string]$Source)
    if (-not $Source -or -not (Test-Path $Source)) { Write-Host "[HyperZenith] No source. Skipping." -ForegroundColor Yellow; return }
    Write-Host "[HyperZenith] Hydrating from: $Source" -ForegroundColor Cyan
    $destPath = "$RamDiskRoot\ProjectCache"
    New-Item -ItemType Directory -Force -Path $destPath | Out-Null
    robocopy $Source $destPath /MIR /MT:32 /R:1 /W:1 /NFL /NDL /NJH /NJS
    Write-Host "  -> Hydration complete!" -ForegroundColor Green
}

function Start-AntigravityMount {
    param([string]$Root)
    if (-not $Root) { Write-Error "ProjectRoot required"; exit 1 }
    Write-Host "[Antigravity] RAM Disk Mounts..." -ForegroundColor Magenta
    $redirects = Get-RedirectPaths -Root $Root
    foreach ($map in $redirects) {
        $src = $map.Source; $dst = $map.Dest
        if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Force -Path $dst | Out-Null }
        $parent = Split-Path -Parent $src
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
        if (Test-Path $src) {
            $item = Get-Item $src -Force
            if ($item.Attributes.HasFlag([System.IO.FileAttributes]::ReparsePoint)) { Write-Host "  -> Linked already: $src" -ForegroundColor Gray; continue }
            else { Move-Item -Path "$src\*" -Destination $dst -Force -ErrorAction SilentlyContinue; Remove-Item $src -Force -Recurse -ErrorAction SilentlyContinue }
        }
        cmd /c mklink /J "$src" "$dst" 2>$null | Out-Null
        Write-Host "  -> LINKED: $src" -ForegroundColor Green
    }
    Write-Host "[Antigravity] Done!" -ForegroundColor Magenta
}

switch ($Action) {
    "MOUNT" { Start-RamDiskMount; if ($SourcePath) { Start-CacheHydration -Source $SourcePath } }
    "UNMOUNT" { Stop-RamDiskMount }
    "HYDRATE" { Start-CacheHydration -Source $SourcePath }
    "ANTIGRAVITY" { Start-RamDiskMount; if ($SourcePath) { Start-CacheHydration -Source $SourcePath }; Start-AntigravityMount -Root $ProjectRoot }
}
Write-Host "[HyperZenith] Done." -ForegroundColor Cyan
