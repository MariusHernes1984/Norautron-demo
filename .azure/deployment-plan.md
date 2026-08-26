# Azure Deployment Plan

> **Status:** Validated

Generated: 2026-08-26

## 1. Project Overview

**Goal:** Build a Norwegian, chat-first analytics application over
`Norautron_syntetiske_data.xlsx`, with KPI report generation, report storage,
and PDF export. Run the full-stack application and ingestion worker in Azure
Container Apps and use the existing Microsoft Foundry GPT-5.6-Terra deployment.

**Path:** New Project

## 2. Requirements

| Attribute | Value |
|---|---|
| Classification | Development / internal pilot |
| Scale | Up to 25 concurrent users |
| Budget | Balanced |
| Subscription | NO-KATEDEV-KATE-PROD (`59aae656-c78b-4bc5-bcfd-e31748e6f6e2`) |
| Location | Sweden Central |
| Authentication | Anonymous pilot |
| Exposure | Public HTTPS endpoint |
| AI limit | 60 calls per HMAC-hashed IP/hour; max 8 concurrent calls |
| Data | Synthetic demo data; no additional compliance requirements |

## 3. Components Detected

| Component | Type | Technology | Path |
|---|---|---|---|
| Synthetic workbook | Source data | Excel/OpenXML | `Norautron_syntetiske_data.xlsx` |
| Web and API | Frontend/API | Next.js, React, TypeScript | `src/` |
| Ingestion worker | Job | Python | `ingest/` |
| Database bootstrap | Data | T-SQL | `db/` |

## 4. Recipe Selection

**Selected:** Azure Developer CLI with Bicep.

**Rationale:** This is a new, Azure-first, multi-service application. AZD
provides repeatable environment configuration and deployment while Bicep
captures Container Apps, storage, SQL, identity, monitoring, and RBAC.

## 5. Architecture

**Stack:** Containers

| Component | Azure Service | SKU / Configuration |
|---|---|---|
| Web/API | Azure Container App | Consumption, 1 vCPU/2 GiB, min 1, max 3 |
| Workbook ingestion | Azure Container Apps Job | Manual/deployment-triggered, 1 vCPU/2 GiB |
| Container environment | Container Apps Environment | Consumption |
| Images | Azure Container Registry | Basic |
| Workbook | Azure Blob Storage | Standard LRS, shared key disabled |
| Analytics and reports | Azure SQL Database | General Purpose serverless, max 2 vCore |
| Model | Existing Microsoft Foundry deployment | `kateecosystem-resource/gpt-5.6-terra` |
| Secrets | Azure Key Vault | RBAC authorization |
| Telemetry | Application Insights | Workspace-based |
| Logs | Log Analytics | 30-day retention |

The workbook is the source of truth in Blob Storage. A separately identified
Container Apps Job validates and loads five versioned analytics tables. The
web identity reads analytics views, writes application report/usage data, and
invokes Foundry through managed identity. The ingestion identity alone can
write source tables.

### Existing Foundry resource

- Account: `kateecosystem-resource`
- Project: `kateecosystem`
- Deployment: `gpt-5.6-terra`
- Version: `2026-07-09`
- SKU/capacity: GlobalStandard 100
- Limits: 100 RPM / 100,000 TPM

### Supporting services and security

- Separate system-assigned managed identities for web and ingest.
- Microsoft Entra-only Azure SQL authentication; no SQL passwords.
- Managed identity for Blob, Key Vault, ACR, SQL, and Foundry.
- Microsoft Entra-authenticated Application Insights ingestion with local
  authentication disabled and Monitoring Metrics Publisher RBAC.
- ACR pull assignments are deployed in a second-phase RBAC module after the
  Container Apps identities exist; AZD links the web image and the postdeploy
  hook links the manual job image.
- SELECT-only SQL guard, object/column allowlists, 500-row limit, query timeout.
- HMAC-hashed IP rate limiting stored in SQL; no raw IP persistence.
- No report sharing or deletion endpoints in the anonymous pilot.
- CSP, secure response headers, same-origin APIs, bounded request/history sizes.

### Azure Policy constraints

- Sweden Central is allowed by resource and resource-group location policies.
- Storage shared-key access is disabled. Private Link is deferred for this
  anonymous synthetic-data pilot and remains a documented production hardening
  item.
