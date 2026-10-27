export type EventHandler<Events, K extends keyof Events> = (header: EventHeader, payload: Events[K]) => void

export type EventHeader = {
    eventId: string | number | symbol
    listenerId: number,
    /** Unix Timestamp in milliseconds. */
    timestamp: number,
}

export interface EventBusListener {
    remove: () => void
    removeOnce: () => void
}

export class EventBus<TEvents> {
    private handlers: Map<number, { callback: (header: EventHeader, payload: any) => void, once: boolean }>
    private listeners: Map<keyof TEvents, Set<number>>
    private nextId = 0

    constructor() {
        this.handlers = new Map()
        this.listeners = new Map()
    }

    public on<K extends keyof TEvents>(
        event: K,
        handler: EventHandler<TEvents, K>,
        once?: boolean
    ): EventBusListener {
        let id = this.generateId()

        this.handlers.set(id, { callback: handler, once: once ? true : false })
        if (this.listeners.has(event)) {
            this.listeners.get(event)?.add(id)
        } else {
            this.listeners.set(event, new Set([id]))
        }

        return {
            remove: () => this.remove(event, id),
            removeOnce: () => {
                let handler = this.handlers.get(id)
                if (handler) {
                    handler.once = true
                } else {
                    console.warn(`Attempted to modify a non-existent event listener with id '${id}' on event '${String(event)}'.`)
                }
            }
        }
    }

    public await<K extends keyof TEvents>(
        event: K
    ): Promise<Parameters<EventHandler<TEvents, K>>[0]> {
        return new Promise((resolve) => {
            this.on(event, (ev) => { resolve(ev) }, true)
        })
    }

    public emit<T extends keyof TEvents>(
        event: T,
        ...args: TEvents[T] extends void ? [] : [payload: TEvents[T]]
    ): void {
        // console.log(event, args)
        const payload = args[0] as TEvents[T];
        const timestamp = Date.now()
        this.listeners.get(event)?.forEach(id => {
            let { callback, once } = this.handlers.get(id)!
            callback({
                    eventId: event,
                    listenerId: id,
                    timestamp
                },
                payload
            )

            if (once) {
                this.remove(event, id)
            }
        })
    }

    private remove(event: keyof TEvents, id: number) {
        const warn = () => console.warn(`Attempted to remove a non-existent event listener with id '${id}' on event '${String(event)}'.`);
        if (!this.handlers.delete(id)) {
            warn()
            return
        }
        let set = this.listeners.get(event)
        if (!set) {
            warn()
            return
        }
        if (!set.delete(id)) {
            warn()
            return
        }
        if (set.size === 0) {
            this.listeners.delete(event)
        }
    }

    private generateId(): number {
        return this.nextId++
    }
}
