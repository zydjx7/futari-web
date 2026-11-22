param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('her', 'admin')]
    [string]$Role
)

$ErrorActionPreference = 'Stop'
$vaultPath = Join-Path $env:LOCALAPPDATA 'PrivateNotes\paper-notes-c2909a30\production.clixml'
$vault = Import-Clixml -LiteralPath $vaultPath
$secret = $vault.PSObject.Properties['PASSCODE_' + $Role.ToUpperInvariant()].Value
Set-Clipboard -Value ([System.Net.NetworkCredential]::new('', $secret).Password)
Write-Output ("Copied the " + $Role + " passcode.")
