#!/usr/bin/env node
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, createReadStream, createWriteStream, existsSync, openSync, readFileSync, statSync } from 'node:fs'
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
  console.log(`ARCOX Agent\n\nCommands:\n  arcox-agent setup [--with-provider]    Configure env and Hermes MCP\n  arcox-agent connect [message]          Save and verify an Agent Wallet connection token\n  arcox-agent connect --prompt-token     Read the token securely from a prompt/stdin\n  arcox-agent doctor                     Verify installation without exposing secrets\n  arcox-agent sync [--with-provider]     Reapply Hermes MCP and optional provider\n  arcox-agent mcp                        Start the stdio MCP server\n  arcox-agent run "prompt"               Run the terminal agent\n\nEnvironment:\n  ${AGENT_ENV}`)
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
  const promptToken = args.includes('--prompt-token')
  const connectionArgs = args.filter(arg => !['--help', '-h', '--prompt-token'].includes(arg))
  const raw = connectionArgs.join(' ').trim() || await readConnectionMessage({ useConfiguredUrl: promptToken })
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

console.log(`ARCOX Agent\n\nCommands:\n  arcox-agent setup [--with-provider]    Configure env and Hermes MCP\n  arcox-agent connect [message]          Save and verify an Agent Wallet connection token\n  arcox-agent connect --prompt-token     Read the token securely from a prompt/stdin\n  arcox-agent doctor                     Verify installation without exposing secrets\n  arcox-agent sync [--with-provider]     Reapply Hermes MCP and optional provider\n  arcox-agent mcp                        Start the stdio MCP server\n  arcox-agent run "prompt"               Run the terminal agent\n\nEnvironment:\n  ${AGENT_ENV}`)

async function readConnectionMessage({ useConfiguredUrl = false } = {}) {
  const configuredUrl = useConfiguredUrl ? String(process.env.ARCOX_MCP_URL || '').trim() : ''

  // The dashboard-generated command supplies the public URL out-of-band and
  // asks only for the secret. Prefer the controlling terminal even when the
  // parent TUI launched this process with a non-TTY stdin.
  if (configuredUrl) {
    const token = await readSecret('Token koneksi (input tersembunyi): ', { preferTty: true })
    return `${configuredUrl} Token: ${token}`
  }

  if (!input.isTTY) {
    const piped = readFileSync(0, 'utf8').trim()
    if (!piped) throw new Error('Token koneksi tidak diterima. Jalankan di terminal interaktif atau pipe pesan koneksi ke stdin.')
    // Preserve the backwards-compatible `echo 'URL ... Token ...' | connect`
    // form when no URL was supplied through ARCOX_MCP_URL.
    return piped
  }

  const rl = createInterface({ input, output })
  let message
  try {
    message = await rl.question('MCP URL (contoh https://arcoxdex.vercel.app/mcp): ')
  } finally {
    rl.close()
  }
  const token = await readSecret('Token koneksi (input tersembunyi): ')
  return `${message} Token: ${token}`
}

async function readSecret(prompt, { preferTty = false } = {}) {
  if (preferTty && process.env.ARCOX_DISABLE_TTY_PROMPT !== '1') {
    const tty = openControllingTerminal()
    if (tty) {
      try {
        return await readSecretFromStreams(prompt, tty.input, tty.output, tty.fd)
      } finally {
        tty.input.destroy()
        tty.output.destroy()
        try { closeSync(tty.fd) } catch { /* already closed */ }
      }
    }
  }

  if (!input.isTTY) return readFileSync(0, 'utf8').trim()
  if (process.platform === 'win32') return readSecretFromWindows(prompt)
  return readSecretFromStreams(prompt, input, output, null)
}

function openControllingTerminal() {
  if (process.platform === 'win32' || !existsSync('/dev/tty')) return null
  let fd = -1
  try {
    fd = openSync('/dev/tty', 'r+')
    return {
      fd,
      input: createReadStream('/dev/tty'),
      output: createWriteStream('/dev/tty'),
    }
  } catch {
    if (fd >= 0) {
      try { closeSync(fd) } catch { /* ignore cleanup failure */ }
    }
    return null
  }
}

async function readSecretFromWindows(prompt) {
  output.write(prompt)
  input.setRawMode?.(true)
  return new Promise(resolve => {
    let value = ''
    const onData = chunk => {
      const text = String(chunk)
      if (text === '\\r' || text === '\\n') {
        input.off('data', onData)
        input.setRawMode?.(false)
        output.write('\\n')
        resolve(value.trim())
      } else if (text === '\\u0003') {
        input.off('data', onData)
        input.setRawMode?.(false)
        output.write('\\n')
        resolve('')
      } else if (text === '\\u007f') {
        value = value.slice(0, -1)
      } else {
        value += text
      }
    }
    input.on('data', onData)
  })
}

async function readSecretFromStreams(prompt, secretInput, secretOutput, fd) {
  const stateOptions = { stdio: fd === null ? ['inherit', 'pipe', 'ignore'] : [fd, 'pipe', 'ignore'] }
  const terminalState = spawnSync('stty', ['-g'], stateOptions).stdout?.toString().trim() || ''
  if (terminalState) {
    spawnSync('stty', ['-echo'], { stdio: fd === null ? ['inherit', 'ignore', 'ignore'] : [fd, 'ignore', 'ignore'] })
  }
  secretOutput.write(prompt)
  const rl = createInterface({ input: secretInput, output: secretOutput })
  try {
    const value = await rl.question('')
    return String(value).trim()
  } finally {
    rl.close()
    if (terminalState) {
      spawnSync('stty', [terminalState], { stdio: fd === null ? ['inherit', 'ignore', 'ignore'] : [fd, 'ignore', 'ignore'] })
    }
    secretOutput.write('\\n')
  }
}

async function run(script, childArgs) {
  ensureAgentEnv(template)
  chmodSync(AGENT_ENV, 0o600)
  const child = spawn(process.execPath, [script, ...childArgs], {
    stdio: 'inherit',
    // Hermes does not consistently expand ${...} in MCP headers. Inject the
    // protected connection token only into the child MCP process; never write
    // it into config.yaml or print it.
    env: {
      ...process.env,
      ARCOX_AGENT_ENV: AGENT_ENV,
      MCP_ARCOX_API_KEY: hermesConnectionToken() || process.env.MCP_ARCOX_API_KEY || '',
    },
  })
  const status = await new Promise((resolve) => {
    child.once('error', () => resolve(1))
    child.once('exit', (code) => resolve(code ?? 1))
  })
  process.exit(status)
}
