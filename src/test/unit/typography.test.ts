import assert from 'node:assert'
import { describe, it } from 'mocha'
import { DEFAULT_TYPOGRAPHY, resolveTypography } from '../../typography'
import { applyTypography } from '../../webview/typography'
import './cmTestHelper'

describe('resolveTypography', () => {
  it('falls back to the ScribeAside defaults when nothing is set', () => {
    assert.deepStrictEqual(resolveTypography({}), DEFAULT_TYPOGRAPHY)
  })

  it('adopts markdown.preview values when no scribeaside value is set', () => {
    assert.deepStrictEqual(
      resolveTypography({
        previewFontFamily: 'Georgia, serif',
        previewFontSize: 18,
        previewLineHeight: 2,
      }),
      { fontFamily: 'Georgia, serif', fontSize: '18px', lineHeight: 2 },
    )
  })

  it('prefers the scribeaside value over the markdown.preview one', () => {
    assert.deepStrictEqual(
      resolveTypography({
        fontFamily: 'Menlo',
        fontSize: '12px',
        lineHeight: 1.4,
        previewFontFamily: 'Georgia, serif',
        previewFontSize: 18,
        previewLineHeight: 2,
      }),
      { fontFamily: 'Menlo', fontSize: '12px', lineHeight: 1.4 },
    )
  })

  it('resolves each key independently', () => {
    assert.deepStrictEqual(
      resolveTypography({ lineHeight: 1.4, previewFontSize: 18 }),
      { fontFamily: 'inherit', fontSize: '18px', lineHeight: 1.4 },
    )
  })

  // An explicit "inherit" is an answer — it means the VS Code theme font — so
  // it has to shut the markdown preview fallback out.
  it('treats an explicit "inherit" as a scribeaside answer', () => {
    const resolved = resolveTypography({
      fontFamily: 'inherit',
      fontSize: 'inherit',
      previewFontFamily: 'Georgia, serif',
      previewFontSize: 18,
    })
    assert.strictEqual(resolved.fontFamily, 'inherit')
    assert.strictEqual(resolved.fontSize, 'inherit')
  })

  it('reads a bare number as pixels, from either source', () => {
    assert.strictEqual(resolveTypography({ fontSize: '15' }).fontSize, '15px')
    assert.strictEqual(
      resolveTypography({ previewFontSize: 15.5 }).fontSize,
      '15.5px',
    )
  })

  it('keeps a CSS unit as written', () => {
    assert.strictEqual(
      resolveTypography({ fontSize: '1.1em' }).fontSize,
      '1.1em',
    )
  })

  it('ignores blank and wrongly-typed values', () => {
    assert.deepStrictEqual(
      resolveTypography({
        fontFamily: '   ',
        fontSize: '',
        lineHeight: 'tall',
        previewLineHeight: 0,
      }),
      DEFAULT_TYPOGRAPHY,
    )
  })

  it('falls through to markdown.preview when the scribeaside value is unusable', () => {
    assert.strictEqual(
      resolveTypography({ fontSize: '  ', previewFontSize: 18 }).fontSize,
      '18px',
    )
  })
})

describe('applyTypography', () => {
  const root = (): HTMLElement => document.createElement('div')

  it('writes the resolved values as custom properties', () => {
    const el = root()
    applyTypography(el, {
      fontFamily: 'Menlo',
      fontSize: '18px',
      lineHeight: 2,
    })
    assert.strictEqual(
      el.style.getPropertyValue('--scribeaside-font-family'),
      'Menlo',
    )
    assert.strictEqual(
      el.style.getPropertyValue('--scribeaside-font-size'),
      '18px',
    )
    assert.strictEqual(
      el.style.getPropertyValue('--scribeaside-line-height'),
      '2',
    )
  })

  // Removing beats writing `inherit`: the stylesheet's :root default is the
  // VS Code font, and `font-family: inherit` on the editor would not be.
  it('removes the property when a value is "inherit"', () => {
    const el = root()
    applyTypography(el, {
      fontFamily: 'Menlo',
      fontSize: '18px',
      lineHeight: 2,
    })
    applyTypography(el, {
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 1.6,
    })
    assert.strictEqual(
      el.style.getPropertyValue('--scribeaside-font-family'),
      '',
    )
    assert.strictEqual(el.style.getPropertyValue('--scribeaside-font-size'), '')
    assert.strictEqual(
      el.style.getPropertyValue('--scribeaside-line-height'),
      '1.6',
    )
  })

  it('leaves the line height property off when the value is not a number', () => {
    const el = root()
    applyTypography(el, {
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: Number.NaN,
    })
    assert.strictEqual(
      el.style.getPropertyValue('--scribeaside-line-height'),
      '',
    )
  })
})
