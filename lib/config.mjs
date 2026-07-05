import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'

export const ARCOX_HOME = process.env.ARCOX_HOME || join(homedir(), '.arcox')
export const AGENT_ENV = process.env.ARCOX_AGENT_ENV || join(ARCOX_HOME, 'agent.env')
export const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
export const HERMES_CONFIG = join(HERMES_HOME, 'config.yaml')
export const ARCOX_AI_URL = 'https://arc-dex-bice.vercel.app/v1'
export const ARCOX_AI_MODEL = 'openai/gpt-oss-120b'
const ARCOX_AGENT_BIN = fileURLToPath(new URL('../bin/arcox-agent.mjs', import.meta.url))
const NODE_COMMAND = process.execPath
const HERMES_CLI_TOOLSETS = [
  'browser',
  'clarify',
  'code_execution',
  'computer_use',
  'context_engine',
  'cronjob',
  'delegation',
  'file',
  'image_gen',
  'memory',
  'session_search',
  'skills',
  'terminal',
  'todo',
  'tts',
  'vision',
  'web',
]

export function ensureAgentEnv(templatePath) {
  mkdirSync(ARCOX_HOME, { recursive: true, mode: 0o700 })
  chmodSync(ARCOX_HOME, 0o700)
  if (!existsSync(AGENT_ENV)) writeFileSync(AGENT_ENV, readFileSync(templatePath, 'utf8'), { mode: 0o600 })
  chmodSync(AGENT_ENV, 0o600)
  return AGENT_ENV
}