- Tags: `owner=KATE`, `costcenter=KATE-DEV`, `environment=dev`,
  `project=norautron-analytics`.

## 6. Provisioning Limit Checklist

Quota was checked with Azure CLI quota commands, Azure Resource Graph, existing
Foundry deployment metadata, and official Azure service limits.

| Resource Type | Number to Deploy | Total After Deployment | Limit/Quota | Notes |
|---|---:|---:|---:|---|
| Microsoft.Resources/resourceGroups | 1 | 50 | 980/subscription | ARG + official limits |
| Microsoft.App/managedEnvironments | 1 | 6 | 50/region | `az quota`: ManagedEnvironmentCount |
| Microsoft.App/containerApps | 1 | 9 | Environment core quota | Max 3 active web cores planned |
| Microsoft.App/jobs | 1 | 3 | Environment core quota | Max 1 job core planned |
| Microsoft.App consumption cores | max 4 | max 4 in new environment | 1,000 regional sandbox cores available | `az quota`: SandboxCores |
| Microsoft.Storage/storageAccounts | 1 | 10 | 250/region | `az quota`: StorageAccounts |
| Microsoft.ContainerRegistry/registries | 1 | 6 | No count quota exposed | Basic storage limit 40 TiB; planned image under 1 GiB |
| Microsoft.Sql/servers | 1 | 1 | 250/region | ARG + official Azure SQL limits |
| Microsoft.Sql/servers/databases | 1 | 1 | 5,000/logical server | Official Azure SQL limits |
| Azure SQL serverless vCore | max 2 | max 2 | Lowest documented default is 10 | Provider quota API returned no rows |
| Microsoft.Insights/components | 1 | 12 | No published count quota | ARG + official docs |
| Microsoft.OperationalInsights/workspaces | 1 | 12 | No modern-tier count limit | ARG + official docs |
| Microsoft.KeyVault/vaults | 1 | 7 | No published vault count quota | ARG + official docs |
| GPT-5.6-Terra deployment | 0 | 1 | Existing 100 RPM / 100,000 TPM | Reused, no new model capacity |

**Status:** All planned resources are within limits.

## 7. Execution Checklist

### Phase 1: Planning

- [x] Analyze workspace
- [x] Gather requirements
- [x] Confirm subscription and location
- [x] Check subscription policies
- [x] Prepare resource inventory
- [x] Fetch quotas and validate capacity
- [x] Scan Aurora reuse candidates
- [x] Select AZD/Bicep recipe
- [x] Plan architecture
- [x] User approved this plan

### Phase 2: Execution

- [x] Scaffold the Next.js application and Atea-style shell
- [x] Adapt Aurora model, SSE, SQL guard, chart, report, QA, and PDF patterns
- [x] Build the Excel-to-SQL ingestion job
- [x] Create SQL schema, analytics views, and app persistence tables
- [x] Add anonymous-pilot rate limits and security controls
- [x] Generate AZD/Bicep, Dockerfiles, identities, RBAC, and monitoring
- [x] Add tests, evaluations, health checks, and documentation
- [x] Set this plan to `Ready for Validation`

### Phase 3: Validation

- [x] Invoke `azure-validate`
- [x] Record validation evidence below
- [x] Set status to `Validated`

### Phase 4: Deployment

- [ ] Invoke `azure-deploy` only after validation and explicit deployment intent
- [ ] Verify deployed endpoints and ingestion
- [ ] Set status to `Deployed`

## 8. Validation Proof

