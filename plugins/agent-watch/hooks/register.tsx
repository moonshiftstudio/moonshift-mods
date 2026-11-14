import { atom, read, update } from 'claude-code'
import type { AgentStatus, Register } from 'claude-code'

import type { AgentRow, AgentState } from '../types'

const PANE = 'agent-watch'
const TITLE = 'Agent Watch'
const MAIN = 'main'
const KEEP = 40

const rows = atom({ plugin: 'agent-watch', key: 'rows' } as const, [], {
  shape: 'rows-1',
})
const tick = atom({ plugin: 'agent-watch', key: 'tick' } as const, 0)

const blank = (id: string, now: number): AgentRow => ({
  id,
  title: id === MAIN ? 'Main Claude' : 'Helper agent',
  kind: id === MAIN ? 'main' : 'agent',
  state: 'working',
  now: 'Starting',
  startedAt: now,
  calls: 0,
})

/** Changes the row with this id, adding it first when it is new. */
const touch = (
  list: readonly AgentRow[],
  id: string,
  now: number,
  change: (row: AgentRow) => AgentRow,
): AgentRow[] => {
  const has = list.some(row => row.id === id)
  const all = has ? [...list] : [...list, blank(id, now)]

  return all.map(row => (row.id === id ? change(row) : row)).slice(-KEEP)
}

const stateOf = (status: AgentStatus): AgentState => {
  if (status === 'pending' || status === 'running') return 'working'
  if (status === 'waiting' || status === 'idle') return 'waiting'
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'

  return 'stopped'
}

const short = (text: string, max = 48): string => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const fileName = (path: string): string => path.split(/[\\/]/).pop() || path

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A tool call in plain words: "Reading scanner.ts", "Running: npm test". */
const describe = (tool: string, e: Record<string, unknown>): string => {
  const file = fileName(text(e.file_path) || text(e.notebook_path))
  if (tool === 'Read') return `Reading ${file}`
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit')
    return `Editing ${file}`
  if (tool === 'Bash' || tool === 'PowerShell')
    return `Running: ${short(text(e.description) || text(e.command))}`
  if (tool === 'Grep' || tool === 'Glob')
    return `Searching for ${short(text(e.pattern), 36)}`
  if (tool === 'WebSearch') return `Searching the web: ${short(text(e.query), 32)}`
  if (tool === 'WebFetch') return 'Reading a web page'
  if (tool === 'Agent') return `Starting a helper: ${short(text(e.description), 30)}`
  if (tool === 'Skill') return `Loading skill ${text(e.skill)}`
  if (tool.startsWith('mcp__'))
    return `Using ${short((tool.split('__').pop() ?? tool).replace(/_/g, ' '), 40)}`

  return `Using ${tool}`
}

/** Reads task-list progress off the tools that keep one. */
const planOf = (
  tool: string,
  e: Record<string, unknown>,
  row: AgentRow,
): Pick<AgentRow, 'planDone' | 'planTotal'> => {
  const items = Array.isArray(e.todos) ? e.todos : Array.isArray(e.items) ? e.items : null
  const isList = tool === 'TodoWrite' || tool.endsWith('__update_plan')
  if (isList && items) {
    const done = items.filter(
      item => (item as { status?: unknown } | null)?.status === 'completed',
    ).length

    return { planDone: done, planTotal: items.length }
  }
  if (row.planTotal === undefined) return {}
  const total = row.planTotal
  const sofar = row.planDone ?? 0
  if (isList && e.advance === true)
    return { planDone: Math.min(total, sofar + 1), planTotal: total }
  if (isList && Array.isArray(e.done))
    return { planDone: Math.min(total, sofar + e.done.length), planTotal: total }
  if (tool.endsWith('__wrap_up')) return { planDone: total, planTotal: total }

  return {}
}