export function updateAgentApiKey(apiKey, options = {}) {
  const value = String(apiKey || '').trim()
  if (!/^arx_sk_[A-Za-z0-9_-]{16,}$/.test(value)) throw new Error('ARCOX returned an invalid API key.')
  if (!existsSync(AGENT_ENV)) throw new Error(`Agent env does not exist: ${AGENT_ENV}`)
  const names = ['ARCOX_AI_ROUTER_API_KEY', ...(options.syncHermesKey ? ['ARCOX_HERMES_API_KEY'] : [])]
  let contents = readFileSync(AGENT_ENV, 'utf8')
  for (const name of names) {
    const line = `${name}=${value}`
    const pattern = new RegExp(`^${name}=.*$`, 'm')
    contents = pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents.replace(/\s*$/, '')}\n${line}\n`
  }
  const temporary = `${AGENT_ENV}.tmp-${process.pid}`
  writeFileSync(temporary, contents, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, AGENT_ENV)
  chmodSync(AGENT_ENV, 0o600)
  return {
    env: AGENT_ENV,
    keyPreview: `${value.slice(0, 10)}...${value.slice(-4)}`,
    hermesKeyUpdated: Boolean(options.syncHermesKey),
  }
}

export function configureHermes(options = {}) {
  const { includeProvider = false } = options
  mkdirSync(HERMES_HOME, { recursive: true, mode: 0o700 })
  const config = existsSync(HERMES_CONFIG) ? parse(readFileSync(HERMES_CONFIG, 'utf8')) || {} : {}
  applyHermesMcpConfig(config)
  if (includeProvider) applyHermesProviderConfig(config, readEnv(AGENT_ENV))
  writeFileSync(HERMES_CONFIG, stringify(config), { mode: 0o600 })
  chmodSync(HERMES_CONFIG, 0o600)
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
    hermesApiKey: /^arx_sk_/.test(values.ARCOX_HERMES_API_KEY || values.ARCOX_AI_ROUTER_API_KEY || ''),
    solanaSigner: Boolean(values.SOLANA_PRIVATE_KEY),
  }
}

export function hermesSummary() {
  if (!existsSync(HERMES_CONFIG)) return { exists: false, mcpConfigured: false, productionProvider: false }
  try {
    const config = parse(readFileSync(HERMES_CONFIG, 'utf8')) || {}
    return {
      exists: true,
      mcpConfigured: isArcoxMcpServer(config.mcp_servers?.arcox),
      productionProvider: config.model?.provider === 'custom'
        && config.model?.default === ARCOX_AI_MODEL
        && config.model?.base_url === ARCOX_AI_URL
        && Array.isArray(config.custom_providers)
        && config.custom_providers.some(item => isArcoxProvider(item)),
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

function isArcoxProvider(provider) {
  return /arc-dex-bice\.vercel\.app|\barcox\b/i.test(String(provider?.base_url || provider?.name || ''))
}

function applyHermesMcpConfig(config) {
  config.mcp_servers = typeof config.mcp_servers === 'object' && !Array.isArray(config.mcp_servers) ? config.mcp_servers : {}
  config.mcp_servers.arcox = {
    command: NODE_COMMAND,
    args: [ARCOX_AGENT_BIN, 'mcp'],
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
  config.tools = typeof config.tools === 'object' && !Array.isArray(config.tools) ? config.tools : {}
  config.tools.tool_search = typeof config.tools.tool_search === 'object' && !Array.isArray(config.tools.tool_search)
    ? config.tools.tool_search
    : {}
  // Expose every enabled Hermes and MCP tool directly to the model.
  config.tools.tool_search.enabled = false
  config.mcp_discovery_timeout = Math.max(Number(config.mcp_discovery_timeout || 0), 10)
  config.platform_toolsets = typeof config.platform_toolsets === 'object' && !Array.isArray(config.platform_toolsets)
    ? config.platform_toolsets
    : {}
  const configuredCliTools = Array.isArray(config.platform_toolsets.cli)
    ? config.platform_toolsets.cli.filter(name => name !== 'messaging')
    : []
  config.platform_toolsets.cli = [...new Set([...configuredCliTools, ...HERMES_CLI_TOOLSETS])]
  config.auxiliary = typeof config.auxiliary === 'object' && !Array.isArray(config.auxiliary) ? config.auxiliary : {}
  config.auxiliary.title_generation = {
    ...(config.auxiliary.title_generation || {}),
    provider: 'nvidia',
    model: 'nvidia/nemotron-3-nano-30b-a3b',
    timeout: 15,
  }
}

function applyHermesProviderConfig(config, env) {
  config.providers = typeof config.providers === 'object' && !Array.isArray(config.providers) ? config.providers : {}
  const existingCustom = Array.isArray(config.custom_providers)
    ? config.custom_providers.find(item => isArcoxProvider(item))
    : null
  const existingApiKey = String(existingCustom?.api_key || config.providers?.arcox?.api_key || '')
  // The model credential and the local transaction signer are separate trust
  // domains. ARCOX_HERMES_API_KEY may belong to a different wallet; MCP value
  // moving actions continue to use only EOA_PRIVATE_KEY/SOLANA_PRIVATE_KEY.
  const apiKey = env.ARCOX_HERMES_API_KEY || env.ARCOX_AI_ROUTER_API_KEY || existingApiKey
  delete config.providers['arcox-local']
  delete config.providers.arcox
  config.custom_providers = Array.isArray(config.custom_providers)
    ? config.custom_providers.filter(item => !isArcoxProvider(item))
    : []
  config.custom_providers.push({
    name: 'ARCOX User',
    base_url: ARCOX_AI_URL,
    api_key: apiKey,
    model: ARCOX_AI_MODEL,
    models: { [ARCOX_AI_MODEL]: { context_length: 131072 } },
  })
  config.model = typeof config.model === 'object' && !Array.isArray(config.model) ? config.model : {}
  config.model.default = ARCOX_AI_MODEL
  config.model.provider = 'custom'
  config.model.base_url = ARCOX_AI_URL
  config.model.api_key = apiKey
  delete config.model.key_env
}

function isArcoxMcpServer(server) {
  if (!server || !Array.isArray(server.args)) return false
  if (server.command === 'arcox-agent' && server.args.length === 1 && server.args[0] === 'mcp') return true
  return basename(String(server.command || '')) === basename(NODE_COMMAND)
    && server.args.length === 2
    && basename(String(server.args[0] || '')) === 'arcox-agent.mjs'
    && server.args[1] === 'mcp'
}
