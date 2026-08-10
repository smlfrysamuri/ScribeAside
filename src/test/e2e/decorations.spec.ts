import { expect, test } from '@playwright/test'
import { focusEditor, getEditorContent, initEditor } from './utils'

const gotoLine = async (
  page: import('@playwright/test').Page,
  lineNum: number,
) => {
  await page.keyboard.press('Control+Home')
  for (let i = 1; i < lineNum; i++) await page.keyboard.press('ArrowDown')
}

test.describe('decorations', () => {
  test('bold text gets mdpad-bold class', async ({ page }) => {
    await initEditor(page, '**bold text**')
    await expect(page.locator('.mdpad-bold').first()).toHaveText('bold text')
  })

  test('italic text gets mdpad-italic class', async ({ page }) => {
    await initEditor(page, '*italic*')
    await expect(page.locator('.mdpad-italic').first()).toHaveText('italic')
  })

  test('strikethrough gets mdpad-strike class', async ({ page }) => {
    await initEditor(page, '~~strike~~')
    await expect(page.locator('.mdpad-strike').first()).toHaveText('strike')
  })

  test('inline code gets mdpad-inline-code class', async ({ page }) => {
    await initEditor(page, '`code`')
    await expect(page.locator('.mdpad-inline-code').first()).toHaveText('code')
  })

  test('highlight gets mdpad-highlight class', async ({ page }) => {
    await initEditor(page, '==highlighted==')
    await expect(page.locator('.mdpad-highlight').first()).toHaveText(
      'highlighted',
    )
  })

  test('heading 1 gets mdpad-heading-1 class', async ({ page }) => {
    await initEditor(page, '# heading')
    await expect(page.locator('.mdpad-heading-1')).toHaveText('heading')
  })

  test('heading 2 gets mdpad-heading-2 class', async ({ page }) => {
    await initEditor(page, '## heading')
    await expect(page.locator('.mdpad-heading-2')).toHaveText('heading')
  })

  test('markdown syntax is muted', async ({ page }) => {
    await initEditor(page, '# heading')
    const mutedCount = await page.locator('.mdpad-muted').count()
    expect(mutedCount).toBeGreaterThan(0)
  })

  test('link text is decorated', async ({ page }) => {
    await initEditor(page, '[link text](https://example.com)')
    await expect(page.locator('.mdpad-link-text').first()).toHaveText(
      'link text',
    )
  })

  test('task list checkbox is decorated', async ({ page }) => {
    await initEditor(page, '- [ ] task')
    await expect(page.locator('.mdpad-task-bracket').first()).toHaveText('[ ]')
  })

  test('checked task has strikethrough class', async ({ page }) => {
    await initEditor(page, '- [x] done')
    await expect(page.locator('.mdpad-task-checked').first()).toHaveText('done')
  })

  test('unordered list marker is decorated', async ({ page }) => {
    await initEditor(page, '- item')
    const bulletCount = await page.locator('.mdpad-list-bullet').count()
    expect(bulletCount).toBeGreaterThan(0)
  })

  test('numbered list marker is muted', async ({ page }) => {
    await initEditor(page, '1. item')
    const mutedCount = await page.locator('.mdpad-muted').count()
    expect(mutedCount).toBeGreaterThan(0)
  })

  test('supports `)` suffix for ordered lists', async ({ page }) => {
    await initEditor(page, '1) item')
    const mutedCount = await page.locator('.mdpad-muted').count()
    expect(mutedCount).toBeGreaterThan(0)
  })

  test('3-level nested ordered list has muted markers on all levels', async ({
    page,
  }) => {
    await initEditor(page, '1. a\n2. b\n3. c')
    await focusEditor(page)

    await gotoLine(page, 2)
    await page.keyboard.press('Tab')

    await gotoLine(page, 3)
    await page.keyboard.press('Tab')

    await gotoLine(page, 3)
    await page.keyboard.press('Tab')

    const content = await getEditorContent(page)
    expect(content).toBe('1. a\n  1. b\n    1. c')

    const lines = await page.locator('.cm-line').all()
    expect(lines.length).toBe(3)

    for (let i = 0; i < 3; i++) {
      const lineText = await lines[i].textContent()
      const mutedInLine = await lines[i].locator('.mdpad-muted').count()
      expect(
        mutedInLine,
        `line ${i + 1} (${lineText}) should have muted marker`,
      ).toBeGreaterThan(0)
    }
  })

  test('blockquote gets mdpad-blockquote class', async ({ page }) => {
    await initEditor(page, '> quoted')
    const blockquoteCount = await page.locator('.mdpad-blockquote').count()
    expect(blockquoteCount).toBeGreaterThan(0)
  })

  test('frontmatter keys are muted', async ({ page }) => {
    await initEditor(page, '---\ntitle: Test\n---\n\ncontent')
    const mutedCount = await page.locator('.mdpad-muted').count()
    expect(mutedCount).toBeGreaterThan(0)
  })

  test.describe('frontmatter — edge cases', () => {
    // These guard the shared findFrontmatterEndLine helper used by both
    // the decoration pass and the fold service.

    test('both fence lines and every key are muted', async ({ page }) => {
      await initEditor(
        page,
        '---\ntitle: My Title\ntags: a, b\n---\n\n# heading',
      )
      // Both `---` fence lines should be fully muted
      const firstFence = page.locator('.cm-line').nth(0)
      const closingFence = page.locator('.cm-line').nth(3)
      await expect(firstFence.locator('.mdpad-muted')).not.toHaveCount(0)
      await expect(closingFence.locator('.mdpad-muted')).not.toHaveCount(0)

      // key prefixes (up to and including `:`) are muted on the key lines
      const titleLine = page.locator('.cm-line').nth(1)
      const tagsLine = page.locator('.cm-line').nth(2)
      await expect(titleLine.locator('.mdpad-muted').first()).toHaveText(
        'title:',
      )
      await expect(tagsLine.locator('.mdpad-muted').first()).toHaveText('tags:')
    })

    test('unterminated frontmatter does not mute key prefixes as frontmatter', async ({
      page,
    }) => {
      // Without a closing `---`, nothing below should be decorated as
      // frontmatter. The key line must not have its `key:` prefix muted —
      // that's the fingerprint of the frontmatter pass (tolerated only when
      // inside a real fenced block).
      await initEditor(page, '---\nkey: value\nstill body')
      const keyLine = page.locator('.cm-line').nth(1)
      const mutedSpans = await keyLine.locator('.mdpad-muted').allTextContents()
      for (const t of mutedSpans) {
        expect(t).not.toMatch(/^key:\s*$/)
      }
    })

    test('headings inside frontmatter are NOT decorated as headings', async ({
      page,
    }) => {
      await initEditor(page, '---\n# not a heading\n---\n\n# real heading')
      const headingCount = await page.locator('.mdpad-heading-1').count()
      // Only the real heading on line 5 should get the heading decoration
      expect(headingCount).toBe(1)
      await expect(page.locator('.mdpad-heading-1')).toHaveText('real heading')
    })
  })
})

