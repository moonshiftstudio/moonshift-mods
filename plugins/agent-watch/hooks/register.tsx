import { atom, read, update } from 'claude-code'
import type { AgentStatus, Register } from 'claude-code'

import type { AgentRow, AgentState } from '../types'

const PANE = 'agent-watch'
const TITLE = 'Agent Watch'
const MAIN = 'main'
const KEEP = 40

// Moonshift Studio colors
const GOLD = '#E5B24C'
const MOONLIGHT = '#A9BCFF'
const GREEN = '#5BD69A'
const RED = '#FF6B6B'

const rows = atom({ plugin: 'agent-watch', key: 'rows' } as const, [], {
  shape: 'rows-2',
})
const tick = atom({ plugin: 'agent-watch', key: 'tick' } as const, 0)

// A working agent's moon turns through its phases, one step per beat.
const MOONS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']
const BEAT_MS = 500

const ICON: Record<string, string> = {
  main: '☾',
  Explore: '🔭',
  Plan: '🧭',
  'general-purpose': '🔧',
  claude: '🔧',
  'claude-code-guide': '📖',
  fork: '🌿',
}

const blank = (id: string, now: number): AgentRow => ({
  id,
  title: id === MAIN ? 'Main Claude' : 'Helper agent',
  kind: id === MAIN ? 'main' : 'agent',
  state: 'working',
  now: 'Starting',
  trail: [],
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

const MARK: Record<Exclude<AgentState, 'working'>, string> = {
  waiting: '🌙',
  done: '✦',
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
const COLOR: Record<AgentState, string | undefined> = {
  working: MOONLIGHT,
  waiting: undefined,
  done: GREEN,
  failed: RED,
  stopped: undefined,
}
const ORDER: Record<AgentState, number> = {
  working: 0,
  waiting: 1,
  failed: 2,
  stopped: 3,
  done: 4,
}

/** The moon a working agent shows on this beat; each row runs a step apart. */
const moon = (beat: number, offset = 0): string => MOONS[(beat + offset) % MOONS.length] ?? '🌕'

export const register: Register = on => {
  // Calm: no motion and no finish toasts. Kept between sessions.
  let isCalm = false

  on('session.start', async ($, e, next) => {
    isCalm = (await $.store.get('calm').catch(() => false)) === true
    await $.command.register({
      name: 'agent-watch',
      description: 'Show what every agent is doing and how far along it is',
      argumentHint: '[calm|lively]',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    // The engine's own list is the truth for an agent's status: read it every
    // two seconds. In between, a beat moves the moons while anything works.
    const sync = async (): Promise<void> => {
      const infos = await $.agent.list()
      const now = await $.clock.now()
      if (infos.length === 0) return
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
    let beats = 0
    const beat = async (): Promise<void> => {
      beats += 1
      const isSyncBeat = beats % 4 === 0
      if (isSyncBeat) await sync()
      if (isCalm && !isSyncBeat) return
      const list = await read($, rows)
      if (list.some(row => row.state === 'working')) {
        const now = await $.clock.now()
        await update($, tick, () => now)
      }
    }
    $.clock.every(BEAT_MS, () => void beat().catch(() => undefined))

    return next(e)
  })

  on('command.run', { command: 'agent-watch' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'calm' || word === 'lively') {
      isCalm = word === 'calm'
      await $.store.set('calm', isCalm)

      return {
        text: isCalm
          ? 'Agent Watch is calm: no moving moons and no finish notes.'
          : 'Agent Watch is lively again: moving moons and finish notes are back.',
      }
    }
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
          kind: e.fork ? 'fork' : e.subagentType || row.kind,
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
          ? { startedAt: now, calls: 0, trail: [], planDone: undefined, planTotal: undefined }
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
    const doing = describe(e.tool, input)
    await update($, rows, list =>
      touch(list, id, now, row => ({
        ...row,
        state: 'working',
        now: doing,
        trail: [doing, ...(row.trail ?? [])].slice(0, 3),
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
    const list = await update($, rows, all =>
      touch(all, id, now, row => ({
        ...row,
        state,
        now: id === MAIN && state === 'waiting' ? 'Waiting for you' : WORD[state],
        endedAt: now,
      })),
    )
    await update($, tick, () => now)
    const row = list.find(one => one.id === id)
    if (row && id !== MAIN && !isCalm && (state === 'done' || state === 'failed')) {
      const took = span(now - row.startedAt)
      $.ui.toast(
        state === 'done'
          ? `✦ ${row.title} finished in ${took}`
          : `✗ ${row.title} failed after ${took}`,
      )
    }

    return next(e)
  })

  // A one-line glance above the prompt while helpers are at work.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, rows)
    const busy = list.filter(row => row.id !== MAIN && row.state === 'working')
    if (e.props.hasSurvey || busy.length === 0) return next(e)
    const beat = isCalm ? 4 : Math.floor((await read($, tick)) / BEAT_MS)
    const lead = busy[0]
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box gap={1}>
        <Text color={GOLD}>
          {moon(beat)} {busy.length} {busy.length === 1 ? 'helper' : 'helpers'} working
        </Text>
        {lead && (
          <Text dimColor>
            {short(lead.title, 28)}: {short(lead.now, 36)}
          </Text>
        )}
        <Button
          key="watch"
          label="Watch"
          onPress={() => $.ui.open({ id: PANE, title: TITLE })}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Progress, Button } = $.ui.resolve(e)
    const list = await read($, rows)
    const clock = await read($, tick)
    const beat = isCalm ? 4 : Math.floor(clock / BEAT_MS)
    const working = list.filter(row => row.state === 'working').length
    const done = list.filter(row => row.state === 'done').length
    const actions = list.reduce((sum, row) => sum + row.calls, 0)
    const over = list.filter(
      row => row.id !== MAIN && row.state !== 'working' && row.state !== 'waiting',
    ).length

    if (e.props.placement === 'widget') {
      return (
        <Text color={working > 0 ? GOLD : undefined}>
          {working > 0 ? `${moon(beat)} ${working} working` : list.length === 0 ? '🌙 No agents yet' : `✦ ${done} done`}
        </Text>
      )
    }

    const sorted = [...list].sort(
      (a, b) => ORDER[a.state] - ORDER[b.state] || b.startedAt - a.startedAt,
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold color={GOLD}>
            ☾ AGENT WATCH
          </Text>
          {list.length === 0 ? (
            <Text dimColor>No agents yet</Text>
          ) : (
            <Box gap={2} flexWrap="wrap">
              <Text color={working > 0 ? MOONLIGHT : undefined} dimColor={working === 0}>
                {working > 0 ? moon(beat) : '🌙'} {working} working
              </Text>
              <Text color={GREEN}>✦ {done} done</Text>
              <Text dimColor>{actions} actions</Text>
            </Box>
          )}
        </Box>
        {list.length === 0 && (
          <Text dimColor>
            🌙 All quiet. Helpers show up here the moment Claude starts one.
          </Text>
        )}
        {sorted.map((row, index) => {
          const end = row.endedAt ?? Math.max(clock, row.startedAt)
          const took = span(end - row.startedAt)
          const tag = [row.kind, row.model?.replace(/^claude-/, '')]
            .filter(Boolean)
            .join(' · ')
          const hasPlan = row.planTotal !== undefined && row.planTotal > 0
          const isWorking = row.state === 'working'
          const mark = row.state === 'working' ? moon(beat, index * 3) : MARK[row.state]
          const icon = ICON[row.kind] ?? '🤖'
          const dots = isWorking && !isCalm ? '.'.repeat(beat % 4) : ''
          const past = (row.trail ?? []).slice(row.now === row.trail?.[0] ? 1 : 0, 3)

          return (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={COLOR[row.state] ?? 'subtle'}
              borderDimColor={!isWorking}
              paddingX={1}
            >
              <Text bold color={isWorking ? GOLD : undefined}>
                {mark} {icon} {row.title}
              </Text>
              <Text dimColor>
                {tag} · {row.calls} actions · {took}
              </Text>
              {isWorking && !hasPlan && (
                <Text color={MOONLIGHT}>
                  ▸ {row.now}
                  {dots}
                </Text>
              )}
              {hasPlan && (
                <Progress
                  label={isWorking ? `▸ ${row.now}${dots}` : row.now}
                  value={row.planDone ?? 0}
                  max={row.planTotal}
                  valueText={`${row.planDone ?? 0} of ${row.planTotal} steps`}
                  color={GOLD}
                />
              )}
              {!isWorking && !hasPlan && <Text color={COLOR[row.state]}>{row.now}</Text>}
              {isWorking &&
                past.map(line => (
                  <Text dimColor>
                    {'  '}
                    {line}
                  </Text>
                ))}
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
