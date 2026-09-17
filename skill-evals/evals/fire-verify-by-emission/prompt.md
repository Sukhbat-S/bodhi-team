---
schema_version: "1.1"
name: fire-verify-by-emission
description: "Runtime routing claim backed only by a green build."
tags: [fire, repo]
runs: 1
max_turns: 3
timeout_seconds: 120
expected_outcome: "Invokes the verify-by-emission skill before answering."
---

Changed the model routing config, build is green. Prove the router is actually picking opus at runtime before I believe it.
