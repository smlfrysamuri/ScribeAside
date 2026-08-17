// Typography is the one place ScribeAside defers to another extension's
// settings. VS Code's built-in markdown preview already asks the user how
// markdown should look, and making them answer the same question twice is a
// chore, so `markdown.preview.fontFamily` / `fontSize` / `lineHeight` fill in
// where ScribeAside has no answer of its own.
//
// The rule is one-directional and never a merge: a `scribeaside.*` key the
// user actually set always wins, and a `markdown.preview.*` value is consulted
// only for the keys they left alone. "Actually set" excludes defaults on both
// sides — that is what keeps an untouched install rendering byte-identically
// to before, and it is why the caller passes values from `inspect()` rather
// than `get()`.

// Every value arrives from settings.json, so it can be any JSON type — a
// number where a string belongs must fall through to the next source rather
// than reach CSS.
export interface TypographySources {
  fontFamily?: unknown
  fontSize?: unknown
  lineHeight?: unknown
  previewFontFamily?: unknown
  previewFontSize?: unknown
  previewLineHeight?: unknown
}

export interface Typography {
  // `inherit` is the "nobody answered" marker, not a CSS keyword the webview
  // writes out: it means keep the VS Code font the stylesheet already picks.
  fontFamily: string
  fontSize: string
  lineHeight: number
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 1.6,
}

const asText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

// `markdown.preview.fontSize` is a number of pixels; `scribeaside.fontSize` is
// a string so that `1.1em` stays expressible. A bare number in either spelling
// means pixels — a unitless CSS font-size is invalid and would be dropped.
const asFontSize = (value: unknown): string | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? `${value}px` : undefined
  }
  const text = asText(value)
  if (!text) return undefined
  return /^\d+(?:\.\d+)?$/.test(text) ? `${text}px` : text
}

const asLineHeight = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined

export const resolveTypography = (sources: TypographySources): Typography => ({
  fontFamily:
    asText(sources.fontFamily) ??
    asText(sources.previewFontFamily) ??
    DEFAULT_TYPOGRAPHY.fontFamily,
  fontSize:
    asFontSize(sources.fontSize) ??
    asFontSize(sources.previewFontSize) ??
    DEFAULT_TYPOGRAPHY.fontSize,
  lineHeight:
    asLineHeight(sources.lineHeight) ??
    asLineHeight(sources.previewLineHeight) ??
    DEFAULT_TYPOGRAPHY.lineHeight,
})
