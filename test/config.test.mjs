import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { parse } from 'yaml'

function setupIsolatedEnv() {
  const root = mkdtempSync(join(tmpdir(), 'arcox-agent-'))
  process.env.ARCOX_HOME = join(root, '.arcox')
  process.env.ARCOX_AGENT_ENV = join(root, '.arcox', 'agent.env')
  process.env.HERMES_HOME = join(root, '.hermes')
  process.env.ARCOX_SKIP_HERMES_AUTH_CLEANUP = '1'
  writeFileSync(join(root, 'template'), 'EOA_PRIVATE_KEY=\nARCOX_AI_ROUTER_API_KEY=arx_sk_mcp\nARCOX_HERMES_API_KEY=arx_sk_model\n')
  return { root, template: join(root, 'template') }
}

test('Hermes config defaults to MCP-only wiring', async () => {
  const { root, template } = setupIsolatedEnv()
  const config = await import(`../lib/config.mjs?test=${Date.now()}`)
  config.ensureAgentEnv(template)
  config.configureHermes()
  const yaml = parse(readFileSync(join(root, '.hermes', 'config.yaml'), 'utf8'))
  assert.equal(yaml.model, undefined)
  assert.equal(yaml.custom_providers, undefined)
  assert.equal(basename(yaml.mcp_servers.arcox.command), basename(process.execPath))
  assert.equal(basename(yaml.mcp_servers.arcox.args[0]), 'arcox-agent.mjs')
  assert.equal(yaml.mcp_servers.arcox.args[1], 'mcp')
  assert.equal(yaml.mcp_servers.arcox.connect_timeout, 90)
  assert.equal(yaml.mcp_servers.arcox.timeout, 180)
  assert.deepEqual(yaml.toolsets, ['hermes-cli'])
  assert.equal(yaml.agent.reasoning_effort, 'low')
  assert.equal(yaml.agent.environment_probe, false)
  assert.equal(yaml.tools.tool_search.enabled, false)
  assert.equal(yaml.mcp_discovery_timeout, 10)
  assert.equal(yaml.platform_toolsets.cli.includes('terminal'), true)
  assert.equal(yaml.platform_toolsets.cli.includes('web'), true)
  assert.equal(yaml.platform_toolsets.cli.includes('context_engine'), true)
  assert.equal(yaml.platform_toolsets.cli.includes('messaging'), false)
  assert.equal(yaml.auxiliary.title_generation.provider, 'nvidia')
  assert.equal(statSync(config.AGENT_ENV).mode & 0o777, 0o600)
  assert.equal(config.hermesSummary().mcpConfigured, true)
  assert.equal(config.hermesSummary().productionProvider, false)
  assert.equal(config.envSummary().apiKey, true)
  assert.equal(config.envSummary().hermesApiKey, true)
})

test('connection token input is validated and stored outside agent.env', async () => {
  const { root, template } = setupIsolatedEnv()
  const config = await import(`../lib/config.mjs?test=${Date.now()}-connection`)
  config.ensureAgentEnv(template)
  const token = `arx_at_${'a'.repeat(32)}`
  const input = `Hubungkan ARCOX. URL server: http://localhost:3901/mcp Token: ${token} Token expires: 2026-11-24T00:00:00.000Z`
  const parsed = config.parseConnectionInput(input)
  assert.equal(parsed.url, 'http://localhost:3901/mcp')
  assert.equal(parsed.token, token)
  assert.equal(parsed.expiresAt, '2026-11-24T00:00:00.000Z')
  config.configureHermesConnectionToken(parsed)
  const yaml = parse(readFileSync(join(root, '.hermes', 'config.yaml'), 'utf8'))
  assert.equal(yaml.mcp_servers.arcox.url, 'http://localhost:3901/mcp')
  assert.equal(yaml.mcp_servers.arcox.auth, 'header')
  assert.equal(yaml.mcp_servers.arcox.headers.Authorization, 'Bearer ${MCP_ARCOX_API_KEY}')
  assert.equal(config.hermesConnectionToken(), token)
  assert.equal(readFileSync(config.AGENT_ENV, 'utf8').includes(token), false)
  assert.equal(yaml.mcp_servers.arcox.headers.Authorization.includes(token), false)
  assert.equal(config.validateConnectionToken('not-a-token'), false)
  assert.throws(() => config.parseConnectionInput(`URL server: https://evil.example/mcp Token: ${token}`), /endpoint ARCOX resmi/)
})

test('remote MCP probe resolves the token-bound MSCA instead of a local wallet', async () => {
  const config = await import(`../lib/config.mjs?test=${Date.now()}-remote-probe`)
  const token = `arx_at_${'b'.repeat(32)}`
  const walletAddress = '0x2222222222222222222222222222222222222222'
  const requests = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), authorization: options.headers?.Authorization, body: JSON.parse(options.body) })
    const body = requests.at(-1).body
    const payload = body.method === 'initialize'
      ? { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26' } }
      : body.method === 'tools/list'
        ? { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'arcox_session_status' }] } }
        : { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ active: true, walletAddress, walletType: 'MSCA' }) }] } }
    const headers = body.method === 'initialize' ? { 'mcp-session-id': 'probe-session' } : {}
    return new Response(JSON.stringify(payload), { status: 200, headers })
  }
  try {
    const result = await config.probeMcpConnection('http://localhost:3901/mcp', token)
    assert.deepEqual(result, {
      ok: true,
      status: 200,
      tools: 1,
      sessionId: 'probe-session',
      walletAddress,
      walletType: 'MSCA',
      active: true,
    })
    assert.equal(requests.length, 3)
    assert.deepEqual(requests.map(request => request.body.method), ['initialize', 'tools/list', 'tools/call'])
    assert.ok(requests.every(request => request.authorization === `Bearer ${token}`))
    assert.equal(requests[2].body.params.name, 'arcox_session_status')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('remote MCP probe rejects a connection without an active MSCA', async () => {
  const config = await import(`../lib/config.mjs?test=${Date.now()}-remote-probe-inactive`)
  const token = `arx_at_${'c'.repeat(32)}`
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body)
    const payload = body.method === 'initialize'
      ? { jsonrpc: '2.0', id: body.id, result: {} }
      : body.method === 'tools/list'
        ? { jsonrpc: '2.0', id: body.id, result: { tools: [] } }
        : { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ active: false, message: 'MSCA belum aktif' }) }] } }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'mcp-session-id': 'probe-session' } })
  }
  try {
    await assert.rejects(config.probeMcpConnection('http://localhost:3901/mcp', token), /MSCA belum aktif/)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Hermes provider setup remains available when explicitly requested', async () => {
  const { root, template } = setupIsolatedEnv()
  const config = await import(`../lib/config.mjs?test=${Date.now()}-provider`)
  config.ensureAgentEnv(template)
  config.configureHermes({ includeProvider: true })
  const yaml = parse(readFileSync(join(root, '.hermes', 'config.yaml'), 'utf8'))
  assert.equal(yaml.model.provider, 'custom')
  assert.equal(yaml.model.default, 'openai/gpt-oss-120b')
  assert.equal(yaml.model.base_url, 'https://arcoxdex.vercel.app/v1')
  assert.equal(yaml.model.api_key, 'arx_sk_model')
  assert.equal(yaml.providers?.arcox, undefined)
  assert.equal(yaml.custom_providers.filter(item => item.name === 'ARCOX User').length, 1)
  assert.equal(yaml.custom_providers.find(item => item.name === 'ARCOX User').api_key, 'arx_sk_model')
  assert.equal(config.hermesSummary().mcpConfigured, true)
  assert.equal(config.hermesSummary().productionProvider, true)
})
