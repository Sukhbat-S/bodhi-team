---
name: component-driven-ui
description: Builds product UI as shared components with their real states, then integrates the actual pages against them. Use for "make this a real component", "every page has its own version of this button", "add the loading, empty and error states", "redesign these screens on one shared foundation", "build it in the workbench first".
---

# Component-driven UI

Produce shared components that can move from review into the actual product without rebuilding a second UI. Treat an existing design and its code as evidence, not automatic approval.

## Establish the smallest useful path

Inspect the scoped repository’s framework, current components/tokens, navigation and available workbench or test tools. Reuse working native capabilities before building a custom catalog. If no workbench exists, compare adding one with extending existing tests; do not install a framework by habit or replace an accepted stack.

Identify the user’s current task and review target. Preserve their approved direction. Map the component’s purpose, callers, data/callback boundary and relevant states before extensive implementation. Infer routine details from code; ask only when the missing answer would materially change the outcome and cannot be safely assumed.

For a large redesign, establish shared foundations and navigation first, then assemble the requested pages incrementally. Do not claim a shared CSS refresh redesigned every page. For a small edit, work directly without creating a component library project.

## Design and implementation

Use the existing visual design skill when aesthetic direction is needed. Keep typography, spacing and color intentional; prefer semantic tokens and a clear information hierarchy. Do not treat a named font or a generic aesthetic description as proof of a good rendering.

For typography selection, compare identical user-language strings and UI contexts at matching sizes, weights and spacing. Inspect actual glyph coverage, loaded font subsets and fallback behavior for required characters and currency. Label a fallback honestly. Load only comparison assets until a choice is accepted; avoid silently changing every screen.

Make the reusable component consume props and callbacks. Keep authenticated requests, route changes, permissions and persistence in the consuming adapter unless the established architecture warrants another boundary. Fixtures and simulated actions belong in the workbench, not production data paths. Keep source in the exact target checkout.

Include states relevant to behavior: ordinary, selected, focus, loading, disabled, empty, error and recovery. Add navigation depth, unsaved changes, restricted access or connection states only where the component owns them. Avoid a combinatorial story catalog with no review purpose.

## Use the workbench’s real capabilities

With Storybook, read [native review and verification](references/storybook.md). With another system, use its equivalent capabilities and state the limits. A visible panel or passing render check is not an interaction test.

Use representative real labels and data shapes while keeping private data out of fixtures. Test long content and the product’s required mobile/desktop sizes. Verify keyboard interaction, focus restoration and reduced motion when applicable. Inspect the emitted page rather than relying on source or a build alone.

Keep evidence separate: design reviewed, tests passed, app integrated and live workflow verified are different states. Never manufacture visual approval. If no decision is recorded, label the proposal a draft and make comparison easy.

## Integrate and deliver

When the user’s direction covers integration, reuse the reviewed component in the actual page adapter, remove redundant implementations after checking their callers, and verify the original user flow. Preserve unrelated work. Mock-data success does not verify authentication, authorization, offline persistence or real transactions.

Open the review on the user’s chosen surface when requested; use verify-by-emission to distinguish a queued request from visible delivery. Provide the exact review link and meaningful limits. Summarize what changed, what was observed, what remains undecided and the next smallest integration step.

This workflow does not grant deployment, publication, account or payment authority. Apply the current user authorization and exact project policy at the actual external action; do not add another gate to already-authorized local work.
