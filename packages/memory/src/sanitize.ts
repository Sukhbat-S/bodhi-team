// Secret-scrubbing for substrate ingest paths.
//
// Wired by P4 of Wave 5 closure plan (docs/WAVE-5-PENDING-CLOSURE-MAY19.md)
// to scrub common API-key shapes from cli transcripts before they land in
// conversation_turns + before MemoryExtractor.extractSession() sees them.
//
// Order of patterns matters — specific keys (Anthropic, GitHub) first,
// generic credential k/v sweep last. The label format [REDACTED:<kind>]
// is debuggable without leaking the source.

const PATTERNS: Array<{ re: RegExp; label: string; group?: 1 }> = [
  { re: /sk-ant-[a-zA-Z0-9_-]{20,}/g, label: "anthropic-key" },
  { re: /sk-proj-[a-zA-Z0-9_-]{20,}/g, label: "openai-project-key" },
  { re: /sk-[a-zA-Z0-9]{32,}/g, label: "openai-key" },
  { re: /ghp_[a-zA-Z0-9]{36}/g, label: "github-token" },
  { re: /pat-[a-zA-Z0-9-]{20,}/g, label: "personal-access-token" },
  { re: /AKIA[0-9A-Z]{16}/g, label: "aws-key" },
  // Stripe — sk_live_, sk_test_, rk_live_, rk_test_, plus whsec_ webhooks.
  // Real Stripe secret keys are alphanumeric and ≥24 chars after the prefix.
  { re: /(?:sk|rk)_(?:live|test)_[a-zA-Z0-9]{20,}/g, label: "stripe-key" },
  { re: /whsec_[a-zA-Z0-9]{20,}/g, label: "stripe-webhook-secret" },
  // Google API key (Maps, YouTube, Firebase, etc.) — fixed 35-char suffix.
  { re: /AIza[0-9A-Za-z_-]{35}/g, label: "google-api-key" },
  // Slack tokens — xoxb (bot), xoxa (legacy app), xoxp (user), xoxr/xoxs (rare).
  { re: /xox[abprs]-[0-9a-zA-Z-]{20,}/g, label: "slack-token" },
  // SSH/PEM private key blocks — multiline. Non-greedy body, anchored
  // on matching BEGIN/END headers (RSA / OPENSSH / EC / DSA / PGP / unqualified).
  { re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/g, label: "pem-private-key" },
  // Postgres / MongoDB connection URIs that carry user:pass@host inline.
  // Replaces the user:pass@ section; keeps host so the surrounding string
  // still parses as a (now-credless) URI.
  { re: /(postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^:\/\s]+:[^@\/\s]+@/g, label: "db-uri-with-creds" },
  // JWT: min-length per segment closes the eyJxx.a.b over-match
  // surfaced by bodhi-crit review of P4. Real JWTs comfortably clear
  // these bounds.
  { re: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{10,}/g, label: "jwt" },
  // ── Prefix-specific patterns for the secret shapes BODHI actually holds in
  // .env (bodhi-security #19, Jun 4). These run BEFORE the generic kv sweep so a
  // bare token (no key=value carrier — e.g. a Telegram getMe URL, a `Bearer pa-…`
  // header) is still redacted; the generic kv rule only fires on `name=value`,
  // so these bare shapes leaked entirely before this. Synthetic-shape probes in
  // sanitize.test.ts pin each min-length boundary. ──
  // Telegram bot token: <numeric-bot-id>:AA<30+ url-safe base64>. The `AA` is a
  // stable artifact of Telegram's token format; bot ids are 6-12 digits today.
  // NO leading `\b` — the canonical carrier is the API URL `.../bot<id>:<token>`
  // where the digits are glued to `bot` (no word boundary), so `\b\d` MISSED the
  // real leak shape (proven by bodhi-security #19). The `:AA…{30,}` tail is
  // distinctive enough that dropping the anchor introduces no FP (a `12:30`
  // timestamp has no `:AA<30+>` body). \d{6,12} greedily takes the bot-id run.
  { re: /\d{6,12}:AA[A-Za-z0-9_-]{30,}/g, label: "telegram-bot-token" },
  // Voyage AI key — `pa-` prefix, url-safe body. (Used for embeddings.)
  { re: /\bpa-[A-Za-z0-9_-]{20,}/g, label: "voyage-key" },
  // Groq key — `gsk_` + 40+ alnum.
  { re: /\bgsk_[A-Za-z0-9]{40,}/g, label: "groq-key" },
  // GitHub fine-grained PAT — `github_pat_` + 60+ url-safe. Distinct prefix from
  // the classic `ghp_`/`pat-` rules above (no overlap).
  { re: /\bgithub_pat_[A-Za-z0-9_]{60,}/g, label: "github-fine-grained-pat" },
  // Notion integration tokens — modern `ntn_` and legacy `secret_`, 30+ body.
  // The `secret_` form would NOT match the generic kv rule (no `=`/`:` carrier),
  // so it leaked bare before this; the prefix rule catches the standalone token.
  { re: /\b(?:ntn_|secret_)[A-Za-z0-9]{30,}/g, label: "notion-token" },
  // Generic credential k/v: catches password="...", api_secret=..., etc.
  // No leading boundary anchor — the `key=value` shape itself is what
  // signals a secret, regardless of what comes before the key name.
  // This catches both `password=...` (start-of-string) and
  // `MYPASSWORD=...` (within-identifier) — bodhi-security MEDIUM #6.
  // FP cost: doc-prose like "the password=changeme example" redacts;
  // acceptable since real docs shouldn't carry live secrets anyway.
  {
    re: /(password|passwd|api[_-]?secret|api[_-]?key|secret|access[_-]?token|auth[_-]?token)\s*[=:]\s*"?([a-zA-Z0-9_.\-+/=]{8,})"?/gi,
    label: "credential",
    group: 1,
  },
];

export function sanitizeSecrets(input: string): string {
  if (!input) return input;
  let output = input;
  for (const { re, label, group } of PATTERNS) {
    if (group === 1) {
      output = output.replace(re, (_match, key) => `${key}=[REDACTED:${label}]`);
    } else {
      output = output.replace(re, `[REDACTED:${label}]`);
    }
  }
  return output;
}

// Recursive deep-sanitize for JSON-shaped objects (e.g. tool_use.input
// payloads). String leaves pass through sanitizeSecrets; arrays/objects
// recurse; primitives pass through unchanged. Closes the CRITICAL gap
// surfaced by bodhi-security audit of P4 — Bash tool_use.input.command
// strings carrying API keys were persisted to conversation_turns.
// tool_calls jsonb verbatim.
export function sanitizeSecretsDeep<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeSecrets(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeSecretsDeep(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeSecretsDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
