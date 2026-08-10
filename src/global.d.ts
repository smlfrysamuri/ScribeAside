declare module '*.css' {
  const content: string
  export default content
}

declare module 'markdown-it-mark' {
  import type MarkdownIt from 'markdown-it'
  const markdownItMark: (md: MarkdownIt) => void
  export default markdownItMark
}
