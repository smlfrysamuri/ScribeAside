import { expect, test } from '@playwright/test'
import { focusEditor, initEditor } from './utils'

// Perf budget: typing a single character into a large document must round-trip
// through CodeMirror dispatch + decoration rebuild in under BUDGET_MS on CI
// hardware. A regression (e.g. O(n²) scan in decorations) will blow this.
//
// Measured on local dev machines the current build lands around 5–15ms. We
// leave generous headroom so the test is reliable in CI rather than flaky.
const BUDGET_MS = 50
// A cursor move in hidden mode skips the tree walk and only re-materializes
// the cached scan, so it gets its own, tighter budget. The two hidden-mode
// tests below time the synchronous dispatch alone; the default-mode test above
// keeps its original rAF-inclusive measurement so it stays a stable control.
const CURSOR_BUDGET_MS = 25
const DOC_LINES = 5000

const buildLargeDoc = (lines: number): string => {
  // Mix of plain text, headings, lists, and a fenced code block so the
  // decoration builder exercises every branch (not just trivial prose).
  const chunks: string[] = []
  for (let i = 0; i < lines; i++) {
    const mod = i % 20
    if (mod === 0) chunks.push(`## Section ${i / 20}`)
    else if (mod === 5) chunks.push(`- bullet with **bold** and *italic* ${i}`)
    else if (mod === 10) chunks.push(`1. ordered item ${i}`)
    else if (mod === 15) chunks.push(`> quote line ${i}`)
    else chunks.push(`plain line ${i} with [a link](./foo.md) and ==mark==`)
  }
  return chunks.join('\n')
}

