# Outcome acceptance

Use when a change can pass technical checks while missing the user’s intended result. Derive a small set of observable acceptance examples from the request and current context: trigger/input, expected result, and important failure behavior. Preserve existing approval and accepted requirements. Do not turn a simple task into a specification workshop.

For each material claim, identify its evidence owner: code/static checks, isolated interaction, actual app workflow, or external destination. Exercise the original requested flow and any affected return/recovery path. Record observed success separately from design approval and unresolved preferences.

A mocked save can prove UI feedback; it cannot prove server persistence. A green build can prove compilation; it cannot prove a page was shown to the user. Test counts do not substitute for the acceptance examples. If necessary evidence is unavailable, report the exact limit rather than broadening the claim.
