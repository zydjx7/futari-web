[CmdletBinding()]
param(
    [Parameter(Mandatory,Position=0)][ValidateSet('Prepare','Web','Desktop')][string]$Step,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$store = Join-Path $env:LOCALAPPDATA 'PrivateNotes\paper-notes-c2909a30'
$current = Join-Path $store 'production.clixml'
$pending = Join-Path $store 'pending-scoped.clixml'
function Plain([securestring]$Value) { [Net.NetworkCredential]::new('', $Value).Password }
function CharacterCount([string]$Value) {
    [regex]::Matches($Value, '(?s)[\uD800-\uDBFF][\uDC00-\uDFFF]|.').Count
}
if ($Step -eq 'Prepare') {
    $her = Read-Host '她的新暗号（8–256 个字符）' -AsSecureString
    $admin = Read-Host '你的新暗号（8–256 个字符）' -AsSecureString
    $key = if (Test-Path -LiteralPath $current) { (Import-Clixml -LiteralPath $current).SESSION_SECRET }
    if (!$key) { $key = Read-Host '现有生产 SESSION_SECRET（沿用签名密钥）' -AsSecureString }
    $h = Plain $her
    $a = Plain $admin
    $s = Plain $key
    foreach ($v in @($h,$a)) {
        $n = CharacterCount $v
        if ($n -lt 8 -or $n -gt 256) { throw '每个暗号需要 8–256 个字符。' }
    }
    if ((CharacterCount $s) -lt 32 -or $a -ceq $h -or $a -ceq $s -or $h -ceq $s) { throw '两句暗号与至少 32 位的签名密钥必须各不相同。' }
    [IO.Directory]::CreateDirectory($store) | Out-Null
    [pscustomobject]@{PASSCODE_HER=$her; PASSCODE_ADMIN=$admin; SESSION_SECRET=$key} | Export-Clixml -LiteralPath $pending
    Write-Output '两套 Worker 的新暗号已用当前 Windows 账户加密暂存。'
    return
}
if (!(Test-Path -LiteralPath $pending)) { throw '请先运行 Prepare，准备这次发布使用的暗号。' }
$vault = Import-Clixml -LiteralPath $pending
$privateDir = Join-Path ([IO.Path]::GetTempPath()) ('futari-worker-secrets-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($privateDir) | Out-Null
$file = Join-Path $privateDir 'secrets.json'
try {
    $acl = Get-Acl -LiteralPath $privateDir
    $acl.SetAccessRuleProtection($true,$false)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    Set-Acl -LiteralPath $privateDir -AclObject $acl
    $values = @{}
    foreach ($name in 'PASSCODE_HER','PASSCODE_ADMIN','SESSION_SECRET') {
        $values[$name] = Plain $vault.$name
    }
    [IO.File]::WriteAllText($file,($values | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
    $config = if ($Step -eq 'Web') { 'wrangler.jsonc' } else { 'desktop/cloud/wrangler.jsonc' }
    $arguments = @('deploy','--config',(Join-Path $project $config),'--env','production','--secrets-file',$file)
    if ($DryRun) { $arguments += '--dry-run' }
    Push-Location $project
    try {
        & node (Join-Path $project 'node_modules/wrangler/bin/wrangler.js') @arguments
        if ($LASTEXITCODE) { throw "部署步骤 $Step 失败，可用同一份暂存暗号重试。" }
    } finally { Pop-Location }
    if (!$DryRun -and $Step -eq 'Web') { Copy-Item -LiteralPath $pending -Destination $current -Force }
    if (!$DryRun -and $Step -eq 'Desktop' -and (Test-Path -LiteralPath $current)) {
        if ((Get-FileHash -LiteralPath $current).Hash -eq (Get-FileHash -LiteralPath $pending).Hash) { [IO.File]::Delete($pending) }
    }
} finally {
    if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) }
    [IO.Directory]::Delete($privateDir)
}
