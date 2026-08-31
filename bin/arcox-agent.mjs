#!/usr/bin/env node
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
  AGENT_ENV,
  HERMES_CONFIG,
  commandExists,
  configureHermes,
  ensureAgentEnv,
  envSummary,
  hermesSummary,
  disableLegacyProxyService,
  connectionState,
  configureHermesConnectionToken,
  parseConnectionInput,
  probeMcpConnection,
  hermesConnectionToken,
} from '../lib/config.mjs'

process.umask(0o077)
const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('arcox-mcp/package.json'))
const runtimeCli = join(packageRoot, 'packages', 'runtime', 'bin', 'arcox-codex-cli.mjs')
const mcpServer = join(packageRoot, 'packages', 'mcp-server', 'server.mjs')
const here = dirname(fileURLToPath(import.meta.url))
const template = join(here, '..', 'templates', 'agent.env.example')
const command = process.argv[2] || 'help'
const args = process.argv.slice(3)
const wantsHelp = args.includes('--help') || args.includes('-h')

if (wantsHelp && ['setup', 'connect', 'sync', 'doctor', 'mcp', 'serve', 'run'].includes(command)) {
  console.log(`ARCOX Agent\n\nCommands:\n  arcox-agent setup [--with-provider]    Configure env and Hermes MCP\n  arcox-agent connect [message]          Save and verify an Agent Wallet connection token\n  arcox-agent doctor                     Verify installation without exposing secrets\n  arcox-agent sync [--with-provider]     Reapply Hermes MCP and optional provider\n  arcox-agent mcp                        Start the stdio MCP server\n  arcox-agent run "prompt"               Run the terminal agent\n\nEnvironment:\n  ${AGENT_ENV}`)
  process.exit(0)
}

if (command === 'setup') {
  const envPath = ensureAgentEnv(template)
  const useHermes = !args.includes('--no-hermes') && commandExists('hermes')
  const includeProvider = args.includes('--with-provider')
  const configPath = useHermes ? configureHermes({ includeProvider }) : ''
  disableLegacyProxyService()
  console.log(`ARCOX setup complete.\nEnv: ${envPath}\nHermes: ${configPath || 'not configured'}\nAI Router: https://arcoxdex.vercel.app/v1\nProvider configured: ${includeProvider ? 'yes' : 'no'}\n\nNext:\n  1. Edit ${envPath}\n  2. Run arcox-agent sync${includeProvider ? ' --with-provider' : ''}\n  3. Restart Hermes or run /reload-mcp`)
  process.exit(0)
}

if (command === 'connect') {
  const raw = args.filter(arg => !['--help', '-h'].includes(arg)).join(' ').trim() || await readConnectionMessage()
  let parsed
  try {
    parsed = parseConnectionInput(raw)
    // Probe before persisting anything. A malformed or unreachable token must
    // never leave a half-configured Hermes server behind.
    const probe = await probeMcpConnection(parsed.url, parsed.token)
    configureHermesConnectionToken(parsed)
    console.log(`ARCOX connection verified: ${probe.tools} tools available.`)
    console.log(`Agent Wallet MSCA: ${probe.walletAddress}`)
    console.log(`MSCA status: ${probe.active ? 'active' : 'inactive'} (${probe.walletType || 'MSCA'})`)
    console.log('Terhubung. Mulai sesi Hermes baru untuk mengaktifkan tools.')
  } catch (error) {
    console.error(`Connection failed: ${error?.message || error}`)
    process.exit(1)
  }
  process.exit(0)
}

if (command === 'doctor') {
  const env = envSummary()
  const hermes = hermesSummary()
  const state = connectionState()
  const checks = {
    envFile: env.exists,
    envPermission600: env.exists && (statSync(AGENT_ENV).mode & 0o777) === 0o600,
    evmSignerConfigured: env.evmSigner,
    aiApiKeyConfigured: env.apiKey,
    hermesInstalled: commandExists('hermes'),
    hermesConfigured: hermes.exists,
    hermesMcpConfigured: hermes.mcpConfigured,
    connectionConfigured: hermes.connectionConfigured,
    mcpRuntimeInstalled: existsSync(mcpServer),
    walletModes: { eoa: env.evmSigner, msca: hermes.connectionConfigured, sca: false },
  }
  let connection = { configured: false, probe: null, expiresAt: state?.expiresAt || null, remainingSeconds: null }
  if (checks.connectionConfigured) {
    const token = hermesConnectionToken()
    try {
      const result = await probeMcpConnection(hermes.connectionUrl, token)
      const remainingSeconds = state?.expiresAt ? Math.max(0, Math.floor((Date.parse(state.expiresAt) - Date.now()) / 1000)) : null
      connection = {
        configured: true,
        probe: {
          ok: true,
          status: 200,
          tools: result.tools,
          walletAddress: result.walletAddress || null,
          walletType: result.walletType || null,
          active: result.active === true,
        },
        expiresAt: state?.expiresAt || null,
        remainingSeconds,
      }
    } catch (error) {
      connection = { configured: true, probe: { ok: false, error: error?.message || String(error) }, expiresAt: state?.expiresAt || null, remainingSeconds: null }
    }
  }
  const ok = checks.envFile && checks.envPermission600 && checks.mcpRuntimeInstalled && (!checks.hermesInstalled || checks.hermesMcpConfigured) && (!connection.configured || connection.probe?.ok === true)
  console.log(JSON.stringify({ ok, checks, connection, env: AGENT_ENV }, null, 2))
  process.exit(ok ? 0 : 1)
}

if (command === 'mcp') await run(mcpServer, args)
if (command === 'serve') await run(runtimeCli, ['serve', ...args])
if (command === 'sync') {
  ensureAgentEnv(template)
  const includeProvider = args.includes('--with-provider')
  if (commandExists('hermes')) configureHermes({ includeProvider })
  disableLegacyProxyService()
  console.log(`ARCOX configuration synchronized.${includeProvider ? ' Hermes provider updated from protected env.' : ' MCP wiring updated without changing the Hermes model provider.'}`)
  process.exit(0)
}
if (command === 'run') await run(runtimeCli, args)
if (!['help', '--help', '-h'].includes(command)) await run(runtimeCli, [command, ...args])

console.log(`ARCOX Agent\n\nCommands:\n  arcox-agent setup [--with-provider]    Configure env and Hermes MCP\n  arcox-agent connect [message]          Save and verify an Agent Wallet connection token\n  arcox-agent doctor                     Verify installation without exposing secrets\n  arcox-agent sync [--with-provider]     Reapply Hermes MCP and optional provider\n  arcox-agent mcp                        Start the stdio MCP server\n  arcox-agent run "prompt"               Run the terminal agent\n\nEnvironment:\n  ${AGENT_ENV}`)

async function readConnectionMessage() {
  if (!input.isTTY) return readFileSync(0, 'utf8')
  const rl = createInterface({ input, output })
  try {
    return await rl.question('Paste pesan koneksi Agent Wallet (token tidak akan ditampilkan):\\n')
  } finally {
    rl.close()
  }
}

async function run(script, childArgs) {
  ensureAgentEnv(template)
  chmodSync(AGENT_ENV, 0o600)
  const child = spawn(process.execPath, [script, ...childArgs], {
    stdio: 'inherit',
    env: { ...process.env, ARCOX_AGENT_ENV: AGENT_ENV },
  })
  const status = await new Promise((resolve) => {
    child.once('error', () => resolve(1))
    child.once('exit', (code) => resolve(code ?? 1))
  })
  process.exit(status)
}
