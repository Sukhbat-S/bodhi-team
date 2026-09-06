# Integration readiness

Use when a capability spans packages, configuration, permissions, a provider and a running consumer. Trace the shortest chain that must work: installed artifact → configuration → running process → authorized dependency → user-visible result. Select only the links relevant to the claim.

Presence is not adoption: verify the installed artifact outside its source tree when ancestor dependencies could hide packaging defects. A configured credential is not provider entitlement; use a bounded authorized request without displaying the credential. A service health response is not evidence that its downstream consumer used the new version.

Prefer the existing provider/platform diagnostic tools. Diagnose the first failed link before changing unrelated configuration. Do not install, rotate credentials, restart unrelated processes, spend money or deploy merely to make a probe pass. Existing user authorization and current policy govern any actual mutation.

Report which links were verified, the first failed or unverified link and the minimal next action. Keep secrets and private payloads out of logs and evidence artifacts.
