import assert from 'node:assert'
import { describe, it } from 'mocha'
import { renderMarkdown } from '../../webview/renderer'

describe('renderMarkdown', () => {
  describe('block constructs', () => {
    it('renders headings at their levels', () => {
      const html = renderMarkdown('# One\n\n## Two\n\n### Three')
      assert.match(html, /<h1>One<\/h1>/)
      assert.match(html, /<h2>Two<\/h2>/)
      assert.match(html, /<h3>Three<\/h3>/)
    })

    it('renders GFM tables with a header row', () => {
      const html = renderMarkdown('| A | B |\n| - | - |\n| 1 | 2 |')
      assert.match(html, /<table>/)
      assert.match(html, /<th>A<\/th>/)
      assert.match(html, /<td>2<\/td>/)
    })

    it('renders horizontal rules and blockquotes', () => {
      const html = renderMarkdown('---\n\n> quoted')
      assert.match(html, /<hr>/)
      assert.match(html, /<blockquote>/)
    })
  })

  describe('inline constructs', () => {
    it('renders ==highlight== as <mark>', () => {
      assert.match(renderMarkdown('==hi=='), /<mark>hi<\/mark>/)
    })

    it('renders strikethrough', () => {
      assert.match(renderMarkdown('~~gone~~'), /<s>gone<\/s>/)
    })

    it('linkifies bare URLs', () => {
      assert.match(
        renderMarkdown('see https://example.com now'),
        /<a href="https:\/\/example\.com">/,
      )
    })

    it('does not linkify bare email addresses', () => {
      const html = renderMarkdown('mail alice@example.com today')
      assert.doesNotMatch(html, /<a /)
      assert.match(html, /alice@example\.com/)
    })
  })

  describe('task lists', () => {
    it('renders checked and unchecked disabled checkboxes', () => {
      const html = renderMarkdown('- [x] done\n- [ ] todo')
      assert.match(
        html,
        /<input class="scribeaside-task-checkbox" type="checkbox" disabled checked> done/,
      )
      assert.match(
        html,
        /<input class="scribeaside-task-checkbox" type="checkbox" disabled> todo/,
      )
      assert.match(html, /class="scribeaside-task-item"/)
    })

    it('leaves plain list items untouched', () => {
      const html = renderMarkdown('- just an item')
      assert.doesNotMatch(html, /checkbox/)
      assert.match(html, /<li>just an item<\/li>/)
    })

    it('does not treat mid-text brackets as checkboxes', () => {
      const html = renderMarkdown('- see [x] marks the spot')
      assert.doesNotMatch(html, /checkbox/)
    })
  })

  describe('safety', () => {
    it('escapes raw HTML instead of rendering it', () => {
      const html = renderMarkdown('<script>alert(1)</script>')
      assert.doesNotMatch(html, /<script>/)
      assert.match(html, /&lt;script&gt;/)
    })

    it('drops javascript: link destinations', () => {
      const html = renderMarkdown('[x](javascript:alert(1))')
      assert.doesNotMatch(html, /href="javascript:/)
    })
  })

  describe('fenced code', () => {
    it('highlights known languages with tok- classes', () => {
      const html = renderMarkdown('```ts\nconst x = 1\n```')
      assert.match(html, /<pre><code>/)
      assert.match(html, /class="[^"]*tok-[^"]*"/)
      assert.match(html, /const/)
    })

    it('falls back to escaped plain text for unknown languages', () => {
      const html = renderMarkdown('```nosuchlang\na < b\n```')
      assert.match(html, /<pre><code/)
      assert.doesNotMatch(html, /tok-/)
      assert.match(html, /a &lt; b/)
    })

    it('escapes HTML inside highlighted code', () => {
      const html = renderMarkdown('```html\n<div class="x"></div>\n```')
      assert.doesNotMatch(html, /<div class="x">/)
    })
  })
})
