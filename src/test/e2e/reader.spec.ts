import { expect, test } from '@playwright/test'
import {
  clearPostedMessages,
  DEFAULT_SETTINGS,
  getCursorPos,
  getEditorContent,
  getPostedMessages,
  initEditor,
  sendMessage,
} from './utils'

const CONTENT =
  '# Title\n\nSome **bold** text.\n\n| A | B |\n| - | - |\n| 1 | 2 |'

test.describe('reader mode — entering and leaving', () => {
  test('setReaderMode(true) hides the editor and shows rendered HTML', async ({
    page,
  }) => {
    await initEditor(page, CONTENT)
    await sendMessage(page, { type: 'setReaderMode', enabled: true })

    await expect(page.locator('#reader h1')).toHaveText('Title')
    await expect(page.locator('#reader table')).toBeVisible()
    await expect(page.locator('#reader strong')).toHaveText('bold')
    await expect(page.locator('.cm-editor')).toBeHidden()
  })

  test('setReaderMode(false) restores the editor', async ({ page }) => {
    // No table here: the tableFormatter's 500ms auto-align would legitimately
    // rewrite one, and this test is about the flip being lossless.
    const content = '# Title\n\nSome **bold** text.'
    await initEditor(page, content)
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await sendMessage(page, { type: 'setReaderMode', enabled: false })

    await expect(page.locator('.cm-editor')).toBeVisible()
    await expect(page.locator('#reader')).toBeHidden()
    expect(await getEditorContent(page)).toBe(content)
  })

  test('double-click in the rendered view posts exitReaderMode', async ({
    page,
  }) => {
    await initEditor(page, CONTENT)
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await clearPostedMessages(page)

    await page.locator('#reader h1').dblclick()

    const messages = await getPostedMessages(page)
    expect(messages).toContainEqual({ type: 'exitReaderMode' })
  })
})

test.describe('reader mode — content updates while active', () => {
  test('init re-renders the reader without focusing the editor', async ({
    page,
  }) => {
    await initEditor(page, CONTENT)
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await sendMessage(page, {
      type: 'init',
      content: '# Replaced',
      pageId: 'page-1',
    })

    await expect(page.locator('#reader h1')).toHaveText('Replaced')
    await expect(page.locator('.cm-editor')).toBeHidden()
  })

  test('replaceContent re-renders the reader', async ({ page }) => {
    await initEditor(page, CONTENT)
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await sendMessage(page, {
      type: 'replaceContent',
      content: '# External edit',
    })

    await expect(page.locator('#reader h1')).toHaveText('External edit')
  })
})

test.describe('reader mode — typography', () => {
  test('rendered markdown uses the resolved font settings', async ({
    page,
  }) => {
    await initEditor(page, '# Title\n\nSome text.', {
      fontFamily: 'monospace',
      fontSize: '20px',
      lineHeight: 2,
    })
    await sendMessage(page, { type: 'setReaderMode', enabled: true })

    const style = await page.locator('#reader p').evaluate(el => {
      const computed = getComputedStyle(el)
      return {
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        lineHeight: computed.lineHeight,
      }
    })
    expect(style.fontFamily).toContain('monospace')
    expect(style.fontSize).toBe('20px')
    expect(style.lineHeight).toBe('40px')
  })

  test('a settings change while reading is picked up without a re-render', async ({
    page,
  }) => {
    await initEditor(page, '# Title\n\nSome text.')
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await sendMessage(page, {
      type: 'settings',
      ...DEFAULT_SETTINGS,
      fontSize: '24px',
    })

    await expect
      .poll(() =>
        page.locator('#reader p').evaluate(el => getComputedStyle(el).fontSize),
      )
      .toBe('24px')
  })
})

test.describe('reader mode — guards', () => {
  test('formatting commands are dropped while reading', async ({ page }) => {
    await initEditor(page, 'plain text')
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await sendMessage(page, { type: 'command', command: 'toggleBold' })
    await sendMessage(page, { type: 'setReaderMode', enabled: false })

    expect(await getEditorContent(page)).toBe('plain text')
  })

  test('link clicks post openLink instead of navigating', async ({ page }) => {
    await initEditor(page, '[docs](https://example.com/docs)')
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await clearPostedMessages(page)

    await page.locator('#reader a').click()

    const messages = await getPostedMessages(page)
    expect(messages).toContainEqual({
      type: 'openLink',
      url: 'https://example.com/docs',
    })
    expect(page.url()).toContain('harness.html')
  })

  test('setCursor messages are dropped while reading', async ({ page }) => {
    await initEditor(page, 'line one\nline two')
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await sendMessage(page, { type: 'setCursor', pos: 12 })
    await sendMessage(page, { type: 'setReaderMode', enabled: false })

    expect(await getCursorPos(page)).not.toBe(12)
  })

  test('double-clicking a link opens it once and stays in reader mode', async ({
    page,
  }) => {
    await initEditor(page, '[docs](https://example.com/docs)')
    await sendMessage(page, { type: 'setReaderMode', enabled: true })
    await clearPostedMessages(page)

    await page.locator('#reader a').dblclick()

    const messages = await getPostedMessages(page)
    expect(messages).not.toContainEqual({ type: 'exitReaderMode' })
    expect(
      messages.filter(message => message.type === 'openLink'),
    ).toHaveLength(1)
    await expect(page.locator('#reader')).toBeVisible()
  })

  test('task checkboxes render disabled', async ({ page }) => {
    await initEditor(page, '- [x] done\n- [ ] todo')
    await sendMessage(page, { type: 'setReaderMode', enabled: true })

    const boxes = page.locator('#reader input[type="checkbox"]')
    await expect(boxes).toHaveCount(2)
    await expect(boxes.first()).toBeDisabled()
    await expect(boxes.first()).toBeChecked()
    await expect(boxes.nth(1)).not.toBeChecked()
  })
})
