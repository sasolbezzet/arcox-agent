import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'

export const ARCOX_HOME = process.env.ARCOX_HOME || join(homedir(), '.arcox')
export const AGENT_ENV = process.env.ARCOX_AGENT_ENV || join(ARCOX_HOME, 'agent.env')
export const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
export const HERMES_CONFIG = join(HERMES_HOME, 'config.yaml')
export const HERMES_ENV = join(HERMES_HOME, '.env')
export const CONNECTION_STATE = join(ARCOX_HOME, 'connection.json')
export const ARCOX_AI_URL = 'https://arcoxdex.vercel.app/v1'
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
  if (!existsSync(HERMES_CONFIG)) return { exists: false, mcpConfigured: false, connectionConfigured: false, productionProvider: false }
  try {
    const config = parse(readFileSync(HERMES_CONFIG, 'utf8')) || {}
    const server = config.mcp_servers?.arcox
    const headers = server?.headers || {}
    const authHeader = String(headers.Authorization || headers.authorization || '')
    return {
      exists: true,
      mcpConfigured: isArcoxMcpServer(server) || isArcoxRemoteMcpServer(server),
      connectionConfigured: isArcoxRemoteMcpServer(server) && Boolean(authHeader),
      connectionUrl: isArcoxRemoteMcpServer(server) ? String(server.url || '') : '',
      productionProvider: config.model?.provider === 'custom'
        && config.model?.default === ARCOX_AI_MODEL
        && config.model?.base_url === ARCOX_AI_URL
        && Array.isArray(config.custom_providers)
        && config.custom_providers.some(item => isArcoxProvider(item)),
    }
  } catch {
    return { exists: true, mcpConfigured: false, connectionConfigured: false, productionProvider: false }
  }
}

export function parseConnectionInput(input, fallbackUrl = 'https://arcoxdex.vercel.app/mcp') {
  const text = String(input || '').trim()
  const tokenMatch = text.match(/\barx_at_[0-9a-f-]{32,}\b/i)
  if (!tokenMatch) throw new Error('Connection token tidak ditemukan atau formatnya salah (harus arx_at_...)')
  const urlMatch = text.match(/(?:URL(?: server)?|MCP URL)\s*:\s*(https?:\/\/[^\s]+)/i)
  const url = String(urlMatch?.[1] || fallbackUrl).replace(/[),.;]+$/, '')
  validateMcpUrl(url)
  const expiryMatch = text.match(/(?:Token expires|Expires|Kedaluwarsa)\s*:\s*([^\s]+)/i)
  const expiresAt = expiryMatch?.[1] && !Number.isNaN(Date.parse(expiryMatch[1]))
    ? new Date(expiryMatch[1]).toISOString()
    : ''
  return { url, token: tokenMatch[0], expiresAt }
}

export function validateConnectionToken(token) {
  return /^arx_at_[0-9a-f-]{32,}$/i.test(String(token || '').trim())
}

export function validateMcpUrl(url) {
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('MCP URL tidak valid') }
  if (parsed.pathname !== '/mcp' || !['https:', 'http:'].includes(parsed.protocol)) throw new Error('MCP URL harus menunjuk ke endpoint /mcp')
  const localHost = ['localhost', '127.0.0.1'].includes(parsed.hostname)
  if (parsed.protocol === 'http:' && !localHost) throw new Error('HTTP hanya diizinkan untuk localhost/127.0.0.1')
  if (parsed.protocol === 'https:' && parsed.hostname !== 'arcoxdex.vercel.app' && !localHost) throw new Error('HTTPS hanya diizinkan untuk endpoint ARCOX resmi')
  return parsed.toString().replace(/\/$/, '')
}

