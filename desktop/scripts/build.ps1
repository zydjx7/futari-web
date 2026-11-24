[CmdletBinding()]
param([switch]$SkipArchive)
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $desktopRoot
foreach ($name in 'CARGO_HOME','RUSTUP_HOME') {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if ($value) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
}
if ($env:CARGO_HOME) { $env:Path = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:Path }
$env:CARGO_TARGET_DIR = Join-Path $desktopRoot 'build/cargo'
Push-Location $projectRoot
try {
    node desktop/scripts/prepare.mjs
    if ($LASTEXITCODE) { throw '本地前端素材准备失败' }
    cargo build --locked --release --features cloud-sync --manifest-path desktop/src-tauri/Cargo.toml
    if ($LASTEXITCODE) { throw 'Rust 编译失败' }
    $release = Join-Path $desktopRoot 'dist/FUTARI Desktop'
    [IO.Directory]::CreateDirectory($release) | Out-Null
    $destExe = Join-Path $release 'FUTARI Desktop.exe'
    $generation = [guid]::NewGuid().ToString('N')
    $newExe = Join-Path $release "$generation.tmp"
    $oldExe = Join-Path $desktopRoot "build/previous-$generation.exe"
    Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'release/futari-desktop.exe') -Destination $newExe
    try {
        # The running pet may keep its previous image mapped until the next launch.
        if ([IO.File]::Exists($destExe)) { [IO.File]::Move($destExe,$oldExe) }
        try { [IO.File]::Move($newExe,$destExe) }
        catch {
            if ([IO.File]::Exists($oldExe)) { [IO.File]::Move($oldExe,$destExe) }
            throw
        }
        if ([IO.File]::Exists($oldExe)) {
            try { [IO.File]::Delete($oldExe) }
            catch [IO.IOException], [UnauthorizedAccessException] { Write-Verbose '运行中的上一版映像保留在 build 目录。' }
        }
    } finally { if ([IO.File]::Exists($newExe)) { [IO.File]::Delete($newExe) } }
    $sceneDest=Join-Path $release 'scenes/snow-forest'
    [IO.Directory]::CreateDirectory($sceneDest) | Out-Null
    foreach ($part in 'bg.webp','fg.webp','scene.json') {
        Copy-Item -LiteralPath (Join-Path $desktopRoot "scenes/snow-forest/$part") -Destination (Join-Path $sceneDest $part) -Force
    }
    Copy-Item -LiteralPath (Join-Path $desktopRoot '使用说明.txt') -Destination $release -Force
    if (!$SkipArchive) {
        $zip = Join-Path $desktopRoot 'dist/FUTARI-Desktop-Windows-x64.zip'
        # Build an explicit allowlist archive so a private custom pack beside the EXE never ships.
        Add-Type -AssemblyName System.IO.Compression
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $stream=[IO.File]::Open($zip,[IO.FileMode]::Create)
        try {
            $archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
            try {foreach($entry in 'FUTARI Desktop.exe','使用说明.txt','scenes/snow-forest/bg.webp','scenes/snow-forest/fg.webp','scenes/snow-forest/scene.json'){
                [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $release $entry),"FUTARI Desktop/$entry",[IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }} finally { $archive.Dispose() }
        } finally { $stream.Dispose() }
        Get-Item -LiteralPath $zip | Select-Object FullName,Length
    }
} finally { Pop-Location }
