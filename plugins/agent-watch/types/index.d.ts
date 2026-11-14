export type AgentState = 'working' | 'waiting' | 'done' | 'failed' | 'stopped'

export type AgentRow = {
  /** The agent's id; `main` for the main conversation. */
  id: string
  /** The few words the task was given ("Search the scanner code"). */
  title: string
  /** The agent type (`Explore`, `general-purpose`, `main`). */
  kind: string
  /** The model it runs on, when known. */
  model?: string
  state: AgentState
  /** What it is doing right now, in plain words. */
  now: string
  startedAt: number
  endedAt?: number
  /** How many tool calls it has made. */
  calls: number
  /** Steps finished and steps in all, when the agent keeps a task list. */
  planDone?: number
  planTotal?: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-watch': { rows: Shaped<AgentRow[]>; tick: number }
  }
}
