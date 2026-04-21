import { create } from 'zustand'
import { mcpApi } from '../api/mcp'
import type { McpServerRecord, McpUpsertPayload } from '../types/mcp'

type McpStore = {
  servers: McpServerRecord[]
  selectedServer: McpServerRecord | null
  isLoading: boolean
  error: string | null
  fetchServers: (projectPaths?: string[], fallbackCwd?: string) => Promise<void>
  createServer: (name: string, payload: McpUpsertPayload, cwd?: string) => Promise<McpServerRecord>
  updateServer: (name: string, payload: McpUpsertPayload, cwd?: string) => Promise<McpServerRecord>
  deleteServer: (name: string, scope: string, cwd?: string) => Promise<void>
  toggleServer: (name: string, cwd?: string) => Promise<McpServerRecord>
  reconnectServer: (name: string, cwd?: string) => Promise<McpServerRecord>
  selectServer: (server: McpServerRecord | null) => void
}

function upsertByName(servers: McpServerRecord[], server: McpServerRecord) {
  const index = servers.findIndex((item) => item.name === server.name)
  if (index === -1) return [...servers, server]
  return servers.map((item, itemIndex) => (itemIndex === index ? server : item))
}

export const useMcpStore = create<McpStore>((set) => ({
  servers: [],
  selectedServer: null,
  isLoading: false,
  error: null,

  fetchServers: async (projectPaths, fallbackCwd) => {
    set({ isLoading: true, error: null })
    try {
      const normalizedPaths = Array.from(new Set((projectPaths ?? []).filter(Boolean)))
      const contexts = normalizedPaths.length > 0 ? normalizedPaths : [fallbackCwd].filter(Boolean)

      const responses = await Promise.all(
        (contexts.length > 0 ? contexts : [undefined]).map(async (cwd) => {
          const response = await mcpApi.list(cwd)
          return response.servers.map((server) => ({
            ...server,
            projectPath: server.scope === 'local' || server.scope === 'project' ? cwd : undefined,
          }))
        }),
      )

      const deduped = new Map<string, McpServerRecord>()
      for (const group of responses) {
        for (const server of group) {
          const key =
            server.scope === 'local' || server.scope === 'project'
              ? `${server.scope}:${server.projectPath}:${server.name}`
              : `${server.scope}:${server.name}`
          if (!deduped.has(key)) {
            deduped.set(key, server)
          }
        }
      }

      set({ servers: [...deduped.values()], isLoading: false })
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load MCP servers',
      })
    }
  },

  createServer: async (name, payload, cwd) => {
    const response = await mcpApi.create(name, payload, cwd)
    set((state) => ({
      servers: [...state.servers, response.server],
      selectedServer: response.server,
      error: null,
    }))
    return response.server
  },

  updateServer: async (name, payload, cwd) => {
    const response = await mcpApi.update(name, payload, cwd)
    set((state) => ({
      servers: upsertByName(
        state.servers.filter((server) => server.name !== name),
        response.server,
      ),
      selectedServer: response.server,
      error: null,
    }))
    return response.server
  },

  deleteServer: async (name, scope, cwd) => {
    await mcpApi.remove(name, scope, cwd)
    set((state) => ({
      servers: state.servers.filter((server) => !(server.name === name && server.scope === scope && (server.projectPath ?? '') === (cwd ?? ''))),
      selectedServer:
        state.selectedServer?.name === name && state.selectedServer?.scope === scope
          ? null
          : state.selectedServer,
      error: null,
    }))
  },

  toggleServer: async (name, cwd) => {
    const response = await mcpApi.toggle(name, cwd)
    set((state) => ({
      servers: upsertByName(state.servers, response.server),
      selectedServer: state.selectedServer?.name === name ? response.server : state.selectedServer,
      error: null,
    }))
    return response.server
  },

  reconnectServer: async (name, cwd) => {
    const response = await mcpApi.reconnect(name, cwd)
    set((state) => ({
      servers: upsertByName(state.servers, response.server),
      selectedServer: state.selectedServer?.name === name ? response.server : state.selectedServer,
      error: null,
    }))
    return response.server
  },

  selectServer: (server) => set({ selectedServer: server }),
}))
