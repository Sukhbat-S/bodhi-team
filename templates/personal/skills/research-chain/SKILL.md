---
name: research-chain
description: Research consequential or multi-source questions through explicit claims, source strategy, primary evidence, contradiction testing, and calibrated synthesis. Use when the user asks to investigate, compare evidence, verify a substantive claim, understand a complex topic, or build decision-ready research; do not use for a one-fact lookup, repository-only code tracing, specialist product documentation, data analysis, or curated-source ingestion.
---

# Research Chain

Improve the owner's ability to judge evidence, not merely Codex's ability to collect links. Research ends when the question is decision-ready or understanding-ready, not when the web has been exhausted.

## Select the mode

- **Do with me** is the default. Build the evidence chain and synthesize it transparently.
- **Teach me** applies when the owner asks to practice research judgment. Ask exactly one material question about one research variable, end the turn, and wait for the answer before advancing. Do not disguise a checklist or assignment as one question. Read [the learning modes](references/modes.md).
- **Audit me** applies when the owner provides research, sources, or a conclusion for review. Test its source quality, claim support, contradictions, freshness, and incentives before replacing it. Read [the learning modes](references/modes.md).

Use the language of the conversation. Mongolian must read aloud naturally.

## Scope the question

Before searching, state or infer:

- The question and why it matters.
- The decision, belief, or deliverable the research must support.
- The few claims or subquestions whose truth would change the answer.
- The stopping condition and required freshness.

**Clarification gate:** if the request names only a broad topic and does not establish a bounded question, decision, belief, audience, or deliverable, do not search or call tools. Ask exactly one narrowing question, end the turn, and wait. Ask only for context that would materially change the source strategy. Do not turn a bounded question into an open-ended literature review.

## Build the evidence chain

For an ordinary chat answer, use at most two focused search rounds and open or read at most six selected, independent, claim-fit sources. Search results are candidates: choose the sources that map to load-bearing claims before opening them, and do not open every result in parallel. This is a work budget, not a confidence formula. Stop earlier when the claims are covered; when the budget or a tool stalls before coverage, synthesize the supported portion and report the exact gap. Use the deep dossier only when the user requests durable or unusually consequential research.

1. Classify each load-bearing claim by evidence type and volatility.
2. Choose the narrowest credible source strategy. Read [source strategy](references/source-strategy.md) when source choice is non-obvious or the domain is high stakes.
3. Retrieve primary or authoritative evidence first. Treat first-party claims about the speaker's own product or performance as testimony with incentives, not independent proof.
4. Track which source supports which claim, its date, provenance, freshness, and relevant limitation. Never cite a page merely because it discusses the topic.
5. Look deliberately for the strongest contradictory evidence, alternative explanation, and missing population or timeframe.
6. Synthesize only after the claim map is sufficiently covered. Separate observed facts, sourced claims, inference, and unresolved unknowns.

For a complex or durable research request, read [the deep dossier method](references/deep-dossier.md). For a simple bounded question, keep the chain in the response and stop.

## Return a decision-ready answer

Lead with the answer, then provide only the evidence needed to evaluate it:

- **Answer:** the current best-supported conclusion.
- **Evidence:** the load-bearing claims and their direct support.
- **Challenge:** the strongest contradiction, alternative explanation, or incentive discount.
- **Confidence:** calibrated by claim, with freshness and evidence gaps visible.
- **Implication:** what the evidence changes; keep research separate from the final decision unless the user asked for both.
- **Next evidence:** the smallest additional observation that could materially change the conclusion.

Place citations next to the claims they support. Prefer short paraphrase over quotation. Respect source and copyright limits.

## Boundaries and handoffs

- Route current OpenAI product or Codex documentation to the installed official OpenAI documentation skill when available.
- Route repository-only implementation tracing to ordinary code investigation or the relevant engineering skill.
- Route quantitative dataset work to the relevant data-analysis skill.
- Keep curated-source ingestion and durable library writes outside this research skill.
- When the evidence is ready and the remaining work is choosing among alternatives, return a compact decision frame to the primary task.

Default to a chat answer. Create a report only when the user requests a durable artifact or the task explicitly requires one. Never auto-ingest research into BODHI memory or the library; preserve a durable insight only through its governing capture workflow and authorization boundary.

Return concrete corrections, contradictions, and evidence gaps to the primary task. Do not write
memory, modify skills, or ingest sources into a private library from this workflow.

## Governed learning receipt

Invoke `$skill-evolution` only when this run produces a concrete correction, rejection, workaround,
routing, context, reference, quality, verification, safety, or agent-boundary signal. A clean run
creates no learning receipt or write. Keep any receipt sanitized; never include source or conversation
content, and never let receipt failure block the research result.
