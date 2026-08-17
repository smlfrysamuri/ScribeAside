import { expect, type Page, test } from '@playwright/test'
import {
  DEFAULT_PAGE_ID,
  DEFAULT_SETTINGS,
  initEditor,
  openHarness,
  sendMessage,
} from './utils'

const LONG_NOTE = Array.from(
  { length: 200 },
  (_, i) => `line ${i + 1} of the note`,
).join('\n')

const LONG_READER_NOTE = Array.from(
  { length: 120 },
  (_, i) =>
    `## Section ${i + 1}\n\nA paragraph of prose under section ${i + 1}.`,
).join('\n\n')

interface ScrollProbe {
  scrollDOM: { getBoundingClientRect: () => { top: number } }
  documentTop: number
  lineBlockAtHeight: (height: number) => { from: number }
  state: { doc: { lineAt: (pos: number) => { number: number } } }
}

/** The line number showing at the top of the editor viewport. */
const topLine = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const view = (window as unknown as { __scribeasideView?: ScrollProbe })
      .__scribeasideView
    if (!view) return -1
    const top = view.scrollDOM.getBoundingClientRect().top
    const block = view.lineBlockAtHeight(top - view.documentTop)
    return view.state.doc.lineAt(block.from).number
  })

const scrollEditorTo = async (page: Page, top: number): Promise<void> => {
  await page
    .locator('.cm-scroller')
    .evaluate((el, y) => el.scrollTo({ top: y }), top)
}

const readerTop = (page: Page): Promise<number> =>
  page.locator('#reader').evaluate(el => el.scrollTop)

// The debounced save has landed once the persisted state exists — polling for
// it beats sleeping past the debounce and hoping.
const waitForSave = async (page: Page): Promise<void> => {
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('scribeaside.harnessState')),
    )
    .not.toBeNull()
}

/**
 * Reload the harness and replay what the host does on `ready`. Collapsing the
 * sidebar destroys the webview document exactly like this, so the note arrives
 * again in a brand new editor.
 */
const rebuildWebview = async (
  page: Page,
  content: string,
  pageId: string = DEFAULT_PAGE_ID,
  reader = false,
): Promise<void> => {
  await page.reload()
  await page.waitForSelector('.cm-editor')
  await sendMessage(page, { type: 'settings', ...DEFAULT_SETTINGS })
  if (reader) {
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
  }
  await sendMessage(page, { type: 'init', content, pageId })
}

test.describe('scroll persistence — editor', () => {
  test('a rebuilt webview comes back where the note was left', async ({
    page,
  }) => {
    await initEditor(page, LONG_NOTE)
    await scrollEditorTo(page, 900)
    await waitForSave(page)

    const before = await topLine(page)
    expect(before).toBeGreaterThan(1)

    await rebuildWebview(page, LONG_NOTE)
    await expect.poll(() => topLine(page)).toBe(before)
  })

  test('another note opens at its own top, not the previous one', async ({
    page,
  }) => {
    await initEditor(page, LONG_NOTE)
    await scrollEditorTo(page, 900)
    await waitForSave(page)
    const before = await topLine(page)

    await sendMessage(page, {
      type: 'init',
      content: LONG_NOTE,
      pageId: 'page-2',
    })
    await expect.poll(() => topLine(page)).toBe(1)

    // ...and the first note still remembers its own place.
    await sendMessage(page, {
      type: 'init',
      content: LONG_NOTE,
      pageId: DEFAULT_PAGE_ID,
    })
    await expect.poll(() => topLine(page)).toBe(before)
  })

  test('a note that was never scrolled opens at the top', async ({ page }) => {
    await initEditor(page, LONG_NOTE)
    await rebuildWebview(page, LONG_NOTE)
    await expect.poll(() => topLine(page)).toBe(1)
  })
})

test.describe('scroll persistence — reader mode', () => {
  test('a rebuilt webview comes back where the reader was left', async ({
    page,
  }) => {
    await initEditor(page, LONG_READER_NOTE)
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await page.locator('#reader').evaluate(el => el.scrollTo({ top: 700 }))
    await waitForSave(page)
    expect(await readerTop(page)).toBe(700)

    await rebuildWebview(page, LONG_READER_NOTE, DEFAULT_PAGE_ID, true)
    await expect.poll(() => readerTop(page)).toBe(700)
  })

  // innerHTML wipes the scroll offset, so a re-render caused by someone else
  // editing the file would otherwise yank the reader back to the top.
  test('a re-render from a peer edit keeps the reader in place', async ({
    page,
  }) => {
    await initEditor(page, LONG_READER_NOTE)
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await page.locator('#reader').evaluate(el => el.scrollTo({ top: 500 }))

    await sendMessage(page, {
      type: 'replaceContent',
      content: `${LONG_READER_NOTE}\n\nAdded by a peer.`,
    })
    await expect(page.locator('#reader')).toContainText('Added by a peer')
    expect(await readerTop(page)).toBe(500)
  })

  test('leaving and re-entering reader mode returns to the same place', async ({
    page,
  }) => {
    await initEditor(page, LONG_READER_NOTE)
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await page.locator('#reader').evaluate(el => el.scrollTo({ top: 450 }))
    await waitForSave(page)

    await sendMessage(page, { type: 'setReaderMode', enabled: false })
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await expect.poll(() => readerTop(page)).toBe(450)
  })
})

test.describe('scroll persistence — edge cases', () => {
  // Nothing has told this webview which note it is showing, so there is no key
  // to save under; it must not throw, and must not restore into whatever note
  // arrives first.
  test('survives a scroll before any note has been sent', async ({ page }) => {
    await openHarness(page)
    await sendMessage(page, { type: 'settings', ...DEFAULT_SETTINGS })
    await scrollEditorTo(page, 400)
    await sendMessage(page, {
      type: 'init',
      content: LONG_NOTE,
      pageId: DEFAULT_PAGE_ID,
    })
    await expect.poll(() => topLine(page)).toBe(1)
  })

  test('ignores persisted state that is not usable', async ({ page }) => {
    await page.goto('/src/test/e2e/harness.html')
    await page.evaluate(() => {
      sessionStorage.setItem(
        'scribeaside.harnessState',
        JSON.stringify({ scroll: 'not an array' }),
      )
    })
    await rebuildWebview(page, LONG_NOTE)
    await expect.poll(() => topLine(page)).toBe(1)
  })
})
