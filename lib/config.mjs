import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse, stringify } from 'yaml'

export const ARCOX_HOME = process.env.ARCOX_HOME || join(homedir(), '.arcox')
export const AGENT_ENV = process.env.ARCOX_AGENT_ENV || join(ARCOX_HOME, 'agent.env')
export const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
export const HERMES_CONFIG = join(HERMES_HOME, 'config.yaml')
export const ARCOX_AI_URL = 'https://arc-dex-bice.vercel.app/v1'

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
  const apiKey = readEnv(AGENT_ENV).ARCOX_AI_ROUTER_API_KEY || ''
  config.providers = typeof config.providers === 'object' && !Array.isArray(config.providers) ? config.providers : {}
  delete config.providers['arcox-local']
  config.providers.arcox = {
    name: 'ARCOX',
    base_url: ARCOX_AI_URL,
    default_model: 'arcox/auto',
    api_key: apiKey,
  }
  config.model = typeof config.model === 'object' && !Array.isArray(config.model) ? config.model : {}
  config.model.default = 'arcox/auto'
  config.model.provider = 'custom:arcox'
  delete config.model.api_key
  delete config.model.key_env
  delete config.model.base_url
  config.mcp_servers = typeof config.mcp_servers === 'object' && !Array.isArray(config.mcp_servers) ? config.mcp_servers : {}
  config.mcp_servers.arcox = {
    command: 'arcox-agent',
    args: ['mcp'],
    env: { ARCOX_AGENT_ENV: AGENT_ENV },
    connect_timeout: 90,
    timeout: 180,
    supports_parallel_tool_calls: false,
  }
  config.toolsets = Array.isArray(config.toolsets)
    ? config.toolsets.filter(name => name !== 'messaging')
    : []
  if (!config.toolsets.includes('hermes-cli')) config.toolsets.push('hermes-cli')
  config.agent = typeof config.agent === 'object' && !Array.isArray(config.agent) ? config.agent : {}
  config.agent.reasoning_effort = 'low'
  config.agent.environment_probe = false
  config.platform_toolsets = typeof config.platform_toolsets === 'object' && !Array.isArray(config.platform_toolsets)
    ? config.platform_toolsets
    : {}
  config.platform_toolsets.cli = Array.isArray(config.platform_toolsets.cli)
    ? config.platform_toolsets.cli.filter(name => name !== 'messaging')
    : []
  config.auxiliary = typeof config.auxiliary === 'object' && !Array.isArray(config.auxiliary) ? config.auxiliary : {}
  config.auxiliary.title_generation = {
    ...(config.auxiliary.title_generation || {}),
    provider: 'nvidia',
    model: 'nvidia/nemotron-3-nano-30b-a3b',
    timeout: 15,
  }
  if (Array.isArray(config.custom_providers)) {
    config.custom_providers = config.custom_providers.filter(item => !/arc[-_ ]?dex|arcox/i.test(String(item?.name || item?.base_url || '')))
  }
  writeFileSync(HERMES_CONFIG, stringify(config), { mode: 0o600 })
  chmodSync(HERMES_CONFIG, 0o600)
  suppressLegacyHermesCredential()
  return HERMES_CONFIG
}

export function disableLegacyProxyService() {
  if (process.platform !== 'linux' || !commandExists('systemctl')) return
  spawnSync('systemctl', ['--user', 'disable', '--now', 'arcox-ai-proxy.service'], { stdio: 'ignore' })
  spawnSync('systemctl', ['--user', 'disable', '--now', 'arcox-agent-proxy.service'], { stdio: 'ignore' })
  const servicePath = join(homedir(), '.config', 'systemd', 'user', 'arcox-agent-proxy.service')
  if (existsSync(servicePath)) unlinkSync(servicePath)
  spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' })
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

export function hermesSummary() {
  if (!existsSync(HERMES_CONFIG)) return { exists: false, productionProvider: false }
  try {
    const config = parse(readFileSync(HERMES_CONFIG, 'utf8')) || {}
    return {
      exists: true,
      productionProvider: config.model?.provider === 'custom:arcox'
        && config.model?.default === 'arcox/auto'
        && config.providers?.arcox?.base_url === ARCOX_AI_URL,
    }
  } catch {
    return { exists: true, productionProvider: false }
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
