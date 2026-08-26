import {
  DefaultAzureCredential,
  ManagedIdentityCredential,
  type TokenCredential
} from "@azure/identity";

let credential: TokenCredential | undefined;

export function getAzureCredential(): TokenCredential {
  if (credential) return credential;

  credential =
    process.env.NODE_ENV === "development"
      ? new DefaultAzureCredential()
      : process.env.AZURE_CLIENT_ID
        ? new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID)
        : new ManagedIdentityCredential();

  return credential;
}
