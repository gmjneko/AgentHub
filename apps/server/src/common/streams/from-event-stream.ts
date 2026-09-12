import { Observable } from 'rxjs'

/** Ask the iterator to release pending reads immediately when the SSE client disconnects. */
export function fromEventStream<T>(stream: AsyncIterable<T>): Observable<T> {
    return new Observable((subscriber) => {
        const iterator = stream[Symbol.asyncIterator]()
        void (async () => {
            try {
                while (!subscriber.closed) {
                    const result = await iterator.next()
                    if (subscriber.closed) return
                    if (result.done) {
                        subscriber.complete()
                        return
                    }
                    subscriber.next(result.value)
                }
            } catch (error) {
                subscriber.error(error)
            }
        })()
        return () => {
            void iterator.return?.().catch(() => undefined)
        }
    })
}
