import { expect, test } from '@playwright/test'
import {
  clearPostedMessages,
  focusEditor,
  getCursorPos,
  getEditorContent,
  getPostedMessages,
  initEditor,
  openHarness,
  sendMessage,
} from './utils'

test.describe('messaging', () => {
  test('posts ready message on load', async ({ page }) => {
    await openHarness(page)
    await page.waitForTimeout(200)
    const posted = await getPostedMessages(page)
    expect(posted.some(m => m.type === 'ready')).toBe(true)
  })

  test('init message sets content', async ({ page }) => {
    await initEditor(page, 'hello world')
    const content = await page.locator('.cm-content').textContent()
    expect(content).toContain('hello world')
  })

  test('setCursor message moves cursor', async ({ page }) => {
    await initEditor(page, 'hello world')
    await sendMessage(page, { type: 'setCursor', pos: 5 })
    await page.waitForTimeout(100)
    const pos = await getCursorPos(page)
    expect(pos).toBe(5)
  })

  // `replaceContent` carries an edit someone else made to the underlying file.
  // It must update the document without pulling the caret into scribeaside, which is
  // the one thing that separates it from `init`.
  test.describe('replaceContent', () => {
    // Counts calls to EditorView.focus() rather than reading .cm-focused: the
    // invariant is "this handler must not ask for focus", and browser focus
    // state is noisy enough in a headless page to hide that.
    const spyOnFocus = (page: import('@playwright/test').Page) =>
      page.evaluate(() => {
        const w = window as unknown as {
          __scribeasideView: { focus: () => void }
          __focusCalls: number
        }
        w.__focusCalls = 0
        const original = w.__scribeasideView.focus.bind(w.__scribeasideView)
        w.__scribeasideView.focus = () => {
          w.__focusCalls++
          original()
        }
      })

    const focusCalls = (page: import('@playwright/test').Page) =>
      page.evaluate(
        () => (window as unknown as { __focusCalls: number }).__focusCalls,
      )

    test('replaces the document', async ({ page }) => {
      await initEditor(page, 'original text')
      await sendMessage(page, {
        type: 'replaceContent',
        content: 'replaced text',
      })
      await expect.poll(() => getEditorContent(page)).toBe('replaced text')
    })

    test('does not ask for focus, while init does', async ({ page }) => {
      await initEditor(page, 'original text')
      await spyOnFocus(page)

      await sendMessage(page, {
        type: 'replaceContent',
        content: 'from a peer',
      })
      await expect.poll(() => getEditorContent(page)).toBe('from a peer')
      expect(await focusCalls(page)).toBe(0)

      // Control: the pre-existing init path still takes focus.
      await sendMessage(page, {
        type: 'init',
        content: 'from the user',
        pageId: 'page-1',
      })
      await expect.poll(() => getEditorContent(page)).toBe('from the user')
      expect(await focusCalls(page)).toBe(1)
    })

    // A remote update must never destroy keystrokes the host has not seen.
    // Those are unrecoverable; the remote change is still in the file and in
    // git, and the local edit wins a moment later by last-writer-wins anyway.
    test('is ignored while the webview holds unsent local edits', async ({
      page,
    }) => {
      await initEditor(page, 'base')
      await focusEditor(page)
      await page.keyboard.press('End')
      await page.keyboard.type('!')

      await sendMessage(page, {
        type: 'replaceContent',
        content: 'from a peer',
      })
      await page.waitForTimeout(100)
      expect(await getEditorContent(page)).toBe('base!')

      // Once the edit has been posted, the webview accepts remote content again.
      await page.waitForTimeout(700)
      await sendMessage(page, {
        type: 'replaceContent',
        content: 'from a peer',
      })
      await expect.poll(() => getEditorContent(page)).toBe('from a peer')
    })

    test('clamps a cursor that sat past the new end', async ({ page }) => {
      await initEditor(page, 'hello world')
      await sendMessage(page, { type: 'setCursor', pos: 11 })
      await expect.poll(() => getCursorPos(page)).toBe(11)

      await sendMessage(page, { type: 'replaceContent', content: 'hi' })
      await expect.poll(() => getEditorContent(page)).toBe('hi')
      expect(await getCursorPos(page)).toBeLessThanOrEqual(2)
    })
  })

  test('typing triggers updateContent after debounce', async ({ page }) => {
    await initEditor(page, '')
    await focusEditor(page)
    await clearPostedMessages(page)
    await page.keyboard.type('hello')
    await page.waitForTimeout(700)
    const posted = await getPostedMessages(page)
    const updates = posted.filter(m => m.type === 'updateContent')
    expect(updates.length).toBeGreaterThan(0)
    expect(updates[updates.length - 1].content).toBe('hello')
  })
})
