import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Todo } from '../types'

const PANE = 'studio-board'
const STORE_KEY = 'todos'
const GOLD = '#E5B24C'

const todos = atom({ plugin: 'studio-board', key: 'todos' } as const, [] as Todo[])
const isAdding = atom({ plugin: 'studio-board', key: 'isAdding' } as const, false)

type Link = { label: string; href: string }
type App = {
  name: string
  status: string
  color: string
  match: RegExp
  links: Link[]
  note?: string
}

// Everything the studio runs. Edit this list when something changes.
const APPS: App[] = [
  {
    name: 'Nopehook',
    status: 'In development',
    color: '#F07020',
    match: /(^|[\\/])nopehook[^\\/]*([\\/]|$)/i,
    links: [{ label: 'Page', href: 'https://moonshiftstudio.com/apps/nopehook' }],
  },
  {
    name: 'Unbadged',
    status: 'Invite-only beta',
    color: '#FF7C30',
    match: /(^|[\\/])unbadged[^\\/]*([\\/]|$)/i,
    links: [
      { label: 'Page', href: 'https://moonshiftstudio.com/apps/unbadged' },
      { label: 'Vercel', href: 'https://vercel.com/moonshiftstudio/unbadged' },
    ],
    note: 'Supabase project is paused. Restore it before inviting testers.',
  },
  {
    name: 'Firefly Dash',
    status: 'Live',
    color: '#C6F24E',
    match: /(^|[\\/])firefly-dash([\\/]|$)/i,
    links: [
      { label: 'Play', href: 'https://fireflydash.moonshiftstudio.com' },
      { label: 'Repo', href: 'https://github.com/moonshiftstudio/firefly-dash' },
      { label: 'Vercel', href: 'https://vercel.com/moonshiftstudio/firefly-dash' },
    ],
  },
  {
    name: 'Manatable',
    status: 'In testing',
    color: '#E7C77A',
    match: /(^|[\\/])(manatable|commander-table)([\\/]|$)/i,
    links: [
      { label: 'Test app', href: 'https://commander-table-kappa.vercel.app' },
      { label: 'Repo', href: 'https://github.com/moonshiftstudio/commander-table' },
      { label: 'Vercel', href: 'https://vercel.com/moonshiftstudio/commander-table' },
    ],
  },
  {
    name: 'Website',
    status: 'Live',
    color: GOLD,
    match: /(^|[\\/])moonshiftstudio-site([\\/]|$)/i,
    links: [
      { label: 'Site', href: 'https://moonshiftstudio.com' },
      { label: 'Repo', href: 'https://github.com/moonshiftstudio/moonshiftstudio-site' },
      { label: 'Vercel', href: 'https://vercel.com/moonshiftstudio/moonshiftstudio-site' },
    ],
  },
]

const STUDIO_LINKS: Link[] = [
  { label: 'Studio HQ', href: 'https://claude.ai/artifact/HXigudhZRypiGa6hHVfTvN' },
  { label: 'Testers list', href: 'https://supabase.com/dashboard/project/ynwabowujlalbztriqwj/editor' },
  { label: 'Privacy policy', href: 'https://moonshiftstudio.com/privacy' },
  { label: 'Vercel team', href: 'https://vercel.com/moonshiftstudio' },
]

const STATUS_COLOR: Record<string, string> = {
  Live: '#5BD69A',
  'Invite-only beta': '#FFB271',
  'In testing': '#A9BCFF',
  'In development': '#A9BCFF',
}