const span = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const MARK: Record<AgentState, string> = {
  working: '●',
  waiting: '◌',
  done: '✓',
  failed: '✗',
  stopped: '■',
}
const WORD: Record<AgentState, string> = {
  working: 'Working',
  waiting: 'Waiting',
  done: 'Finished',
  failed: 'Failed',
  stopped: 'Stopped',
}
const ORDER: Record<AgentState, number> = {
  working: 0,
  waiting: 1,
  failed: 2,
  stopped: 3,
  done: 4,
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-watch',
      description: 'Show what every agent is doing and how far along it is',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    // The engine's own list is the truth for an agent's status: read it every
    // two seconds, and move the clock the pane draws elapsed time from.
    const sync = async (): Promise<void> => {
      const infos = await $.agent.list()
      const now = await $.clock.now()
      const before = await read($, rows)
      const isBusy =
        before.some(row => row.state === 'working') ||
        infos.some(info => stateOf(info.status) === 'working')
      if (infos.length > 0) {
        await update($, rows, list =>
          infos.reduce<AgentRow[]>(
            (acc, info) =>
              touch(acc, info.id, now, row => {
                const state = stateOf(info.status)
                const isOver = state !== 'working' && state !== 'waiting'

                return {
                  ...row,
                  title: info.description || info.name || row.title,
                  kind: info.type || row.kind,
                  state,
                  now: state === 'working' ? row.now : WORD[state],
                  endedAt: isOver ? (row.endedAt ?? now) : undefined,
                }
              }),
            [...list],
          ),
        )
      }
      if (isBusy) await update($, tick, () => now)
    }
    $.clock.every(2000, () => void sync().catch(() => undefined))

    return next(e)
  })

  on('command.run', { command: 'agent-watch' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE })

    return {
      text: isPlaced
        ? 'Agent Watch panel opened.'
        : 'Agent Watch is on, but this screen cannot show its panel.',
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId) {
      const now = await $.clock.now()
      const { agentId, model } = started
      await update($, rows, list =>
        touch(list, agentId, now, row => ({
          ...row,
          title: e.description || row.title,
          kind: e.subagentType || row.kind,
          model,
        })),
      )
    }

    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const now = await $.clock.now()
    await update($, rows, list =>
      touch(list, id, now, row => ({
        ...row,
        state: 'working',
        now: 'Thinking',
        endedAt: undefined,
        ...(id === MAIN
          ? { startedAt: now, calls: 0, planDone: undefined, planTotal: undefined }
          : {}),
      })),
    )
    await update($, tick, () => now)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const now = await $.clock.now()
    const input = e as unknown as Record<string, unknown>
    await update($, rows, list =>
      touch(list, id, now, row => ({
        ...row,
        state: 'working',
        now: describe(e.tool, input),
        calls: row.calls + 1,
        endedAt: undefined,
        ...planOf(e.tool, input, row),
      })),
    )
    const ran = await next(e)
    await update($, rows, list =>
      list.map(row =>
        row.id === id && row.state === 'working' ? { ...row, now: 'Thinking' } : row,
      ),
    )

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const now = await $.clock.now()
    const state: AgentState =
      e.reason === 'error' ? 'failed' : e.isAborted ? 'stopped' : id === MAIN ? 'waiting' : 'done'
    await update($, rows, list =>
      touch(list, id, now, row => ({
        ...row,
        state,
        now: id === MAIN && state === 'waiting' ? 'Waiting for you' : WORD[state],
        endedAt: now,
      })),
    )
    await update($, tick, () => now)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Progress, Button } = $.ui.resolve(e)
    const list = await read($, rows)
    const clock = await read($, tick)
    const working = list.filter(row => row.state === 'working').length
    const over = list.filter(
      row => row.id !== MAIN && row.state !== 'working' && row.state !== 'waiting',
    ).length
    const summary =
      list.length === 0
        ? 'No agents yet'
        : `${working} working · ${list.length - working} idle or finished`

    if (e.props.placement === 'widget') return <Text>{summary}</Text>

    const sorted = [...list].sort(
      (a, b) => ORDER[a.state] - ORDER[b.state] || b.startedAt - a.startedAt,
    )

    return (
      <Box flexDirection="column">
        <Text dimColor>{summary}</Text>
        <Text> </Text>
        {list.length === 0 && (
          <Text dimColor>Agents show up here as soon as Claude starts working.</Text>
        )}
        {sorted.map(row => {
          const end = row.endedAt ?? Math.max(clock, row.startedAt)
          const took = span(end - row.startedAt)
          const tag = [row.kind, row.model?.replace(/^claude-/, '')]
            .filter(Boolean)
            .join(' · ')
          const hasPlan = row.planTotal !== undefined && row.planTotal > 0
          const isWorking = row.state === 'working'

          return (
            <Box flexDirection="column">
              <Text weight="bold">
                {MARK[row.state]} {row.title}
              </Text>
              <Text dimColor>
                {tag} · {row.calls} actions · {took}
              </Text>
              {(isWorking || hasPlan) && (
                <Progress
                  label={row.now}
                  value={hasPlan ? row.planDone ?? 0 : undefined}
                  max={hasPlan ? row.planTotal : undefined}
                  valueText={
                    hasPlan ? `${row.planDone ?? 0} of ${row.planTotal} steps` : undefined
                  }
                />
              )}
              {!isWorking && !hasPlan && <Text>{row.now}</Text>}
              <Text> </Text>
            </Box>
          )
        })}
        {over > 0 && (
          <Button
            key="clear"
            label="Clear finished"
            onPress={() =>
              update($, rows, all =>
                all.filter(
                  row =>
                    row.id === MAIN || row.state === 'working' || row.state === 'waiting',
                ),
              )
            }
          />
        )}
      </Box>
    )
  })
}
