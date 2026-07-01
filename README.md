# ARCOX Agent

ARCOX Agent is the single installer for the ARCOX transaction agent, MCP server, and Hermes AI Router provider.

## Install

```bash
npm install -g arcox-agent
arcox-agent setup
nano ~/.arcox/agent.env
arcox-agent doctor
```

Restart Hermes after setup. ARCOX MCP tools are discovered automatically as `mcp_arcox_*`.

## What setup does

- Creates `~/.arcox/agent.env` with permission `600` without overwriting an existing file.
- Adds the `arcox` stdio MCP server to Hermes.
- Adds the `custom:arcox` OpenAI-compatible provider using `https://arc-dex-bice.vercel.app/v1`.
- Reads the ARCOX bearer API key from the protected env during `setup` or `sync`.
- Installs the ARCOX stdio MCP server without a local AI session proxy.

## Required env

```bash
EOA_PRIVATE_KEY=
ARCOX_AI_ROUTER_API_KEY=
```

`EOA_PRIVATE_KEY` stays on the user's machine. `ARCOX_AI_ROUTER_API_KEY` is created by ARCOX AI Router and stored only in the local protected env. Solana is optional.

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
arcox-agent doctor
arcox-agent sync
arcox-agent mcp
arcox-agent run "bridge 1 USDC from Arc to Base"
```

All value-moving MCP tools retain quote-before-execute and explicit confirmation requirements.
