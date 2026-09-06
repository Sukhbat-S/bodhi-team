# Security and private data

This preview is designed for one owner on one local machine. Bind to loopback; network exposure and multi-user access require a separate security review. Each owner maintains their own credentials, database, backups and connector approvals.

Do not open issues containing secrets, memory exports, private messages or raw database dumps. Report potential vulnerabilities privately to the repository maintainers. Share only a minimal sanitized reproduction. If a credential is exposed, revoke it at the provider; deleting a file or commit is insufficient.

The distribution boundary and pattern scan reduce accidental disclosure, but do not prove absence of every secret or vulnerability. Never add personal operational records to this repository. Release packages must be reviewed, checksum-pinned and verified before installation or upgrade.
