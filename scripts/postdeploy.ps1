$ErrorActionPreference = 'Stop'

$required = @(
  'AZURE_ENV_NAME',
  'AZURE_RESOURCE_GROUP',
  'AZURE_CONTAINER_REGISTRY_NAME',
  'AZURE_CONTAINER_REGISTRY_ENDPOINT',
  'AZURE_INGEST_JOB_NAME'
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
    [int] $MaxAttempts = 4,
    [int] $DelaySeconds = 15
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

$image = "$($env:AZURE_CONTAINER_REGISTRY_ENDPOINT)/norautron-ingest:$($env:AZURE_ENV_NAME)"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Push-Location $projectRoot
try {
  $null = Invoke-AzWithRetry -Arguments @(
    'acr', 'build',
    '--registry', $env:AZURE_CONTAINER_REGISTRY_NAME,
    '--image', "norautron-ingest:$($env:AZURE_ENV_NAME)",
    '--file', 'ingest/Dockerfile',
    '.',
    '--only-show-errors'
  )
}
finally {
  Pop-Location
}

$null = Invoke-AzWithRetry -Arguments @(
  'containerapp', 'job', 'registry', 'set',
  '--name', $env:AZURE_INGEST_JOB_NAME,
  '--resource-group', $env:AZURE_RESOURCE_GROUP,
  '--server', $env:AZURE_CONTAINER_REGISTRY_ENDPOINT,
  '--identity', 'system',
  '--only-show-errors'
)

$null = Invoke-AzWithRetry -Arguments @(
  'containerapp', 'job', 'update',
  '--name', $env:AZURE_INGEST_JOB_NAME,
  '--resource-group', $env:AZURE_RESOURCE_GROUP,
  '--image', $image,
  '--only-show-errors'
)

$execution = Invoke-AzWithRetry -Arguments @(
  'containerapp', 'job', 'start',
  '--name', $env:AZURE_INGEST_JOB_NAME,
  '--resource-group', $env:AZURE_RESOURCE_GROUP,
  '--query', 'name',
  '--output', 'tsv',
  '--only-show-errors'
)

Write-Host "Started ingestion execution: $execution"

$deadline = [DateTimeOffset]::UtcNow.AddMinutes(30)
do {
  Start-Sleep -Seconds 15
  $status = Invoke-AzWithRetry -Arguments @(
    'containerapp', 'job', 'execution', 'list',
    '--name', $env:AZURE_INGEST_JOB_NAME,
    '--resource-group', $env:AZURE_RESOURCE_GROUP,
    '--query', "[?name=='$execution'].properties.status | [0]",
    '--output', 'tsv',
    '--only-show-errors'
  )
  $status = $status.Trim()
  if ($status -eq 'Succeeded') {
    Write-Host "Ingestion execution succeeded: $execution"
    break
  }
  if ($status -in @('Failed', 'Stopped')) {
    throw "Ingestion execution $execution ended with status $status."
  }
  Write-Host "Ingestion execution $execution status: $($status ? $status : 'Pending')"
} while ([DateTimeOffset]::UtcNow -lt $deadline)

if ($status -ne 'Succeeded') {
  throw "Timed out waiting for ingestion execution $execution."
}