export function configureHermesConnectionToken({ url, token, expiresAt = '' }) {
  const normalizedUrl = validateMcpUrl(url)
  const normalizedToken = String(token || '').trim()
  if (!validateConnectionToken(normalizedToken)) throw new Error('Connection token format tidak valid')
  mkdirSync(HERMES_HOME, { recursive: true, mode: 0o700 })
  const config = existsSync(HERMES_CONFIG) ? parse(readFileSync(HERMES_CONFIG, 'utf8')) || {} : {}
  config.mcp_servers = typeof config.mcp_servers === 'object' && !Array.isArray(config.mcp_servers) ? config.mcp_servers : {}
  config.mcp_servers.arcox = {
    url: normalizedUrl,
    auth: 'header',
    headers: { Authorization: 'Bearer ${MCP_ARCOX_API_KEY}' },
    connect_timeout: 90,
    timeout: 180,
    enabled: true,
  }
  writeFileSync(HERMES_CONFIG, stringify(config), { mode: 0o600 })
  chmodSync(HERMES_CONFIG, 0o600)
  saveHermesEnvValue('MCP_ARCOX_API_KEY', normalizedToken)
  mkdirSync(ARCOX_HOME, { recursive: true, mode: 0o700 })
  writeFileSync(CONNECTION_STATE, JSON.stringify({ url: normalizedUrl, expiresAt: expiresAt || null, connectedAt: new Date().toISOString() }, null, 2) + '\\n', { mode: 0o600 })
  chmodSync(CONNECTION_STATE, 0o600)
  return { url: normalizedUrl, expiresAt: expiresAt || null }
}

export async function probeMcpConnection(url, token) {
  const normalizedUrl = validateMcpUrl(url)
  if (!validateConnectionToken(token)) throw new Error('Connection token format tidak valid')
  const first = await mcpRequest(normalizedUrl, token, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'arcox-agent-doctor', version: '1' } },
  })
  const second = await mcpRequest(normalizedUrl, token, {
    jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
  }, first.sessionId)
  const tools = second.payload?.result?.tools
  if (!Array.isArray(tools)) throw new Error('MCP tools/list tidak mengembalikan daftar tool')
  return { ok: true, status: second.status, tools: tools.length, sessionId: second.sessionId || first.sessionId || '' }
}

export function connectionState() {
  if (!existsSync(CONNECTION_STATE)) return null
  try { return JSON.parse(readFileSync(CONNECTION_STATE, 'utf8')) } catch { return null }
}

export function hermesConnectionToken() {
  if (!existsSync(HERMES_ENV)) return ''
  try { return String(readEnv(HERMES_ENV).MCP_ARCOX_API_KEY || '') } catch { return '' }
}

async function mcpRequest(url, token, body, sessionId = '') {
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await response.text()
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`)
  const payload = parseRpcResponse(text)
  return { status: response.status, sessionId: response.headers.get('mcp-session-id') || '', payload }
}

function parseRpcResponse(text) {
  const candidates = String(text || '').split(/\\r?\\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim())
  for (const candidate of [...candidates, String(text || '').trim()]) {
    if (!candidate || candidate === '[DONE]') continue
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') return parsed
    } catch { /* stream may contain non-JSON keepalive lines */ }
  }
  throw new Error('MCP response bukan JSON-RPC yang valid')
}

function saveHermesEnvValue(key, value) {
  mkdirSync(HERMES_HOME, { recursive: true, mode: 0o700 })
  const newline = String.fromCharCode(10)
  const lines = existsSync(HERMES_ENV) ? readFileSync(HERMES_ENV, 'utf8').split(newline) : []
  const assignment = `${key}=${value}`
  let replaced = false
  const next = lines.map(line => {
    if (line.trim().startsWith(`${key}=`)) { replaced = true; return assignment }
    return line
  }).filter((line, index, all) => !(line === '' && index === all.length - 1))
  if (!replaced) next.push(assignment)
  writeFileSync(HERMES_ENV, next.join(newline) + newline, { mode: 0o600 })
  chmodSync(HERMES_ENV, 0o600)
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
  return /arcoxdex\.vercel\.app|arc-dex-bice\.vercel\.app|\barcox\b/i.test(String(provider?.base_url || provider?.name || ''))
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

function isArcoxRemoteMcpServer(server) {
  return Boolean(server && typeof server === 'object' && typeof server.url === 'string' && server.url.endsWith('/mcp'))
}

function isArcoxMcpServer(server) {
  if (!server || !Array.isArray(server.args)) return false
  if (server.command === 'arcox-agent' && server.args.length === 1 && server.args[0] === 'mcp') return true
  return basename(String(server.command || '')) === basename(NODE_COMMAND)
    && server.args.length === 2
    && basename(String(server.args[0] || '')) === 'arcox-agent.mjs'
    && server.args[1] === 'mcp'
}
