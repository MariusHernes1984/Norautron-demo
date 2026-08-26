targetScope = 'resourceGroup'

@minLength(2)
param accountName string

@minLength(36)
@maxLength(36)
param principalId string

var cognitiveServicesOpenAIUserRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
)

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: accountName
}

resource webFoundryUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, principalId, cognitiveServicesOpenAIUserRole)
  scope: foundryAccount
  properties: {
    roleDefinitionId: cognitiveServicesOpenAIUserRole
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
