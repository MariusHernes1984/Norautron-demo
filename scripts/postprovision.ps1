$ErrorActionPreference = 'Stop'

$required = @(
  'AZURE_RESOURCE_GROUP',
  'AZURE_STORAGE_ACCOUNT_NAME',
  'AZURE_STORAGE_CONTAINER_NAME',
  'AZURE_SQL_SERVER_NAME',
  'SQL_SERVER',
  'SQL_DATABASE',
  'AZURE_KEY_VAULT_NAME',
  'AZURE_CONTAINER_APP_NAME',
  'AZURE_CONTAINER_APP_PRINCIPAL_ID',
  'AZURE_INGEST_JOB_NAME',
  'AZURE_INGEST_JOB_PRINCIPAL_ID'
)
foreach ($name in $required) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    throw "Missing azd output: $name"
  }
}

function Invoke-AzWithRetry {
  param(
    [Parameter(Mandatory)]
    [string[]] $Arguments,
    [int] $MaxAttempts = 6,
    [int] $DelaySeconds = 10
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $output = & az @Arguments 2>&1
    if ($LASTEXITCODE -eq 0) {
      return ($output -join [Environment]::NewLine)
    }
    if ($attempt -eq $MaxAttempts) {
      throw "Azure CLI failed after $MaxAttempts attempts: az $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }
    Write-Warning "Azure CLI attempt $attempt failed; retrying in $DelaySeconds seconds."
    Start-Sleep -Seconds $DelaySeconds
  }
}

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory)]
    [string] $Command,
    [Parameter(Mandatory)]
    [string[]] $Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $Command $($Arguments -join ' ')"
  }
}

function Get-KeyVaultSecret {
  param(
    [Parameter(Mandatory)]
    [string] $VaultName,
    [Parameter(Mandatory)]
    [string] $SecretName
  )

  for ($attempt = 1; $attempt -le 6; $attempt++) {
    $output = & az keyvault secret show `
      --vault-name $VaultName `
      --name $SecretName `
      --query value `
      --output tsv `
      --only-show-errors 2>&1
    if ($LASTEXITCODE -eq 0) {
      return ($output -join '').Trim()
    }
    if (($output -join [Environment]::NewLine) -match 'SecretNotFound') {
      return $null
    }
    if ($attempt -eq 6) {
      throw "Unable to read Key Vault secret after role-assignment retries: $($output -join [Environment]::NewLine)"
    }
    Start-Sleep -Seconds 10
  }
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workbook = Join-Path $projectRoot 'Norautron_syntetiske_data.xlsx'
if (-not (Test-Path $workbook)) {
  throw "Workbook not found: $workbook"
}

$venv = Join-Path $projectRoot '.azure\bootstrap-venv'
if (-not (Test-Path $venv)) {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if (-not $pythonCommand) {
    $pythonCommand = Get-Command python3 -ErrorAction Stop
  }
  Invoke-NativeCommand -Command $pythonCommand.Source -Arguments @('-m', 'venv', $venv)
}
$python = if ($IsWindows) {
  Join-Path $venv 'Scripts\python.exe'
} else {
  Join-Path $venv 'bin/python'
}
if (-not (Test-Path $python)) {
  throw "Virtual-environment Python executable not found: $python"
}

Invoke-NativeCommand -Command $python -Arguments @(
  '-m', 'pip', 'install',
  '--quiet',
  '--disable-pip-version-check',
  '-r', (Join-Path $projectRoot 'ingest\requirements.txt')
)
Invoke-NativeCommand -Command $python -Arguments @(
  (Join-Path $projectRoot 'ingest\main.py'),
  '--validate-only',
  $workbook
)

$null = Invoke-AzWithRetry -Arguments @(
  'storage', 'blob', 'upload',
  '--account-name', $env:AZURE_STORAGE_ACCOUNT_NAME,
  '--container-name', $env:AZURE_STORAGE_CONTAINER_NAME,
  '--name', 'Norautron_syntetiske_data.xlsx',
  '--file', $workbook,
  '--auth-mode', 'login',
  '--overwrite', 'true',
  '--only-show-errors'
)

$secretName = 'rate-limit-hmac-salt'
if (-not (Get-KeyVaultSecret -VaultName $env:AZURE_KEY_VAULT_NAME -SecretName $secretName)) {
  $salt = [Convert]::ToBase64String(
    [Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
  )
  $null = Invoke-AzWithRetry -Arguments @(
    'keyvault', 'secret', 'set',
    '--vault-name', $env:AZURE_KEY_VAULT_NAME,
    '--name', $secretName,
    '--value', $salt,
    '--only-show-errors'
  )
}

$ip = (Invoke-RestMethod -Uri 'https://api.ipify.org').Trim()
$parsedIp = $null
if (
  -not [Net.IPAddress]::TryParse($ip, [ref] $parsedIp) -or
  $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork
) {
  throw "Could not determine a valid public IPv4 address for SQL bootstrap."
}

$firewallName = 'azd-bootstrap'
$firewallCreated = $false
$null = Invoke-AzWithRetry -Arguments @(
  'sql', 'server', 'firewall-rule', 'create',
  '--resource-group', $env:AZURE_RESOURCE_GROUP,
  '--server', $env:AZURE_SQL_SERVER_NAME,
  '--name', $firewallName,
  '--start-ip-address', $ip,
  '--end-ip-address', $ip,
  '--only-show-errors'
)
$firewallCreated = $true

try {
  $env:AZURE_CONTAINER_APP_CLIENT_ID = (
    Invoke-AzWithRetry -Arguments @(
      'ad', 'sp', 'show',
      '--id', $env:AZURE_CONTAINER_APP_PRINCIPAL_ID,
      '--query', 'appId',
      '--output', 'tsv',
      '--only-show-errors'
    )
  ).Trim()
  $env:AZURE_INGEST_JOB_CLIENT_ID = (
    Invoke-AzWithRetry -Arguments @(
      'ad', 'sp', 'show',
      '--id', $env:AZURE_INGEST_JOB_PRINCIPAL_ID,
      '--query', 'appId',
      '--output', 'tsv',
      '--only-show-errors'
    )
  ).Trim()
  if (
    -not $env:AZURE_CONTAINER_APP_CLIENT_ID -or
    -not $env:AZURE_INGEST_JOB_CLIENT_ID
  ) {
    throw 'Could not resolve managed identity client IDs for SQL grants.'
  }

  $bootstrapArguments = @(
    (Join-Path $PSScriptRoot 'bootstrap_db.mjs'),
    (Join-Path $projectRoot 'db\schema.sql'),
    (Join-Path $projectRoot 'db\grants.sql')
  )
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    & node @bootstrapArguments
    if ($LASTEXITCODE -eq 0) {
      break
    }
    if ($attempt -eq 6) {
      throw "Database bootstrap failed after 6 attempts."
    }
    Write-Warning "Database bootstrap attempt $attempt failed; retrying in 10 seconds."
    Start-Sleep -Seconds 10
  }
}
finally {
  if ($firewallCreated) {
    $null = Invoke-AzWithRetry -Arguments @(
      'sql', 'server', 'firewall-rule', 'delete',
      '--resource-group', $env:AZURE_RESOURCE_GROUP,
      '--server', $env:AZURE_SQL_SERVER_NAME,
      '--name', $firewallName,
      '--only-show-errors'
    )
  }
}
