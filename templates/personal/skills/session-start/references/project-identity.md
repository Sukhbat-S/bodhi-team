# Verify BODHI project context when needed

This is the read-only identity check. Use it when project verification is requested or when an upcoming action needs that proof. Do not run it merely because startup metadata is present. Ordinary conversation, Voice controls, and authorized work do not require a readiness ceremony.

Require developer-supplied native metadata for `BODHI_PROVIDER`, `BODHI_NATIVE_TASK_ID`, and `BODHI_PROJECT`. Never substitute a task title, delegation source ID, user-provided identifier, or guessed value. Internal workers do not run this check.

1. Resolve the current working directory and Git common directory. Require the trusted project path to name the same repository, allowing a managed worktree sharing that Git common directory.
2. Resolve the project key only through an exact declared route or saved-project mapping. Preserve explicit unknown namespaces; do not fuzzy-match.
3. Fetch the live policy packet when the user requests a policy/readiness check or immediately before a consequential action needs current policy. Its project and cwd fields echo the request: they are not independent identity attestation. Native metadata and filesystem evidence establish identity; the response establishes reachability and current policy. Pass `BODHI_PROVIDER` as the packet's `provider` query parameter.
4. Report only what was checked. If policy was not needed, make no live-policy claim. If identity disagrees, preserve the mismatch and resolve it before dependent writes. If BODHI is unavailable, disclose the relevant gap and continue safe independent work under the global fallback.

This check neither authorizes writes nor performs routing, sibling-task inspection, task creation, navigation, checkpoint reads/writes, artifact attachment, or broad memory retrieval. `$session-start` is optional orientation. `$session-save` or an explicitly approved workflow authorizes its named durable-outcome writes; task creation alone does not.

Use `Project context ready` only when the requested identity and live-policy checks actually passed. A discovered skill, echoed request field, passing test, or another task's checkpoint is insufficient proof.
