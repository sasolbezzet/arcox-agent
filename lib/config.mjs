import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse, stringify } from 'yaml'

export const ARCOX_HOME = process.env.ARCOX_HOME || join(homedir(), '.arcox')
export const AGENT_ENV = process.env.ARCOX_AGENT_ENV || join(ARCOX_HOME, 'agent.env')
export const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
export const HERMES_CONFIG = join(HERMES_HOME, 'config.yaml')
export const LOCAL_PROXY_URL = 'http://127.0.0.1:8787/v1'

export function ensureAgentEnv(templatePath) {
  mkdirSync(ARCOX_HOME, { recursive: true, mode: 0o700 })
  chmodSync(ARCOX_HOME, 0o700)
  if (!existsSync(AGENT_ENV)) writeFileSync(AGENT_ENV, readFileSync(templatePath, 'utf8'), { mode: 0o600 })
  chmodSync(AGENT_ENV, 0o600)
  return AGENT_ENV
}

export function configureHermes() {
  mkdirSync(HERMES_HOME, { recursive: true, mode: 0o700 })
  const config = existsSync(HERMES_CONFIG) ? parse(readFileSync(HERMES_CONFIG, 'utf8')) || {} : {}
  config.providers = typeof config.providers === 'object' && !Array.isArray(config.providers) ? config.providers : {}
  config.providers['arcox-local'] = {
    name: 'ARCOX Local',
    base_url: LOCAL_PROXY_URL,
    default_model: 'arcox/auto',
    api_key: 'arcox-local',
  }
  config.model = typeof config.model === 'object' && !Array.isArray(config.model) ? config.model : {}
  config.model.default = 'arcox/auto'
  config.model.provider = 'custom:arcox-local'
  delete config.model.api_key
  delete config.model.key_env
  delete config.model.base_url
  config.mcp_servers = typeof config.mcp_servers === 'object' && !Array.isArray(config.mcp_servers) ? config.mcp_servers : {}
  config.mcp_servers.arcox = {
    command: 'arcox-agent',
    args: ['mcp'],
    env: { ARCOX_AGENT_ENV: AGENT_ENV },
    supports_parallel_tool_calls: false,
  }
  if (Array.isArray(config.custom_providers)) {
    config.custom_providers = config.custom_providers.filter(item => !/arc[-_ ]?dex|arcox/i.test(String(item?.name || item?.base_url || '')))
  }
  writeFileSync(HERMES_CONFIG, stringify(config), { mode: 0o600 })
  chmodSync(HERMES_CONFIG, 0o600)
  suppressLegacyHermesCredential()
  return HERMES_CONFIG
}

export function installLinuxProxyService(entryScript) {
  if (process.platform !== 'linux' || !commandExists('systemctl')) return { installed: false, reason: 'unsupported_platform' }
  const serviceDir = join(homedir(), '.config', 'systemd', 'user')
  const servicePath = join(serviceDir, 'arcox-agent-proxy.service')
  mkdirSync(serviceDir, { recursive: true })
  const service = `[Unit]\nDescription=ARCOX local signed AI Router proxy\nAfter=network-online.target\n\n[Service]\nType=simple\nEnvironment=ARCOX_AGENT_ENV=${AGENT_ENV}\nExecStart=${process.execPath} ${resolve(entryScript)} serve --port 8787\nRestart=on-failure\nRestartSec=3\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`
  writeFileSync(servicePath, service, { mode: 0o600 })
  spawnSync('systemctl', ['--user', 'disable', '--now', 'arcox-ai-proxy.service'], { stdio: 'ignore' })
  const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' })
  const enable = spawnSync('systemctl', ['--user', 'enable', '--now', 'arcox-agent-proxy.service'], { stdio: 'pipe' })
  return { installed: reload.status === 0 && enable.status === 0, servicePath }
}

export function envSummary() {
  if (!existsSync(AGENT_ENV)) return { exists: false }
  const values = readEnv(AGENT_ENV)
  return {
    exists: true,
    evmSigner: /^0x[0-9a-fA-F]{64}$/.test(values.EOA_PRIVATE_KEY || ''),
    apiKey: /^arx_sk_/.test(values.ARCOX_AI_ROUTER_API_KEY || ''),
    solanaSigner: Boolean(values.SOLANA_PRIVATE_KEY),
  }
}

export function commandExists(command) {
  return spawnSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' }).status === 0
}

function readEnv(path) {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).flatMap(line => {
    const value = line.trim()
    if (!value || value.startsWith('#') || !value.includes('=')) return []
    const index = value.indexOf('=')
    return [[value.slice(0, index), value.slice(index + 1).replace(/^['"]|['"]$/g, '')]]
  }))
}

function suppressLegacyHermesCredential() {
  if (process.env.ARCOX_SKIP_HERMES_AUTH_CLEANUP === '1') return
  if (!commandExists('hermes')) return
  spawnSync('hermes', ['auth', 'remove', 'custom:arc-dex-bice.vercel.app', '1'], { stdio: 'ignore' })
}
