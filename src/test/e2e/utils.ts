import type { Page } from '@playwright/test'

export interface ScribeAsideSettings {
  fontFamily: string
  fontSize: string
  lineHeight: number
  listIndentSize: number
  lineNumbers: boolean
  lineWrapping: boolean
  folding: boolean
  syntaxMode: 'muted' | 'hidden'
}

export const DEFAULT_SETTINGS: ScribeAsideSettings = {
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 1.6,
  listIndentSize: 2,
  lineNumbers: false,
  lineWrapping: true,
  folding: false,
  syntaxMode: 'muted',
}

export const openHarness = async (page: Page): Promise<void> => {
  await page.goto('/src/test/e2e/harness.html')
  await page.waitForSelector('.cm-editor')
}

export const sendMessage = async (
  page: Page,
  message: Record<string, unknown>,
): Promise<void> => {
  await page.evaluate(msg => {
    window.dispatchEvent(new MessageEvent('message', { data: msg }))
  }, message)
}

export const initEditor = async (
  page: Page,
  content: string,
  settings: Partial<ScribeAsideSettings> = {},
): Promise<void> => {
  await openHarness(page)
  await sendMessage(page, {
    type: 'settings',
    ...DEFAULT_SETTINGS,
    ...settings,
  })
  await sendMessage(page, { type: 'init', content })
  await page
    .waitForFunction(
      expected => {
        const c = document.querySelector('.cm-content')?.textContent ?? ''
        return c.includes(expected.slice(0, 20))
      },
      content || 'a',
      { timeout: 2000 },
    )
    .catch(() => {})
}

export const getPostedMessages = async (
  page: Page,
): Promise<Record<string, unknown>[]> => {
  return page.evaluate(
    () =>
      (window as unknown as { __postedMessages: Record<string, unknown>[] })
        .__postedMessages,
  )
}

export const clearPostedMessages = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    ;(window as unknown as { __postedMessages: unknown[] }).__postedMessages =
      []
  })
}

export const getCursorPos = async (page: Page): Promise<number> => {
  return page.evaluate(() => {
    const view = (
      window as unknown as {
        __scribeasideView?: { state: { selection: { main: { head: number } } } }
      }
    ).__scribeasideView
    return view?.state.selection.main.head ?? -1
  })
}

export const getEditorContent = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    const view = (
      window as unknown as {
        __scribeasideView?: { state: { doc: { toString: () => string } } }
      }
    ).__scribeasideView
    return view?.state.doc.toString() ?? ''
  })
}

export const focusEditor = async (page: Page): Promise<void> => {
  await page.locator('.cm-content').click()
}
