# Legacy ARCOX DEX Agent Snapshot

`arc-dex-agent-legacy/` is the tracked agent snapshot migrated out of the
`arc-dex` frontend repository. It is retained for contract artifacts, deployment
records, and implementation history only.

Do not run its installer or create an `.env` inside this archive. The supported
agent entrypoint is the root `arcox-agent` package, runtime transactions are
provided by the `arcox-mcp` dependency, and local configuration belongs only in
`~/.arcox/agent.env`.
