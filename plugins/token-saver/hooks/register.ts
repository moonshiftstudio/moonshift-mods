import type { Register } from 'claude-code'

// Token Saver: three ways to spend fewer tokens for the same work.
//   1. Helper agents that only search or read run on a cheaper model.
//   2. Browser screenshots come back smaller.
//   3. /handoff writes a note that moves a long chat to a fresh one, and a
//      nudge says when a chat has grown long enough to be worth it.
// /saver shows what each part did and switches it on or off.

type Settings = {
  /** Route helper agents to a cheaper model. */
  agents: boolean
  /** Shrink browser screenshots. */
  shots: boolean
  /** Say when a chat is long enough for /handoff. */
  nudge: boolean
  /** How much of a screenshot's width and height to keep, 0.3 to 1. */
  scale: number
}
type Counts = { routed: number; shrunk: number; handoffs: number }

const DEFAULTS: Settings = { agents: true, shots: true, nudge: true, scale: 0.6 }
const ZERO: Counts = { routed: 0, shrunk: 0, handoffs: 0 }

// Which model a built-in helper gets when the call names none. Anything not
// listed (Plan, a plugin's or your own agent) keeps the model it would have had.
const ROUTES: Record<string, 'haiku' | 'sonnet'> = {
  Explore: 'haiku',
  'claude-code-guide': 'haiku',
  'statusline-setup': 'haiku',
  'general-purpose': 'sonnet',
  claude: 'sonnet',
}

/** Bigger is more capable (and costs more). */
const rank = (model: string): number =>
  /haiku/i.test(model) ? 0 : /sonnet/i.test(model) ? 1 : 2

const BROWSER_TOOL = /^mcp__(.+__)?(Claude_Browser|claude-in-chrome)__(computer|browser_batch)$/

// Past this many tokens every new message re-sends a lot of history.
const NUDGE_AT = 150_000
const NUDGE_EVERY = 75_000

const HANDOFF_PROMPT = `This conversation is about to be handed off to a fresh chat that has none of this history. You have no tools here: answer straight away, without thinking it over.

Write the handoff note in Markdown, under 500 words, starting with exactly this line:
Handoff from an earlier chat. Read this, then carry on with the next steps.

Then these sections, each a short list:
## Goal
## Done so far
## Where things stand (exact file paths, folders, branches, links and names)
## Decisions and preferences to keep
## Next steps (in order)
## Open questions

Be specific: someone who never saw this chat must be able to continue from the note alone. Never include keys, passwords or other secrets.`

type Loose = Record<string, unknown>
const isRecord = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const onOff = (flag: boolean): string => (flag ? 'on' : 'off')

