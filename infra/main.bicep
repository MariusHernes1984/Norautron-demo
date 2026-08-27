targetScope = 'subscription'

@minLength(1)
param environmentName string

@minLength(1)
param location string

@minLength(36)
@maxLength(36)
param principalId string

param principalName string = 'deployment-user'

@allowed([
  'User'
  'Group'
  'Application'
])
param principalType string = 'User'

@minLength(1)
param foundryResourceGroupName string = 'RG-KATE'

@minLength(2)
param foundryAccountName string = 'kateecosystem-resource'

@minLength(1)
param foundryDeploymentName string = 'gpt-5.6-terra'

@minLength(1)
param foundryEndpoint string = 'https://kateecosystem-resource.openai.azure.com'

var resourceGroupName = 'rg-norautron-analytics-${environmentName}'
var tags = {
  'azd-env-name': environmentName
  owner: 'KATE'
  costcenter: 'KATE-DEV'
  environment: environmentName
  project: 'norautron-analytics'
}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module app './resources.bicep' = {
  name: 'norautron-analytics-resources'
  scope: resourceGroup
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    sqlAdminObjectId: principalId
    sqlAdminName: principalName
    sqlAdminPrincipalType: principalType
    foundryEndpoint: foundryEndpoint
    foundryDeploymentName: foundryDeploymentName
  }
}

module resourceAccess './role-assignments.bicep' = {
  name: 'norautron-analytics-resource-access'
  scope: resourceGroup
  params: {
    acrName: app.outputs.acrName
    storageAccountName: app.outputs.storageAccountName
    keyVaultName: app.outputs.keyVaultName
    applicationInsightsName: app.outputs.applicationInsightsName
    webPrincipalId: app.outputs.webPrincipalId
    ingestPrincipalId: app.outputs.ingestPrincipalId
    deployerPrincipalId: principalId
    deployerPrincipalType: principalType
  }
}

module foundryAccess './foundry-role-assignment.bicep' = {
  name: 'norautron-analytics-foundry-access'
  scope: az.resourceGroup(foundryResourceGroupName)
  params: {
    accountName: foundryAccountName
    principalId: app.outputs.webPrincipalId
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup.name
output AZURE_CONTAINER_REGISTRY_NAME string = app.outputs.acrName
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = app.outputs.acrLoginServer
output AZURE_CONTAINER_APP_NAME string = app.outputs.webAppName
output AZURE_CONTAINER_APP_PRINCIPAL_ID string = app.outputs.webPrincipalId
output AZURE_CONTAINER_APP_ENVIRONMENT_NAME string = app.outputs.containerEnvironmentName
output AZURE_INGEST_JOB_NAME string = app.outputs.ingestJobName
output AZURE_INGEST_JOB_PRINCIPAL_ID string = app.outputs.ingestPrincipalId
output AZURE_STORAGE_ACCOUNT_NAME string = app.outputs.storageAccountName
output AZURE_STORAGE_CONTAINER_NAME string = app.outputs.sourceContainerName
output AZURE_SQL_SERVER_NAME string = app.outputs.sqlServerName
output SQL_SERVER string = app.outputs.sqlServerFqdn
output SQL_DATABASE string = app.outputs.sqlDatabaseName
output AZURE_KEY_VAULT_NAME string = app.outputs.keyVaultName
output AZURE_KEY_VAULT_URL string = app.outputs.keyVaultUrl
output AZURE_APPLICATION_INSIGHTS_NAME string = app.outputs.applicationInsightsName
output AZURE_OPENAI_ENDPOINT string = foundryEndpoint
output AZURE_OPENAI_DEPLOYMENT string = foundryDeploymentName
output AZURE_FOUNDRY_RESOURCE_GROUP string = foundryResourceGroupName
output AZURE_FOUNDRY_ACCOUNT_NAME string = foundryAccountName
output DATA_BLOB_URL string = app.outputs.dataBlobUrl
output SERVICE_WEB_URI string = app.outputs.webUri
