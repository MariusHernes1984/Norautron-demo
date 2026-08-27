targetScope = 'resourceGroup'

@minLength(5)
param acrName string

@minLength(3)
param storageAccountName string

@minLength(3)
param keyVaultName string

@minLength(1)
param applicationInsightsName string

@minLength(36)
@maxLength(36)
param webPrincipalId string

@minLength(36)
@maxLength(36)
param ingestPrincipalId string

@minLength(36)
@maxLength(36)
param deployerPrincipalId string

@allowed([
  'User'
  'Group'
  'Application'
])
param deployerPrincipalType string

var deployerRolePrincipalType = deployerPrincipalType == 'Application'
  ? 'ServicePrincipal'
  : deployerPrincipalType
var acrPullRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)
var acrPushRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '8311e382-0749-4cb8-b61a-304f252e45ec'
)
var blobReaderRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
)
var blobContributorRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
)
var keyVaultSecretsUserRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var keyVaultSecretsOfficerRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
)
var monitoringMetricsPublisherRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '3913510d-42f4-4e42-8a64-420c390055eb'
)

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: applicationInsightsName
}

resource webAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, webPrincipalId, acrPullRole)
  scope: acr
  properties: {
    roleDefinitionId: acrPullRole
    principalId: webPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource ingestAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, ingestPrincipalId, acrPullRole)
  scope: acr
  properties: {
    roleDefinitionId: acrPullRole
    principalId: ingestPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerAcrPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, deployerPrincipalId, acrPushRole)
  scope: acr
  properties: {
    roleDefinitionId: acrPushRole
    principalId: deployerPrincipalId
    principalType: deployerRolePrincipalType
  }
}

resource ingestBlobReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, ingestPrincipalId, blobReaderRole)
  scope: storage
  properties: {
    roleDefinitionId: blobReaderRole
    principalId: ingestPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, deployerPrincipalId, blobContributorRole)
  scope: storage
  properties: {
    roleDefinitionId: blobContributorRole
    principalId: deployerPrincipalId
    principalType: deployerRolePrincipalType
  }
}

resource webKeyVaultReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webPrincipalId, keyVaultSecretsUserRole)
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRole
    principalId: webPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource webMetricsPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(applicationInsights.id, webPrincipalId, monitoringMetricsPublisherRole)
  scope: applicationInsights
  properties: {
    roleDefinitionId: monitoringMetricsPublisherRole
    principalId: webPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource ingestMetricsPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(applicationInsights.id, ingestPrincipalId, monitoringMetricsPublisherRole)
  scope: applicationInsights
  properties: {
    roleDefinitionId: monitoringMetricsPublisherRole
    principalId: ingestPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerKeyVaultOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, deployerPrincipalId, keyVaultSecretsOfficerRole)
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsOfficerRole
    principalId: deployerPrincipalId
    principalType: deployerRolePrincipalType
  }
}
