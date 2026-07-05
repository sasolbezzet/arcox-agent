# ARCOX Agent

ARCOX Agent is the single installer for the ARCOX transaction agent and local MCP server.

## Install

```bash
npm install -g arcox-agent
arcox-agent setup
nano ~/.arcox/agent.env
arcox-agent doctor
```

`npm install -g arcox-agent` automatically installs `arcox-mcp`. End users do not need
to install `arcox-mcp` separately unless they explicitly want only the low-level MCP package.

Restart Hermes after setup. ARCOX MCP tools are discovered automatically as `mcp_arcox_*`.
If you also want ARCOX as the Hermes model provider, either add it manually in Hermes or run `arcox-agent sync --with-provider`.

If an AI Router key is revoked, rotate and store a replacement without printing the full secret:

```bash
arcox-agent rotate-api-key --sync-provider
```

## What setup does

- Creates `~/.arcox/agent.env` with permission `600` without overwriting an existing file.
- Adds the `arcox` stdio MCP server to Hermes.
- Exposes all enabled Hermes CLI and ARCOX MCP tools directly to the model.
- Keeps model authentication separate from local transaction authorization.
- Installs the ARCOX stdio MCP server without a local AI session proxy.
- Leaves the Hermes model provider unchanged unless `--with-provider` is used.

## Optional Hermes provider

By default, `setup` and `sync` only wire the local MCP server. This is the intended
flow for a new user who wants to create an AI Router key and add a normal Hermes
custom provider manually.

To let `arcox-agent` configure the Hermes model provider from the protected env:

```bash
arcox-agent sync --with-provider
```

That adds a normal Hermes custom provider named `ARCOX User` using
`https://arc-dex-bice.vercel.app/v1` and `openai/gpt-oss-120b`. The bearer key is
read from `ARCOX_HERMES_API_KEY` or `ARCOX_AI_ROUTER_API_KEY`.

## Required env

```bash
EOA_PRIVATE_KEY=
ARCOX_AI_ROUTER_API_KEY=
# Optional when Hermes should use a different ARCOX model credential:
ARCOX_HERMES_API_KEY=
```

`EOA_PRIVATE_KEY` stays on the user's machine and exclusively authorizes local MCP transactions. `ARCOX_AI_ROUTER_API_KEY` is used by AI Router-specific MCP calls. `ARCOX_HERMES_API_KEY`, when set, is used only for model access and may be different. Solana is optional.

## Environment boundary

- `~/.arcox/agent.env`: local wallet signers and Hermes/AI Router client credentials.
- `arc-dex/.env`: public `VITE_*` browser build configuration only.
- `arc-dex-api/.env`: server provider, treasury delegate, webhook, and database configuration only.

Do not source either dApp env file from the agent. Do not copy `EOA_PRIVATE_KEY`,
`SOLANA_PRIVATE_KEY`, or `ARCOX_HERMES_API_KEY` into a dApp repository.

The former agent subtree from `arc-dex` is preserved under
`archive/arc-dex-agent-legacy/` for deployment and contract history. It is not
part of the published npm package and must not be used as a second runtime.

## Hermes

Use Hermes normally:

```bash
hermes
```

The flow is automatic:

1. Hermes calls the ARCOX production OpenAI-compatible endpoint with the bearer key.
2. ARCOX checks the key, Auto Pay, and Unified Balance.
3. Paid model requests settle testnet USDC before provider execution.

No NFT mint or session-sign command is required.

## Mobile

The wallet UI may be used on mobile for wallet approvals. Hermes and MCP still run on the user's computer or server. Never paste a private key into the ARCOX web UI.

## Commands

```bash
arcox-agent setup
arcox-agent setup --with-provider
arcox-agent doctor
arcox-agent sync
arcox-agent sync --with-provider
arcox-agent mcp
arcox-agent run "bridge 1 USDC from Arc to Base"
```

All value-moving MCP tools retain quote-before-execute and explicit confirmation requirements.
