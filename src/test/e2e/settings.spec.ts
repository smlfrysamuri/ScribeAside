import { expect, test } from '@playwright/test'
import {
  DEFAULT_SETTINGS,
  focusEditor,
  getEditorContent,
  initEditor,
  sendMessage,
} from './utils'

test.describe('settings — applied on init', () => {
  test('font family is applied from settings', async ({ page }) => {
    await initEditor(page, 'text', { fontFamily: 'monospace' })
    const fontFamily = await page
      .locator('.cm-content')
      .evaluate(el => getComputedStyle(el).fontFamily)
    expect(fontFamily).toContain('monospace')
  })

  test('font size is applied from settings', async ({ page }) => {
    await initEditor(page, 'text', { fontSize: '22px' })
    const fontSize = await page
      .locator('.cm-content')
      .evaluate(el => getComputedStyle(el).fontSize)
    expect(fontSize).toBe('22px')
  })

  test('line height is applied from settings', async ({ page }) => {
    await initEditor(page, 'text', { fontSize: '20px', lineHeight: 2 })
    const lineHeight = await page
      .locator('.cm-content')
      .evaluate(el => getComputedStyle(el).lineHeight)
    expect(lineHeight).toBe('40px')
  })

  test('"inherit" leaves the VS Code font in place', async ({ page }) => {
    await initEditor(page, 'text', {
      fontFamily: 'monospace',
      fontSize: '22px',
    })
    await sendMessage(page, { type: 'settings', ...DEFAULT_SETTINGS })
    const style = await page.locator('.cm-content').evaluate(el => {
      const computed = getComputedStyle(el)
      return { fontFamily: computed.fontFamily, fontSize: computed.fontSize }
    })
    expect(style.fontFamily).not.toContain('monospace')
    expect(style.fontSize).not.toBe('22px')
  })

  test('line numbers hidden by default', async ({ page }) => {
    await initEditor(page, 'text')
    const count = await page.locator('.cm-lineNumbers').count()
    expect(count).toBe(0)
  })

  test('line numbers shown when enabled', async ({ page }) => {
    await initEditor(page, 'line one\nline two', { lineNumbers: true })
    const count = await page.locator('.cm-lineNumbers').count()
    expect(count).toBeGreaterThan(0)
  })

  test('custom list indent size applies to Tab', async ({ page }) => {
    await initEditor(page, '- item', { listIndentSize: 4 })
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Tab')
    const content = await getEditorContent(page)
    expect(content).toBe('    * item')
  })
})

test.describe('settings — syntaxMode', () => {
  const secondLine = (page: import('@playwright/test').Page) =>
    page
      .locator('.cm-line')
      .nth(1)
      .textContent()
      .then(t => t ?? '')

  test('defaults to muted', async ({ page }) => {
    await initEditor(page, 'anchor\n## heading')
    expect(await secondLine(page)).toBe('## heading')
  })

  test('toggles live between muted and hidden without touching content', async ({
    page,
  }) => {
    const content = 'anchor\n## heading'
    await initEditor(page, content)
    expect(await secondLine(page)).toBe('## heading')

    await sendMessage(page, {
      type: 'settings',
      ...DEFAULT_SETTINGS,
      syntaxMode: 'hidden',
    })
    await expect.poll(() => secondLine(page)).toBe('heading')

    await sendMessage(page, {
      type: 'settings',
      ...DEFAULT_SETTINGS,
      syntaxMode: 'muted',
    })
    await expect.poll(() => secondLine(page)).toBe('## heading')

    expect(await getEditorContent(page)).toBe(content)
  })

  test('hidden mode survives an unrelated settings change, reveal included', async ({
    page,
  }) => {
    await initEditor(page, 'anchor\n## heading\ntail', { syntaxMode: 'hidden' })
    await sendMessage(page, {
      type: 'settings',
      ...DEFAULT_SETTINGS,
      syntaxMode: 'hidden',
      lineHeight: 2,
    })
    await expect.poll(() => secondLine(page)).toBe('heading')

    // Reveal-on-cursor still works, which is what proves the plugin is alive
    // and selection-driven rather than merely rendering a stale set.
    await page.locator('.cm-line').nth(1).click()
    await expect.poll(() => secondLine(page)).toBe('## heading')
  })
})
