import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as mcpClient from '../../services/mcp/client.js'
import { handleMcpApi } from '../api/mcp.js'

let tmpDir: string
let projectRoot: string
let originalConfigDir: string | undefined
let connectSpy: ReturnType<typeof spyOn> | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-mcp-test-'))
  projectRoot = path.join(tmpDir, 'project')
  await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true })

  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
}

function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

describe('MCP API', () => {
  beforeEach(async () => {
    await setup()

    connectSpy = spyOn(mcpClient, 'connectToServer').mockImplementation(async (name, config) => ({
      name,
      type: 'connected',
      client: {} as never,
      capabilities: {},
      config,
      cleanup: mock(async () => {}),
    }))
  })

  afterEach(async () => {
    connectSpy?.mockRestore()
    connectSpy = undefined
    await teardown()
  })

  it('creates and lists local MCP servers for the requested cwd', async () => {
    const create = makeRequest('POST', '/api/mcp', {
      cwd: projectRoot,
      name: 'chrome-devtools',
      scope: 'local',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['chrome-devtools-mcp@latest'],
        env: {
          DEBUG: '1',
        },
      },
    })

    const createRes = await handleMcpApi(create.req, create.url, create.segments)
    expect(createRes.status).toBe(201)
    const createdBody = await createRes.json()
    expect(createdBody.server.name).toBe('chrome-devtools')
    expect(createdBody.server.transport).toBe('stdio')

    const list = makeRequest('GET', `/api/mcp?cwd=${encodeURIComponent(projectRoot)}`)
    const listRes = await handleMcpApi(list.req, list.url, list.segments)
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()

    expect(listBody.servers).toHaveLength(1)
    expect(listBody.servers[0].name).toBe('chrome-devtools')
    expect(listBody.servers[0].status).toBe('connected')
    expect(listBody.servers[0].config.command).toBe('npx')
  })

  it('updates, toggles, and deletes MCP servers', async () => {
    const create = makeRequest('POST', '/api/mcp', {
      cwd: projectRoot,
      name: 'context7',
      scope: 'local',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['@upstash/context7-mcp'],
        env: {},
      },
    })
    await handleMcpApi(create.req, create.url, create.segments)

    const update = makeRequest('PUT', '/api/mcp/context7', {
      cwd: projectRoot,
      scope: 'user',
      config: {
        type: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: {
          Authorization: 'Bearer demo',
        },
      },
    })
    const updateRes = await handleMcpApi(update.req, update.url, update.segments)
    expect(updateRes.status).toBe(200)
    const updatedBody = await updateRes.json()
    expect(updatedBody.server.transport).toBe('http')
    expect(updatedBody.server.scope).toBe('user')

    const disable = makeRequest('POST', '/api/mcp/context7/toggle', { cwd: projectRoot })
    const disableRes = await handleMcpApi(disable.req, disable.url, disable.segments)
    expect(disableRes.status).toBe(200)
    const disabledBody = await disableRes.json()
    expect(disabledBody.server.enabled).toBe(false)
    expect(disabledBody.server.status).toBe('disabled')

    const enable = makeRequest('POST', '/api/mcp/context7/toggle', { cwd: projectRoot })
    const enableRes = await handleMcpApi(enable.req, enable.url, enable.segments)
    expect(enableRes.status).toBe(200)
    const enabledBody = await enableRes.json()
    expect(enabledBody.server.enabled).toBe(true)

    const remove = makeRequest('DELETE', `/api/mcp/context7?scope=user&cwd=${encodeURIComponent(projectRoot)}`)
    const removeRes = await handleMcpApi(remove.req, remove.url, remove.segments)
    expect(removeRes.status).toBe(200)

    const list = makeRequest('GET', `/api/mcp?cwd=${encodeURIComponent(projectRoot)}`)
    const listRes = await handleMcpApi(list.req, list.url, list.segments)
    const listBody = await listRes.json()
    expect(listBody.servers.some((server: { name: string }) => server.name === 'context7')).toBe(false)
  })
})
