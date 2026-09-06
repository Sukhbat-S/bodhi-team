# Native Storybook review

Inspect the installed version and consult its current official documentation before configuration or API changes. Prefer existing configuration; isolate app-only proxies, service workers and live business effects from a synthetic workbench when needed.

- Controls expose meaningful editable arguments; enum-like states need usable choices.
- Actions log callbacks with supported spies. Logging alone proves no outcome.
- Interaction/play tests perform actions and assert the resulting state; make steps understandable to the reviewer.
- The supported browser test integration can run stories in batches. Verify the actual runner and browser prerequisite, not just addon installation.
- Accessibility checks cover supported automated rules. Keep manual keyboard/focus/reflow and design judgment distinct.
- Static rendering, simulated workflow success, actual application integration and production behavior require different evidence.

Use component stories for reusable parts, pattern stories for composed interactions, and page stories when implementation exists. Keep current source and honest readiness; avoid duplicate galleries and empty placeholder pages. Preserve behavior references during cleanup until their useful checks are represented elsewhere.

Sources to retrieve as needed: https://storybook.js.org/docs/writing-stories ; https://storybook.js.org/docs/writing-tests/interaction-testing ; https://storybook.js.org/docs/writing-tests/integrations/vitest-addon . Do not treat these links as evidence until their applicable content has been read.
