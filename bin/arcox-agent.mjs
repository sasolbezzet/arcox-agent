#!/usr/bin/env node
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, statSync } from 'node:fs'
import {
  AGENT_ENV,
  HERMES_CONFIG,
  commandExists,
  configureHermes,
  ensureAgentEnv,
  envSummary,
  hermesSummary,
  disableLegacyProxyService,
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

if (wantsHelp && ['setup', 'sync', 'doctor', 'mcp', 'serve', 'run'].includes(command)) {
  console.log(`ARCOX Agent\n\nCommands:\n  arcox-agent setup [--with-provider]    Configure env and Hermes MCP\n  arcox-agent doctor                     Verify installation without exposing secrets\n  arcox-agent sync [--with-provider]     Reapply Hermes MCP and optional provider\n  arcox-agent mcp                        Start the stdio MCP server\n  arcox-agent run "prompt"               Run the terminal agent\n\nEnvironment:\n  ${AGENT_ENV}`)
  process.exit(0)
}

if (command === 'setup') {
  const envPath = ensureAgentEnv(template)
  const useHermes = !args.includes('--no-hermes') && commandExists('hermes')
  const includeProvider = args.includes('--with-provider')
  const configPath = useHermes ? configureHermes({ includeProvider }) : ''
  disableLegacyProxyService()
  console.log(`ARCOX setup complete.\nEnv: ${envPath}\nHermes: ${configPath || 'not configured'}\nAI Router: https://arc-dex-bice.vercel.app/v1\nProvider configured: ${includeProvider ? 'yes' : 'no'}\n\nNext:\n  1. Edit ${envPath}\n  2. Run arcox-agent sync${includeProvider ? ' --with-provider' : ''}\n  3. Restart Hermes or run /reload-mcp`)
  process.exit(0)
}

if (command === 'doctor') {
  const env = envSummary()
  const hermes = hermesSummary()
  const checks = {
    envFile: env.exists,
    envPermission600: env.exists && (statSync(AGENT_ENV).mode & 0o777) === 0o600,
    evmSignerConfigured: env.evmSigner,
    aiApiKeyConfigured: env.apiKey,
    hermesInstalled: commandExists('hermes'),
    hermesConfigured: hermes.exists,
    hermesMcpConfigured: hermes.mcpConfigured,
    hermesProductionProvider: hermes.productionProvider,
    mcpRuntimeInstalled: existsSync(mcpServer),
  }
  const ok = checks.envFile && checks.envPermission600 && checks.mcpRuntimeInstalled && (!checks.hermesInstalled || checks.hermesMcpConfigured)
  console.log(JSON.stringify({ ok, checks, env: AGENT_ENV }, null, 2))
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

console.log(`ARCOX Agent\n\nCommands:\n  arcox-agent setup [--with-provider]    Configure env and Hermes MCP\n  arcox-agent doctor                     Verify installation without exposing secrets\n  arcox-agent sync [--with-provider]     Reapply Hermes MCP and optional provider\n  arcox-agent mcp                        Start the stdio MCP server\n  arcox-agent run "prompt"               Run the terminal agent\n\nEnvironment:\n  ${AGENT_ENV}`)

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
