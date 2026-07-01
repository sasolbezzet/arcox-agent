# ARCOX Agent

ARCOX Agent is the single installer for the local ARCOX transaction agent, MCP server, and Hermes AI Router provider.

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
- Adds the `custom:arcox-local` OpenAI-compatible provider.
- Uses a non-secret local provider token; real API and wallet keys stay only in the protected ARCOX env.
- Installs a user-level local proxy service on Linux.
- Removes the obsolete direct-Vercel ARCOX provider that cannot create signed sessions.

## Required env

```bash
EOA_PRIVATE_KEY=
ARCOX_AI_ROUTER_API_KEY=
```

`EOA_PRIVATE_KEY` stays on the user's machine. `ARCOX_AI_ROUTER_API_KEY` is created by ARCOX AI Router and is bound to its API Pass. Solana and dedicated session keys are optional.

## Hermes

Use Hermes normally:

```bash
hermes
```

The flow is automatic:

1. Hermes calls the local ARCOX proxy.
2. The proxy creates a short-lived signed session.
3. ARCOX checks API Pass, wallet/session signer, Auto Pay, and Unified Balance.
4. Paid model requests settle testnet USDC before provider execution.

No manual session-sign command is required.

## Mobile

The wallet UI may be used on mobile for wallet approvals. Hermes and its local proxy still run on the user's computer or server. Run `arcox-agent setup` on that machine and place its dedicated agent signer in that machine's protected env. Never paste a private key into the ARCOX web UI.

## Commands

```bash
arcox-agent setup
arcox-agent doctor
arcox-agent sync
arcox-agent mcp
arcox-agent serve --port 8787
arcox-agent run "bridge 1 USDC from Arc to Base"
```

All value-moving MCP tools retain quote-before-execute and explicit confirmation requirements.
