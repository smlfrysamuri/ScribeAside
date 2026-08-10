import { expect, test } from '@playwright/test'
import {
  clearPostedMessages,
  focusEditor,
  getEditorContent,
  getPostedMessages,
  initEditor,
} from './utils'

const paste = async (page: import('@playwright/test').Page, text: string) => {
  await page.evaluate(pastedText => {
    const target = document.querySelector('.cm-content') as HTMLElement
    const event = new ClipboardEvent('paste', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    })
    event.clipboardData?.setData('text/plain', pastedText)
    target.dispatchEvent(event)
  }, text)
}

test.describe('interactions', () => {
  test('click checkbox toggles unchecked → checked', async ({ page }) => {
    await initEditor(page, '- [ ] task')
    const bracket = page.locator('.mdpad-task-bracket').first()
    await bracket.click()
    const content = await getEditorContent(page)
    expect(content).toBe('- [x] task')
  })

  test('click checkbox toggles checked → unchecked', async ({ page }) => {
    await initEditor(page, '- [x] task')
    const bracket = page.locator('.mdpad-task-bracket').first()
    await bracket.click()
    const content = await getEditorContent(page)
    expect(content).toBe('- [ ] task')
  })

  test('cmd/ctrl+click on link posts openLink message', async ({ page }) => {
    await initEditor(page, '[click me](https://example.com)')
    await clearPostedMessages(page)
    const linkText = page.locator('.mdpad-link-text').first()
    // CodeMirror's click handler uses metaKey || ctrlKey
    await linkText.click({ modifiers: ['ControlOrMeta'] })
    await page.waitForTimeout(100)
    const posted = await getPostedMessages(page)
    const openLinks = posted.filter(m => m.type === 'openLink')
    expect(openLinks.length).toBe(1)
    expect(openLinks[0].url).toBe('https://example.com')
  })

  test('paste URL onto selected text wraps as markdown link', async ({
    page,
  }) => {
    await initEditor(page, 'click here')
    await focusEditor(page)
    await page.keyboard.press('Control+a')
    await paste(page, 'https://example.com')
    const content = await getEditorContent(page)
    expect(content).toBe('[click here](https://example.com)')
  })

  test('paste file path onto selected text wraps as markdown link', async ({
    page,
  }) => {
    await initEditor(page, 'the readme')
    await focusEditor(page)
    await page.keyboard.press('Control+a')
    await paste(page, './README.md')
    const content = await getEditorContent(page)
    expect(content).toBe('[the readme](./README.md)')
  })

  test('paste plain text without selection replaces normally', async ({
    page,
  }) => {
    await initEditor(page, '')
    await focusEditor(page)
    await paste(page, 'plain text')
    const content = await getEditorContent(page)
    expect(content).toBe('plain text')
  })
})

// The click handlers read `state.doc`, never the DOM, so collapsing markers
// must not change them. These cases live on line 2 so the construct is
// genuinely hidden — line 1 always holds the cursor after `init`.
test.describe('interactions — hidden mode', () => {
  const HIDDEN = { syntaxMode: 'hidden' } as const

  test('click checkbox toggles on a hidden line', async ({ page }) => {
    await initEditor(page, 'anchor\n- [ ] task', HIDDEN)
    await page.locator('.mdpad-task-bracket').first().click()
    expect(await getEditorContent(page)).toBe('anchor\n- [x] task')
  })

  test('cmd/ctrl+click on a link posts openLink on a hidden line', async ({
    page,
  }) => {
    await initEditor(page, 'anchor\n[click me](https://example.com)', HIDDEN)
    await clearPostedMessages(page)
    await page
      .locator('.mdpad-link-text')
      .first()
      .click({ modifiers: ['ControlOrMeta'] })
    await page.waitForTimeout(100)
    const posted = await getPostedMessages(page)
    const openLinks = posted.filter(m => m.type === 'openLink')
    expect(openLinks.length).toBe(1)
    expect(openLinks[0].url).toBe('https://example.com')
  })
})
