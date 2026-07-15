type Handler<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private listeners = new Map<keyof Events, Set<Handler<unknown>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set<Handler<unknown>>();
    set.add(handler as Handler<unknown>);
    this.listeners.set(event, set);
    return () => set.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners.get(event)?.forEach((handler) => handler(payload));
  }

  clear(): void {
    this.listeners.clear();
  }
}
