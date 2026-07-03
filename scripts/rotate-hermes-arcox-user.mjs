import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const agentEnvPath = process.env.ARCOX_AGENT_ENV || join(homedir(), '.arcox', 'agent.env')
const hermesConfigPath = join(homedir(), '.hermes', 'config.yaml')
const agentEnvText = readFileSync(agentEnvPath, 'utf8')
const env = parseEnv(agentEnvText)
const backend = String(env.ARCOX_API_BASE_URL || 'https://43.163.98.128.nip.io').replace(/\/$/, '')
const providerBaseUrl = 'https://arc-dex-bice.vercel.app/v1'
const model = 'openai/gpt-oss-120b'
const privateKey = normalizePrivateKey(env.EOA_PRIVATE_KEY)
const account = privateKeyToAccount(privateKey)
const ownerAddress = getAddress(account.address)

const issuedAt = new Date().toISOString()
const message = [
  'ARCOX DEX login',
  'Only sign this message on the official ARCOX DEX website.',
  `Address: ${ownerAddress}`,
  `Issued At: ${issuedAt}`,
  'Network: Arc Testnet',
].join('\n')
const signature = await account.signMessage({ message })
const session = await request('/api/auth/session', {
  body: { address: ownerAddress, issuedAt, signature },
})
const authToken = session.token

let revokedKeyId = ''
const oldKey = String(env.ARCOX_AI_ROUTER_API_KEY || '')
if (oldKey.startsWith('arx_sk_')) {
  const statusResponse = await fetch(`${backend}/api/ai-router/api-keys/status`, {
    headers: { Authorization: `Bearer ${oldKey}` },
  })
  if (statusResponse.ok) {
    const status = await statusResponse.json()
    revokedKeyId = String(status?.key?.id || '')
    if (revokedKeyId) {
      await request(`/api/ai-router/api-keys/${encodeURIComponent(revokedKeyId)}/revoke`, {
        token: authToken,
        body: { ownerAddress },
      })
    }
  }
}

const created = await request('/api/ai-router/api-keys', {
  token: authToken,
  body: { ownerAddress, label: `Hermes User ${new Date().toISOString()}` },
})
const newKey = String(created.apiKey || '')
if (!newKey.startsWith('arx_sk_')) throw new Error('ARCOX did not return a valid user API key')

const nextEnv = upsertEnv(upsertEnv(agentEnvText, 'ARCOX_AI_ROUTER_API_KEY', newKey), 'ARCOX_HERMES_API_KEY', newKey)
atomicWrite(agentEnvPath, nextEnv)

const config = parse(readFileSync(hermesConfigPath, 'utf8')) || {}
config.providers = object(config.providers)
delete config.providers.arcox
config.custom_providers = Array.isArray(config.custom_providers)
  ? config.custom_providers.filter(item => !isArcoxProvider(item))
  : []
config.custom_providers.push({
  name: 'ARCOX User',
  base_url: providerBaseUrl,
  api_key: newKey,
  model,
  models: { [model]: { context_length: 131072 } },
})
config.model = {
  ...object(config.model),
  default: model,
  provider: 'custom',
  base_url: providerBaseUrl,
  api_key: newKey,
}
atomicWrite(hermesConfigPath, stringify(config))

const verify = await fetch(`${backend}/api/ai-router/api-keys/status`, {
  headers: { Authorization: `Bearer ${newKey}` },
})
if (!verify.ok) throw new Error(`New ARCOX key verification failed: HTTP ${verify.status}`)

console.log(JSON.stringify({
  ok: true,
  ownerAddress,
  revokedOldKey: Boolean(revokedKeyId),
  newKeyId: created?.key?.id || '',
  provider: 'ARCOX User',
  model,
  secretsPrinted: false,
}, null, 2))

async function request(path, { token = '', body }) {
  const response = await fetch(`${backend}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error?.message || data?.error || data?.message || `HTTP ${response.status}`)
  return data
}

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return []
    const index = trimmed.indexOf('=')
    return [[trimmed.slice(0, index), trimmed.slice(index + 1).replace(/^['"]|['"]$/g, '')]]
  }))
}

function normalizePrivateKey(value = '') {
  const normalized = String(value).trim()
  const key = normalized.startsWith('0x') ? normalized : `0x${normalized}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('EOA_PRIVATE_KEY is missing or invalid')
  return key
}

function upsertEnv(text, name, value) {
  const line = `${name}=${value}`
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  return pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\s*$/, '')}\n${line}\n`
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function isArcoxProvider(provider) {
  return /arc-dex-bice\.vercel\.app|\barcox\b/i.test(String(provider?.base_url || provider?.name || ''))
}

function atomicWrite(path, value) {
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, value, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}
