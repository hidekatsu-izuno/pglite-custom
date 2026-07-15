import { describe, expect, it } from 'vitest'
import { InitdbModFactory, type InitdbMod } from '../src/initdbModFactory.js'
import { createMemoryViewManager } from '../src/emscriptenRuntime.js'

describe('shared Emscripten runtime', () => {
  it('keeps a stable memory context when WebAssembly memory grows', () => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 })
    const views = createMemoryViewManager(memory)
    const initialHeap = views.HEAPU8

    memory.grow(1)

    expect(views.refresh()).toBe(views)
    expect(Object.is(views.HEAPU8, initialHeap)).toBe(false)
    expect(views.HEAPU8.byteLength).toBe(2 * 64 * 1024)
  })

  it('preserves module identity and lifecycle callback ordering', async () => {
    const events: string[] = []
    const options: Partial<InitdbMod> = {
      noExitRuntime: true,
      preInit: [
        () => events.push('preInit:first'),
        () => events.push('preInit:second'),
      ],
      preRun: [
        () => events.push('preRun:first'),
        () => events.push('preRun:second'),
      ],
      postRun: [
        () => events.push('postRun:first'),
        () => events.push('postRun:second'),
      ],
    }

    const module = await InitdbModFactory(options)

    expect(module).toBe(options)
    expect(events).toEqual([
      'preInit:second',
      'preInit:first',
      'preRun:second',
      'preRun:first',
      'postRun:second',
      'postRun:first',
    ])
  })
})