| Check | Command Run | Result | Timestamp |
|---|---|---|---|
| Application checks | `npm run typecheck`; `npm run lint`; `npm test`; `npm run build` | Passed: 22 test files, 102 tests, production build and all application routes | 2026-08-26 |
| Ingestion checks | `python -m unittest ingest.test_main -v`; `python -m py_compile ingest\main.py scripts\bootstrap_db.py` | Passed: 21 tests, actual five-sheet/70,000-row workbook contract, Python compilation | 2026-08-26 |
| Bicep compilation/lint | `az bicep build --file infra\main.bicep --stdout`; `az bicep lint --file infra\main.bicep` | Passed without Bicep diagnostics | 2026-08-26 |
| ARM template validation | `az deployment sub validate` with resolved Entra principal and non-secret parameters | `Succeeded` | 2026-08-26 |
| ARM what-if | `az deployment sub what-if --result-format ResourceIdOnly` | `Succeeded`; only planned creates, with expected unresolved system-identity role IDs | 2026-08-26 |
| AZD schema | Official `validate_azure_yaml` command | Passed against the stable schema | 2026-08-26 |
| AZD resource preview | `azd provision --preview --environment infra-validation --subscription 59aae656-c78b-4bc5-bcfd-e31748e6f6e2 --location swedencentral --no-prompt` | Passed; preview only, no Azure changes applied | 2026-08-26 |
| AZD context | `azd version`; `azd auth login --check-status`; `azd env get-values` | Authenticated; expected subscription and Sweden Central selected | 2026-08-26 |
| Docker build inputs | Lockfile, Dockerfile and `.dockerignore` contract tests/review | Passed; remote ACR build is configured | 2026-08-26 |
| UI smoke test | Playwright desktop and 390px mobile accessibility snapshots for Chat, Reports and Dataset | Passed; intentional local database-unavailable state rendered correctly | 2026-08-26 |
| Static RBAC review | Review of all `Microsoft.Authorization/roleAssignments` resources against code operations | Passed; resource-scoped data-plane roles for web, ingest and deployer identities | 2026-08-26 |
| Foundry reuse | Read-only Foundry deployment query | Confirmed Sweden Central GPT-5.6-Terra `2026-07-09`, GlobalStandard 100 | 2026-08-26 |
| Azure Policy | Policy assignment review, location parameters, ARM validation and what-if | Sweden Central allowed; storage recommendations use audit defaults; required tags/configuration present | 2026-08-26 |
| SQL credential prohibition | Repository search in `infra/*.bicep` for the two prohibited SQL administrator properties | No matches | 2026-08-26 |

**Validated by:** azure-validate skill

**Validation timestamp:** 2026-08-26

`azd package` was not run because `remoteBuild: true` makes that command start
an ACR build, which would mutate Azure state. The lockfile, Next.js production
build, Docker contexts, and AZD preview were validated without that mutation.

## 9. Role Assignment Verification

- **Status:** Verified.
- **Web identity:** ACR Pull on its registry, Key Vault Secrets User on its
  vault, Monitoring Metrics Publisher on its Application Insights component,
  Cognitive Services OpenAI User on the existing Foundry account, and
  least-privilege SQL grants created by the postprovision hook.
- **Ingestion identity:** ACR Pull on its registry, Storage Blob Data Reader on
  its storage account, Monitoring Metrics Publisher on Application Insights,
  and source-table SQL grants created by the postprovision hook.
- **Deployment identity:** ACR Push, Storage Blob Data Contributor, and Key
  Vault Secrets Officer, each scoped to the individual target resource. It is
  also configured as the Entra-only SQL administrator for bootstrap.
- **Phase ordering:** Resource RBAC is isolated in a second module so
  system-assigned principal IDs are available before deterministic role
  assignments are evaluated. Foundry RBAC is deployed at `RG-KATE` scope.
- **Issues fixed:** Removed unused web Blob access, eliminated cross-scope
  role-assignment errors, and added Entra-authenticated telemetry RBAC.

## 10. Deployment Files

| File | Purpose | Status |
|---|---|---|
| `.azure/deployment-plan.md` | Deployment source of truth | Complete |
| `azure.yaml` | AZD service and hook configuration | Complete |
| `infra/*.bicep` | Azure resources, phase-two RBAC, and outputs | Complete |
| `infra/main.parameters.json` | AZD parameter mapping and Sweden Central/Foundry defaults | Complete |
| `scripts/postprovision.ps1` | Blob, Key Vault, and Entra-only SQL bootstrap | Complete |
| `scripts/postdeploy.ps1` | Ingestion image build, job update, and manual start | Complete |
| `Dockerfile` | Next.js image | Complete |
| `ingest/Dockerfile` | Excel ingestion job image | Complete |
| `.dockerignore` / `package-lock.json` | Reproducible remote-build context | Complete |
| `src/**` | Web, chat, reports, API, data access | Complete |
| `ingest/**` | Workbook validation and bulk load | Complete |
| `db/**` | SQL schema, views, roles, bootstrap | Complete |
| `eval/**` | Golden questions and report cases | Complete |

## 11. Next Steps

1. Invoke `azure-deploy` to provision and deploy the validated solution.
2. Verify the live Container App, data ingestion, managed identities and model
   response before changing status to `Deployed`.
