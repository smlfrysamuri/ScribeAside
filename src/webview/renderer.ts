import { LanguageDescription } from '@codemirror/language'
import { classHighlighter, highlightCode } from '@lezer/highlight'
import MarkdownIt from 'markdown-it'
import markdownItMark from 'markdown-it-mark'
import { codeLanguages } from './codeLanguages'

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// Same grammars and the same token vocabulary as the editor's fenced-code
// highlighting; the CSS maps the classHighlighter's `tok-*` classes to the
// identical VS Code theme variables.
const highlightFence = (code: string, lang: string): string => {
  if (!lang) return ''
  const description = LanguageDescription.matchLanguageName(
    codeLanguages,
    lang,
    true,
  )
  const support = description?.support
  if (!support) return ''
  const tree = support.language.parser.parse(code)
  let html = ''
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, classes) => {
      html += classes
        ? `<span class="${classes}">${escapeHtml(text)}</span>`
        : escapeHtml(text)
    },
    () => {
      html += '\n'
    },
  )
  return `<pre><code>${html}</code></pre>`
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight: highlightFence,
})

md.use(markdownItMark)

// Bare URLs autolink to match the editor's link handling; bare email
// addresses do not — the editor never treats them as links, and the reader
// must not grow link surfaces the editor lacks.
md.linkify.set({ fuzzyEmail: false })

// Task-list checkboxes, rendered disabled like the native markdown preview.
// A leading `[ ] ` / `[x] ` text child of a list item's first paragraph is
// replaced by an injected html_inline token — `html: false` gates the parser,
// not the renderer, so the injected content is emitted verbatim.
md.core.ruler.after('inline', 'mdpad-task-list', state => {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]
    if (inline.type !== 'inline' || !inline.children) continue
    if (tokens[i - 1].type !== 'paragraph_open') continue
    if (tokens[i - 2].type !== 'list_item_open') continue
    const first = inline.children[0]
    if (!first || first.type !== 'text') continue
    const match = /^\[([ xX])\]\s/.exec(first.content)
    if (!match) continue
    first.content = first.content.slice(match[0].length)
    const checkbox = new state.Token('html_inline', '', 0)
    checkbox.content = `<input class="mdpad-task-checkbox" type="checkbox" disabled${
      match[1] === ' ' ? '' : ' checked'
    }> `
    inline.children.unshift(checkbox)
    tokens[i - 2].attrJoin('class', 'mdpad-task-item')
  }
})

export const renderMarkdown = (source: string): string => {
  try {
    return md.render(source)
  } catch {
    return `<pre>${escapeHtml(source)}</pre>`
  }
}
