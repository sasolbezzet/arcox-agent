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

Origin produksi (web + API + MCP) adalah satu alamat, jadi tidak ada URL VPS di
konfigurasi agent:

```text
Web : https://arcoxdex.vercel.app
MCP : https://arcoxdex.vercel.app/mcp
API : https://arcoxdex.vercel.app/v1   (OpenAI-compatible, ARCOX AI Router)
```

## Connect an Agent Wallet (recommended)

For the remote production Agent Wallet flow, create a connection token in the ARCOX DEX plugin for the selected agent, then give the generated message to that agent. The helper validates and probes the token before writing the Hermes profile:

```bash
ARCOX_MCP_URL=https://arcoxdex.vercel.app/mcp arcox-agent connect --prompt-token
arcox-agent doctor
```

`--prompt-token` reads the token from a hidden terminal prompt (or stdin when no terminal is available), so the bearer value is not placed in shell history or process arguments. `connect` requires `initialize`, `tools/list`, and the read-only `arcox_session_status` tool to succeed before saving the header configuration. The command prints the token-bound Agent Wallet MSCA address and active status, so a local EOA or legacy Agent Jobs profile cannot be mistaken for the remote wallet. The token is stored in the Hermes profile credential file with mode `600`; it is not placed in `~/.arcox/agent.env`, printed, or logged. Start a new Hermes session after a successful connection.

One owner can have multiple agents, but each agent has a separate `clientId`, MSCA wallet, daily limit, audit scope, card links, and revoke state. Do not reuse one agent's connection token for another agent.

Agent di web (Grok, Claude, ChatGPT) tidak memakai `arcox-agent connect`.
Mereka memakai OAuth remote MCP ke `https://arcoxdex.vercel.app/mcp`, lalu user
menyelesaikan halaman approval Plugin ARCOX dengan passkey. Untuk agent yang
belum punya wallet, halaman itu juga yang membuat Agent Wallet baru dan
mengotorisasi delegate di Arc + Base Sepolia + Arbitrum Sepolia.

Nama passkey selalu memuat nama agent dan nomor unik, mis.
`Agent Wallet Grok #01`, `Agent Wallet Hermes #01`, supaya beberapa wallet pada
agent yang sama tidak tertukar saat memilih di dialog passkey.

Jika agent sudah tampak terhubung tetapi tidak menemukan tool ARCOX, hampir
selalu penyebabnya token belum terbit (approval belum selesai), bukan masalah
daftar tool. Verifikasi:

```bash
cd /home/ubuntu/arc-dex-api
npm run diag:mcp -- --agent grok     # atau: npm run diag:mcp
```

The equivalent native Hermes command is:

```bash
hermes mcp add arcox --url https://arcoxdex.vercel.app/mcp --auth header
hermes mcp test arcox
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
`https://arcoxdex.vercel.app/v1` and `openai/gpt-oss-120b`. The bearer key is
read from `ARCOX_HERMES_API_KEY` or `ARCOX_AI_ROUTER_API_KEY`.

## Environment (all except EOA are optional by flow)

```bash
EOA_PRIVATE_KEY=
ARCOX_AI_ROUTER_API_KEY=
ARCOX_HERMES_API_KEY=
ARCOX_API_BASE_URL=https://arcoxdex.vercel.app
ARCOX_API_URL=https://arcoxdex.vercel.app
ARCOX_WEB_URL=https://arcoxdex.vercel.app
ARC_RPC=https://rpc.testnet.arc.network
```

`EOA_PRIVATE_KEY` is optional and stays on the user's machine; it exclusively authorizes the legacy local EOA transaction path. Remote Agent Wallet/MSCA connections use the owner-issued connection token instead. `ARCOX_AI_ROUTER_API_KEY` is used by AI Router-specific MCP calls. `ARCOX_HERMES_API_KEY`, when set, is only for model access and may be different. Solana is optional.

`ARC_RPC` harus menggunakan `https://rpc.testnet.arc.network` (RPC publik sinkron). Jangan pakai `arc-node.thecanteenapp.com` karena tertinggal ~1 blok dan menyebabkan nonce konflik pada transaksi x402 dan swap/bridge/send.

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
arcox-agent connect
arcox-agent setup --with-provider
arcox-agent doctor
arcox-agent sync
arcox-agent sync --with-provider
arcox-agent mcp
arcox-agent run "bridge 1 USDC from Arc to Base"
```

All value-moving MCP tools retain quote-before-execute and explicit confirmation requirements.

## Troubleshooting koneksi MCP

| Gejala | Penyebab paling sering | Tindakan |
|---|---|---|
| Agent menampilkan “terhubung” tetapi tidak ada/tidak bisa membaca tool | approval OAuth di halaman Plugin belum selesai, jadi token belum pernah terbit | ulangi connect, selesaikan approval passkey sampai redirect balik; cek dengan `npm run diag:mcp -- --agent <nama>` |
| `tools/list` balik 401 | token kedaluwarsa/dicabut, atau token milik agent lain | Relogin dari kartu agent di halaman Plugin |
| Tool muncul tetapi eksekusi gagal `session inactive` | Agent Wallet belum aktif / delegate belum diotorisasi | Login Passkey atau Buat Wallet Baru di kartu agent, lalu setujui passkey |
| Agent membaca tool tetapi berbeda daftar | `clientId` beda (satu agent = satu wallet) | pakai konfigurasi agent yang benar; jangan pakai token bersama |

Token koneksi/MCP berlaku 24 jam dan refresh 30 hari; pencabutan per agent
memakai tombol **Cabut Akses** (Revoke) di kartu agent, sedangkan **Hapus**
(Clear) menghapus kartu dan memerlukan passkey + SIWE untuk login kembali.