function newId(now: number) {
  return `${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

export const register: Register = on => {
  let cwd = ''

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    const saved = (await $.store.get(STORE_KEY)) as Todo[] | undefined
    if (Array.isArray(saved)) await update($, todos, () => saved)
    await $.command.register({ name: 'studio', description: 'Open the Moonshift Studio board: apps, links and to-dos' })
    await $.command.register({ name: 'todo', description: 'Add a to-do to the Moonshift Studio board', argumentHint: '<what to do>' })
    return next(e)
  })

  // The board as text, for where no panel can be drawn (the Claude app's chats).
  function boardText(list: Todo[]) {
    const here = APPS.find(app => app.match.test(cwd))
    const apps = APPS.map(app => {
      const links = app.links.map(l => `[${l.label}](${l.href})`).join(' · ')
      return `- **${app.name}**: ${app.status}${here === app ? " (you're here)" : ''}. ${links}${app.note ? `\n  ${app.note}` : ''}`
    }).join('\n')
    const studio = STUDIO_LINKS.map(l => `[${l.label}](${l.href})`).join(' · ')
    const open = list.filter(t => !t.isDone)
    const todo = open.length ? open.map(t => `- [ ] ${t.text}`).join('\n') : '- Nothing yet. Add one with /todo and what to do.'
    return `☾ **Moonshift Studio**\n\n${apps}\n\n**Studio:** ${studio}\n\n**To-do (${open.length} open)**\n${todo}`
  }

  on('command.run', { command: 'studio' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Moonshift Studio' })
    if (opened.isPlaced) return { text: 'Moonshift Studio board opened.' }
    return { text: boardText(await read($, todos)) }
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) {
      const opened = await $.ui.open({ id: PANE, title: 'Moonshift Studio' })
      if (!opened.isPlaced) return { text: 'Type /todo followed by the task, like: /todo Restore the Unbadged database' }
      await update($, isAdding, () => true)
      return { text: 'Type the to-do in the Moonshift Studio board.' }
    }
    const item: Todo = { id: newId(await $.clock.now()), text, isDone: false }
    const list = await update($, todos, l => [...l, item])
    await $.store.set(STORE_KEY, list)
    return { text: `Added to the studio to-do list: ${text}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Link } = table
    const Input = 'Input' in table ? table.Input : undefined
    const list = await read($, todos)
    const adding = await read($, isAdding)
    const width = e.props.bodyColumns ?? 60
    const here = APPS.find(app => app.match.test(cwd))

    async function setList(fn: (l: Todo[]) => Todo[]) {
      const next = await update($, todos, fn)
      await $.store.set(STORE_KEY, next)
    }

    const open = list.filter(t => !t.isDone)
    const done = list.filter(t => t.isDone)

    return (
      <Box flexDirection="column" gap={1} width={width}>
        <Text bold color={GOLD}>☾ MOONSHIFT STUDIO</Text>

        <Box flexDirection="column" gap={1}>
          {APPS.map(app => (
            <Box flexDirection="column">
              <Box gap={1} flexWrap="wrap">
                <Text bold color={app.color}>{app.name}</Text>
                <Text color={STATUS_COLOR[app.status] ?? 'subtle'}>● {app.status}</Text>
                {here === app && <Text color={GOLD}>← you're here</Text>}
              </Box>
              <Box gap={2} flexWrap="wrap">
                {app.links.map(link => (
                  <Link href={link.href} label={link.label} />
                ))}
              </Box>
              {app.note && <Text dimColor>{app.note}</Text>}
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold>Studio</Text>
          <Box gap={2} flexWrap="wrap">
            {STUDIO_LINKS.map(link => (
              <Link href={link.href} label={link.label} />
            ))}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Box gap={1}>
            <Text bold>To-do</Text>
            <Text dimColor>{open.length} open</Text>
          </Box>
          {list.length === 0 && <Text dimColor>Nothing yet. Add one below or type /todo and what to do.</Text>}
          {open.map(t => (
            <Button key={`t-${t.id}`} plain onPress={() => setList(l => l.map(x => (x.id === t.id ? { ...x, isDone: true } : x)))}>
              ☐ {t.text}
            </Button>
          ))}
          {done.map(t => (
            <Button key={`t-${t.id}`} plain onPress={() => setList(l => l.map(x => (x.id === t.id ? { ...x, isDone: false } : x)))}>
              <Text dimColor>☑ {t.text}</Text>
            </Button>
          ))}
          {adding && Input ? (
            <Input
              key="new-todo"
              placeholder="What needs doing?"
              submitLabel="add"
              autoFocus
              onSubmit={async (value: string) => {
                const text = value.trim()
                if (text) {
                  const item: Todo = { id: newId(await $.clock.now()), text, isDone: false }
                  await setList(l => [...l, item])
                }
                await update($, isAdding, () => false)
              }}
            />
          ) : (
            <Box gap={1}>
              {Input ? (
                <Button key="add" label="Add to-do" onPress={() => update($, isAdding, () => true)} />
              ) : (
                <Text dimColor>Add one with /todo</Text>
              )}
              {done.length > 0 && (
                <Button key="clear" label="Clear done" onPress={() => setList(l => l.filter(x => !x.isDone))} />
              )}
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
