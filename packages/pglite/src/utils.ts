/**
 * Debounce a function to ensure that only one instance of the function is running at
 * a time.
 * - If the function is called while an instance is already running, the new
 * call is scheduled to run after the current instance completes.
 * - If there is already a scheduled call, it is replaced with the new call.
 * @param fn - The function to debounce
 * @returns A debounced version of the function
 */
export function debounceMutex<A extends any[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | void> {
  let next:
    | {
        args: A
        resolve: (value: R | void) => void
        reject: (reason?: any) => void
      }
    | undefined = undefined

  let isRunning = false
  const processNext = async () => {
    if (!next) {
      isRunning = false
      return
    }
    isRunning = true
    const { args, resolve, reject } = next
    next = undefined
    try {
      const ret = await fn(...args)
      resolve(ret)
    } catch (e) {
      reject(e)
    } finally {
      processNext()
    }
  }
  return async (...args: A) => {
    if (next) {
      next.resolve(undefined)
    }
    const promise = new Promise<R | void>((resolve, reject) => {
      next = { args, resolve, reject }
    })
    if (!isRunning) {
      processNext()
    }
    return promise
  }
}
