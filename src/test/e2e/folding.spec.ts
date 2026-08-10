import { expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, initEditor, sendMessage } from './utils'

test.describe('folding', () => {
  test('fold chevron appears on H2 when folding is enabled', async ({
    page,
  }) => {
    await initEditor(page, '# title\n\n## section\n\ncontent', {
      folding: true,
    })
    const count = await page.locator('.scribeaside-foldable').count()
    expect(count).toBeGreaterThan(0)
  })

  test('no fold chevron when folding is disabled', async ({ page }) => {
    await initEditor(page, '## section\n\ncontent', { folding: false })
    const count = await page.locator('.scribeaside-foldable').count()
    expect(count).toBe(0)
  })

  test('no fold chevron on H1', async ({ page }) => {
    await initEditor(page, '# h1\n\ncontent', { folding: true })
    const h1Line = page.locator('.cm-line', { hasText: 'h1' }).first()
    const classes = await h1Line.getAttribute('class')
    expect(classes).not.toContain('scribeaside-foldable')
  })

  test('no fold chevron when heading has no content', async ({ page }) => {
    await initEditor(page, '## empty section', { folding: true })
    const count = await page.locator('.scribeaside-foldable').count()
    expect(count).toBe(0)
  })

  test('frontmatter is foldable', async ({ page }) => {
    await initEditor(page, '---\ntitle: test\n---\n\ncontent', {
      folding: true,
    })
    const count = await page.locator('.scribeaside-foldable').count()
    expect(count).toBeGreaterThan(0)
  })

  // Fold ranges start at `line.to` and heading markers start at `line.from`,
  // so the two decoration sources should not collide. This is the case that
  // proves it rather than assuming it.
  test.describe('fold interaction', () => {
    test('fold chevron still appears with syntax hidden', async ({ page }) => {
      await initEditor(page, '# title\n\n## section\n\ncontent', {
        folding: true,
        syntaxMode: 'hidden',
      })
      const count = await page.locator('.scribeaside-foldable').count()
      expect(count).toBeGreaterThan(0)
    })

    // Run the same fold/unfold sequence in both modes. Muted is the control:
    // if the click mechanism itself does not work in the harness, both fail
    // together and the failure is not about hidden mode.
    for (const syntaxMode of ['muted', 'hidden'] as const) {
      test(`folding then unfolding a section works in ${syntaxMode} mode`, async ({
        page,
      }) => {
        await initEditor(page, '# title\n\n## section\n\ncontent here', {
          folding: true,
          syntaxMode,
        })

        const clickChevron = async () => {
          const box = await page
            .locator('.scribeaside-foldable')
            .first()
            .boundingBox()
          if (!box) throw new Error('foldable line has no box')
          await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2)
        }

        const rendered = () =>
          page
            .locator('.cm-content')
            .textContent()
            .then(t => t ?? '')

        await clickChevron()
        await expect.poll(rendered).not.toContain('content here')

        await clickChevron()
        await expect.poll(rendered).toContain('content here')
      })
    }
  })

  test.describe('lifecycle', () => {
    // Regression guard for inlineFoldWidgets.destroy(): toggling folding on
    // and off must call removeEventListener for every addEventListener made
    // by a now-discarded plugin instance. Without destroy(), handlers leak.
    test('toggling folding off then on does not leak click listeners', async ({
      page,
    }) => {
      await initEditor(page, '## section\n\ncontent here\n\nmore content', {
        folding: true,
      })

      // Patch add/removeEventListener on .cm-editor (the element view.dom
      // points at) so we can count active click listeners across cycles.
      await page.evaluate(() => {
        const w = window as unknown as {
          __clickAdds: number
          __clickRemoves: number
        }
        w.__clickAdds = 0
        w.__clickRemoves = 0
        const editorDom = document.querySelector('.cm-editor') as HTMLElement
        const origAdd = editorDom.addEventListener.bind(editorDom)
        const origRemove = editorDom.removeEventListener.bind(editorDom)
        editorDom.addEventListener = ((
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) => {
          if (type === 'click') w.__clickAdds++
          return origAdd(type, listener, options)
        }) as typeof editorDom.addEventListener
        editorDom.removeEventListener = ((
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | EventListenerOptions,
        ) => {
          if (type === 'click') w.__clickRemoves++
          return origRemove(type, listener, options)
        }) as typeof editorDom.removeEventListener
      })

      // Cycle the folding setting. Each off→on pair should produce:
      //   +1 add (enable builds a new plugin instance)
      //   +1 remove (disable destroys the previous instance)
      const cycles = 3
      for (let i = 0; i < cycles; i++) {
        await sendMessage(page, {
          type: 'settings',
          ...DEFAULT_SETTINGS,
          folding: false,
        })
        await sendMessage(page, {
          type: 'settings',
          ...DEFAULT_SETTINGS,
          folding: true,
        })
      }

      const counts = await page.evaluate(() => {
        const w = window as unknown as {
          __clickAdds: number
          __clickRemoves: number
        }
        return { adds: w.__clickAdds, removes: w.__clickRemoves }
      })

      // Each enable attaches one listener; each disable must detach one.
      expect(counts.adds).toBe(cycles)
      expect(counts.removes).toBe(cycles)
    })

    test('disabling folding removes fold chevrons', async ({ page }) => {
      await initEditor(page, '## section\n\ncontent here', { folding: true })
      expect(
        await page.locator('.scribeaside-foldable').count(),
      ).toBeGreaterThan(0)

      await sendMessage(page, {
        type: 'settings',
        ...DEFAULT_SETTINGS,
        folding: false,
      })
      await expect(page.locator('.scribeaside-foldable')).toHaveCount(0)
    })
  })
})