// The cursor sits at position 0 after `init`, so line 1 is always revealed.
// Every hiding assertion below therefore targets line 2 or later; a marker
// assertion written against line 1 fails for the right reason and reads as
// though hidden mode is broken.
const HIDDEN = { syntaxMode: 'hidden' } as const

const lineText = (
  page: import('@playwright/test').Page,
  index: number,
): Promise<string> =>
  page
    .locator('.cm-line')
    .nth(index)
    .textContent()
    .then(t => t ?? '')

test.describe('decorations — hidden mode', () => {
  test('heading prefix is collapsed on an inactive line', async ({ page }) => {
    await initEditor(page, 'anchor\n## heading', HIDDEN)
    expect(await lineText(page, 1)).toBe('heading')
  })

  test('inline delimiters are collapsed on an inactive line', async ({
    page,
  }) => {
    await initEditor(
      page,
      'anchor\n**bold** *it* ~~st~~ `code` ==mark==',
      HIDDEN,
    )
    expect(await lineText(page, 1)).toBe('bold it st code mark')
  })

  test('link brackets and url are collapsed', async ({ page }) => {
    await initEditor(page, 'anchor\n[link text](https://example.com)', HIDDEN)
    expect(await lineText(page, 1)).toBe('link text')
  })

  test('blockquote prefix is collapsed', async ({ page }) => {
    await initEditor(page, 'anchor\n> quoted', HIDDEN)
    expect(await lineText(page, 1)).toBe('quoted')
    await expect(page.locator('.mdpad-blockquote')).not.toHaveCount(0)
  })

  test('task bullet is collapsed but the checkbox stays visible', async ({
    page,
  }) => {
    await initEditor(page, 'anchor\n- [ ] task', HIDDEN)
    expect(await lineText(page, 1)).toBe('[ ] task')
    await expect(page.locator('.mdpad-task-bracket').first()).toHaveText('[ ]')
  })

  test('content styling still applies to collapsed constructs', async ({
    page,
  }) => {
    await initEditor(page, 'anchor\n## heading\n**bold**', HIDDEN)
    await expect(page.locator('.mdpad-heading-2')).toHaveText('heading')
    await expect(page.locator('.mdpad-bold').first()).toHaveText('bold')
  })

  test('tables, fences and frontmatter are left muted', async ({ page }) => {
    await initEditor(
      page,
      '---\ntitle: T\n---\n\n| a | b |\n| - | - |\n\n```\ncode\n```',
      HIDDEN,
    )
    // Line 1 is always revealed, so the frontmatter assertions target the key
    // line and the closing fence, which are genuinely inactive.
    expect(await lineText(page, 1)).toBe('title: T')
    expect(await lineText(page, 2)).toBe('---')
    expect(await lineText(page, 4)).toContain('|')
    expect(await lineText(page, 7)).toBe('```')
  })

  test('nested task lists keep their indentation', async ({ page }) => {
    await initEditor(
      page,
      'anchor\n- [ ] top\n  - [ ] nested one\n    - [ ] nested two',
      HIDDEN,
    )
    expect(await lineText(page, 1)).toBe('[ ] top')
    expect(await lineText(page, 2)).toBe('  [ ] nested one')
    expect(await lineText(page, 3)).toBe('    [ ] nested two')
  })

  test('content inside a fenced code block is never collapsed', async ({
    page,
  }) => {
    await initEditor(
      page,
      'anchor\n```\n- [ ] not a task\n1. not a list\n==not a highlight==\n```',
      HIDDEN,
    )
    expect(await lineText(page, 2)).toBe('- [ ] not a task')
    expect(await lineText(page, 3)).toBe('1. not a list')
    expect(await lineText(page, 4)).toBe('==not a highlight==')
  })

  test('nested blockquote prefixes collapse together', async ({ page }) => {
    await initEditor(page, 'anchor\n> > inner quote', HIDDEN)
    expect(await lineText(page, 1)).toBe('inner quote')
  })

  test('ordered list numbers and bullets are left alone', async ({ page }) => {
    await initEditor(page, 'anchor\n1. one\n- two', HIDDEN)
    expect(await lineText(page, 1)).toBe('1. one')
    expect(await lineText(page, 2)).toBe('- two')
  })

  test('document text is unchanged by hiding', async ({ page }) => {
    const content = 'anchor\n## heading\n**bold**'
    await initEditor(page, content, HIDDEN)
    expect(await getEditorContent(page)).toBe(content)
  })

  test('clicking into a hidden line reveals it, leaving re-hides it', async ({
    page,
  }) => {
    await initEditor(page, 'anchor\n## heading\ntail', HIDDEN)
    expect(await lineText(page, 1)).toBe('heading')

    await page.locator('.cm-line').nth(1).click()
    await expect.poll(() => lineText(page, 1)).toBe('## heading')

    await page.keyboard.press('Control+Home')
    await expect.poll(() => lineText(page, 1)).toBe('heading')
  })

  test('a multi-line selection reveals every line it touches', async ({
    page,
  }) => {
    await initEditor(page, 'anchor\n## one\n## two\n## three\n## four', HIDDEN)
    await page.locator('.cm-line').nth(1).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')

    // The selection head lands on the first position of `## three`, so that
    // line counts as touched too — three lines revealed, the fourth still hidden.
    await expect.poll(() => lineText(page, 1)).toBe('## one')
    await expect.poll(() => lineText(page, 2)).toBe('## two')
    await expect.poll(() => lineText(page, 3)).toBe('## three')
    await expect.poll(() => lineText(page, 4)).toBe('four')
  })

  test('muted mode still shows every marker', async ({ page }) => {
    await initEditor(page, 'anchor\n## heading')
    expect(await lineText(page, 1)).toBe('## heading')
  })
})