export const register: Register = on => {
  let settings: Settings = { ...DEFAULTS }
  let total: Counts = { ...ZERO }
  const here: Counts = { ...ZERO }
  let lastNudge = 0

  const bump = (key: keyof Counts): void => {
    here[key] += 1
    total = { ...total, [key]: total[key] + 1 }
  }

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('settings').catch(() => undefined)
    if (isRecord(saved)) {
      settings = {
        agents: saved.agents !== false,
        shots: saved.shots !== false,
        nudge: saved.nudge !== false,
        scale:
          typeof saved.scale === 'number' && saved.scale >= 0.3 && saved.scale <= 1
            ? saved.scale
            : DEFAULTS.scale,
      }
    }
    const sums = await $.store.get('totals').catch(() => undefined)
    if (isRecord(sums)) {
      total = {
        routed: Number(sums.routed) || 0,
        shrunk: Number(sums.shrunk) || 0,
        handoffs: Number(sums.handoffs) || 0,
      }
    }
    await $.command.register({
      name: 'saver',
      description: 'Token Saver: show what it saved, or switch a part on or off',
      argumentHint: '[agents|screenshots|nudge] [on|off]',
    })
    await $.command.register({
      name: 'handoff',
      description: 'Write a note that moves this chat to a fresh one',
      argumentHint: '[what to focus on]',
    })

    return next(e)
  })

  // 1. Helper agents on the right model -------------------------------------

  on('agent.spawn', async ($, e, next) => {
    const extra = e as unknown as Loose
    const pick = ROUTES[e.subagentType]
    const isOurs =
      settings.agents &&
      pick !== undefined &&
      !e.model && // the call chose a model itself: respect it
      !e.fork && // a fork always runs on its parent's model
      !e.isTeammate &&
      !e.workflow &&
      !extra.resume &&
      e.provider.plugin === 'engine' &&
      rank(pick) < rank(e.parentModel) // never an upgrade
    if (!isOurs) return next(e)

    const started = await next({ ...e, model: pick })
    if (!started.deny) {
      bump('routed')
      await $.store.set('totals', total).catch(() => undefined)
    }

    return started
  }).catch(($, e, next) => next(e))

  // 2. Smaller browser screenshots ------------------------------------------

  const shrink = (input: Loose): Loose | undefined =>
    input.action === 'screenshot' && input.scale === undefined
      ? { ...input, scale: settings.scale }
      : undefined

  on('tool.call', async ($, e, next) => {
    if (!settings.shots || settings.scale >= 1 || !BROWSER_TOOL.test(e.tool)) return next(e)
    const input = e as unknown as Loose

    if (e.tool.endsWith('__computer')) {
      const smaller = shrink(input)
      if (!smaller) return next(e)
      bump('shrunk')
      await $.store.set('totals', total).catch(() => undefined)

      return next(smaller as unknown as typeof e)
    }

    if (!Array.isArray(input.actions)) return next(e)
    let changed = 0
    const actions = input.actions.map((step: unknown) => {
      if (!isRecord(step) || !isRecord(step.input)) return step
      if (!String(step.name).endsWith('computer')) return step
      const smaller = shrink(step.input)
      if (!smaller) return step
      changed += 1

      return { ...step, input: smaller }
    })
    if (changed === 0) return next(e)
    for (let i = 0; i < changed; i += 1) bump('shrunk')
    await $.store.set('totals', total).catch(() => undefined)

    return next({ ...input, actions } as unknown as typeof e)
  }).catch(($, e, next) => next(e))

  // 3. Handoff to a fresh chat ----------------------------------------------

  on('turn.complete', async ($, e, next) => {
    if (settings.nudge && !e.agentId) {
      try {
        const { context } = await $.session.usage()
        const tokens = context.tokens ?? 0
        if (tokens < lastNudge) lastNudge = 0 // the chat was cleared or compacted
        if (tokens >= NUDGE_AT && tokens - lastNudge >= NUDGE_EVERY) {
          lastNudge = tokens
          $.ui.toast(
            `This chat now re-sends about ${Math.round(tokens / 1000)}k tokens with every message. Type /handoff to carry on in a fresh chat for less.`,
            { timeoutMs: 12000 },
          )
        }
      } catch {
        // No usage reading: say nothing.
      }
    }

    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const focus = e.args.trim()
    const reply = await $.model.fork({
      prompt: focus ? `${HANDOFF_PROMPT}\n\nPay special attention to: ${focus}` : HANDOFF_PROMPT,
    })
    if (!reply.isAnswered) {
      return {
        text:
          reply.reason === 'nothing-to-fork'
            ? 'Nothing to hand off yet: this chat has no finished turn. Send a message first, then try /handoff again.'
            : `The handoff note could not be written (${reply.reason}). Try /handoff again in a moment.`,
      }
    }
    const note = reply.text.trim()
    bump('handoffs')
    await $.store.set('totals', total).catch(() => undefined)

    let saved = ''
    try {
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
      if (home) {
        const stamp = new Date(await $.clock.now()).toISOString().slice(0, 16).replace(/[T:]/g, '-')
        const path = `${home}/.claude/handoffs/handoff-${stamp}.md`.replace(/\\/g, '/')
        await $.fs.write(path, `${note}\n`)
        saved = `\n\nA copy is saved at \`${path}\`.`
      }
    } catch {
      // The note is still shown below; only the saved copy is missing.
    }
    const copied = await $.ui.copy({ text: note }).catch(() => ({ isCopied: false }))

    return {
      text: `**Handoff note ready.** Start a new chat and ${
        copied.isCopied ? 'paste (it is already copied)' : 'paste the note below'
      } as your first message.${saved}\n\n---\n\n${note}`,
    }
  })

  // /saver -------------------------------------------------------------------

  const status = (): string =>
    [
      '**Token Saver**',
      '',
      `- **Helper agents on a cheaper model:** ${onOff(settings.agents)}. Routed ${here.routed} this chat, ${total.routed} in all. Search helpers run on Haiku and general helpers on Sonnet, unless the call names a model.`,
      `- **Smaller browser screenshots:** ${onOff(settings.shots)}, kept at ${Math.round(settings.scale * 100)}% size (about ${Math.round(settings.scale * settings.scale * 100)}% of the tokens). Shrunk ${here.shrunk} this chat, ${total.shrunk} in all.`,
      `- **Long-chat nudge:** ${onOff(settings.nudge)}. Handoff notes written: ${here.handoffs} this chat, ${total.handoffs} in all. Type /handoff to write one.`,
      '',
      'Switch a part with `/saver agents off`, `/saver screenshots off` or `/saver nudge off` (and `on` to bring it back). `/saver screenshots 50` sets the size in percent.',
    ].join('\n')

  on('command.run', { command: 'saver' }, async ($, e) => {
    const [part = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (!part) return { text: status() }

    const key: keyof Settings | undefined = part.startsWith('agent')
      ? 'agents'
      : part.startsWith('screen') || part.startsWith('shot')
        ? 'shots'
        : part.startsWith('nudge') || part.startsWith('handoff')
          ? 'nudge'
          : undefined
    const size = Number(value.replace('%', ''))
    if (key === 'shots' && Number.isFinite(size) && value !== '') {
      if (size < 30 || size > 100) return { text: 'Pick a screenshot size from 30 to 100 (percent).' }
      settings = { ...settings, shots: true, scale: size / 100 }
    } else if (key && (value === 'on' || value === 'off')) {
      settings = { ...settings, [key]: value === 'on' }
    } else {
      return {
        text: 'Type `/saver` to see the status, or `/saver agents off`, `/saver screenshots off`, `/saver nudge off` (use `on` to bring a part back).',
      }
    }
    await $.store.set('settings', settings)

    return { text: status() }
  })
}
