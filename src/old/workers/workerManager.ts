/** Post a message to a Worker and return the response as a Promise.
 *  Supports cancellation via AbortSignal. */
export function runInWorker<I, O>(worker: Worker, input: I, signal?: AbortSignal): Promise<O> {
  return new Promise<O>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }

    const onMessage = (e: MessageEvent<O>) => { cleanup(); resolve(e.data) }
    const onError = (e: ErrorEvent) => { cleanup(); reject(new Error(e.message)) }
    const onAbort = () => { cleanup(); worker.terminate(); reject(new DOMException('Aborted', 'AbortError')) }

    function cleanup() {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    signal?.addEventListener('abort', onAbort)
    worker.postMessage(input)
  })
}
