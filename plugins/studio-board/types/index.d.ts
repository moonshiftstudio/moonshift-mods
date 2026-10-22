export type Todo = { id: string; text: string; isDone: boolean }

declare module 'claude-code' {
  interface PluginState {
    'studio-board': { todos: Todo[]; isAdding: boolean }
  }
}