test.describe('perf', () => {
  test(`single-keystroke dispatch stays under ${BUDGET_MS}ms on a ${DOC_LINES}-line doc`, async ({
    page,
  }) => {
    await initEditor(page, buildLargeDoc(DOC_LINES))
    await focusEditor(page)

    // Move caret to end of doc so the insert happens in a fully-decorated region
    await page.evaluate(() => {
      const view = (
        window as unknown as {
          __mdpadView?: {
            state: { doc: { length: number } }
            dispatch: (spec: unknown) => void
          }
        }
      ).__mdpadView
      if (!view) throw new Error('editor not ready')
      view.dispatch({
        selection: {
          anchor: view.state.doc.length,
          head: view.state.doc.length,
        },
      })
    })

    // Warm up: first dispatch can include JIT / lazy-init costs we don't want
    // to count. Measure the steady-state cost.
    const warmupRuns = 3
    const sampleRuns = 10

    const timings: number[] = await page.evaluate(
      async ({ warmup, samples }) => {
        const view = (
          window as unknown as {
            __mdpadView?: {
              state: { doc: { length: number } }
              dispatch: (spec: unknown) => void
              requestMeasure: (spec?: unknown) => void
            }
          }
        ).__mdpadView
        if (!view) throw new Error('editor not ready')

        const oneRun = async (): Promise<number> => {
          const start = performance.now()
          const pos = view.state.doc.length
          view.dispatch({
            changes: { from: pos, to: pos, insert: 'x' },
            selection: { anchor: pos + 1, head: pos + 1 },
          })
          // Wait for CodeMirror to flush layout / decoration measure phase
          await new Promise<void>(resolve => {
            view.requestMeasure({ read: () => resolve() })
          })
          return performance.now() - start
        }

        for (let i = 0; i < warmup; i++) await oneRun()

        const out: number[] = []
        for (let i = 0; i < samples; i++) out.push(await oneRun())
        return out
      },
      { warmup: warmupRuns, samples: sampleRuns },
    )

    // Median is more resilient than mean against one-off GC spikes.
    const sorted = [...timings].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const max = sorted[sorted.length - 1]

    console.log(
      `perf: median=${median.toFixed(2)}ms max=${max.toFixed(2)}ms samples=${timings.map(t => t.toFixed(1)).join(',')}`,
    )

    expect(median, 'median keystroke dispatch time').toBeLessThan(BUDGET_MS)
  })

  // Hidden mode adds a selection-driven rebuild. The keystroke path still
  // re-scans the tree (so it should land close to the muted number); the
  // cursor-move path only re-materializes the cached scan, so it should land
  // well below it. Both share the same budget.
  test(`hidden-mode keystroke stays under ${BUDGET_MS}ms on a ${DOC_LINES}-line doc`, async ({
    page,
  }) => {
    await initEditor(page, buildLargeDoc(DOC_LINES), { syntaxMode: 'hidden' })
    await focusEditor(page)

    const timings: number[] = await page.evaluate(
      async ({ warmup, samples }) => {
        const view = (
          window as unknown as {
            __mdpadView?: {
              state: { doc: { length: number } }
              dispatch: (spec: unknown) => void
              requestMeasure: (spec?: unknown) => void
            }
          }
        ).__mdpadView
        if (!view) throw new Error('editor not ready')

        // Times the synchronous dispatch only. `requestMeasure` resolves on
        // the next animation frame, so including it would put a ~16.7ms floor
        // under every sample and measure the scheduler instead of the
        // decoration rebuild. The await still runs, after the clock stops, so
        // the editor is settled before the next sample.
        const oneRun = async (): Promise<number> => {
          const pos = view.state.doc.length
          const start = performance.now()
          view.dispatch({
            changes: { from: pos, to: pos, insert: 'x' },
            selection: { anchor: pos + 1, head: pos + 1 },
          })
          const elapsed = performance.now() - start
          await new Promise<void>(resolve => {
            view.requestMeasure({ read: () => resolve() })
          })
          return elapsed
        }

        for (let i = 0; i < warmup; i++) await oneRun()
        const out: number[] = []
        for (let i = 0; i < samples; i++) out.push(await oneRun())
        return out
      },
      { warmup: 3, samples: 10 },
    )

    const sorted = [...timings].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    console.log(
      `perf(hidden keystroke): median=${median.toFixed(2)}ms max=${sorted[sorted.length - 1].toFixed(2)}ms`,
    )
    expect(median, 'median hidden-mode keystroke time').toBeLessThan(BUDGET_MS)
  })

  test(`hidden-mode cursor move stays under ${CURSOR_BUDGET_MS}ms on a ${DOC_LINES}-line doc`, async ({
    page,
  }) => {
    await initEditor(page, buildLargeDoc(DOC_LINES), { syntaxMode: 'hidden' })
    await focusEditor(page)

    const timings: number[] = await page.evaluate(
      async ({ warmup, samples }) => {
        const view = (
          window as unknown as {
            __mdpadView?: {
              state: {
                doc: { line: (n: number) => { from: number } }
                selection: { main: { head: number } }
              }
              dispatch: (spec: unknown) => void
              requestMeasure: (spec?: unknown) => void
            }
          }
        ).__mdpadView
        if (!view) throw new Error('editor not ready')

        let lineNum = 1
        const oneRun = async (): Promise<number> => {
          lineNum = (lineNum % 40) + 1
          const anchor = view.state.doc.line(lineNum).from
          const start = performance.now()
          view.dispatch({ selection: { anchor, head: anchor } })
          const elapsed = performance.now() - start
          await new Promise<void>(resolve => {
            view.requestMeasure({ read: () => resolve() })
          })
          return elapsed
        }

        for (let i = 0; i < warmup; i++) await oneRun()
        const out: number[] = []
        for (let i = 0; i < samples; i++) out.push(await oneRun())
        return out
      },
      { warmup: 3, samples: 10 },
    )

    const sorted = [...timings].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    console.log(
      `perf(hidden cursor move): median=${median.toFixed(2)}ms max=${sorted[sorted.length - 1].toFixed(2)}ms`,
    )
    expect(median, 'median hidden-mode cursor move time').toBeLessThan(
      CURSOR_BUDGET_MS,
    )
  })
})
