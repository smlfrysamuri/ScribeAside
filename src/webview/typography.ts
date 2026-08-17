import type { ScribeAsideSettings } from './types'

// Font family, size and line height live as CSS custom properties instead of
// inside the CodeMirror theme, because the reader is plain HTML that CodeMirror
// never touches: one source of truth styles both views. `inherit` is the host's
// "no answer" marker — removing the property lets the `:root` default in
// styles.css apply, which is the VS Code font the webview started with.
export const applyTypography = (
  root: HTMLElement,
  settings: Pick<ScribeAsideSettings, 'fontFamily' | 'fontSize' | 'lineHeight'>,
): void => {
  const set = (name: string, value: string | undefined): void => {
    if (value === undefined) {
      root.style.removeProperty(name)
    } else {
      root.style.setProperty(name, value)
    }
  }

  set(
    '--scribeaside-font-family',
    settings.fontFamily === 'inherit' ? undefined : settings.fontFamily,
  )
  set(
    '--scribeaside-font-size',
    settings.fontSize === 'inherit' ? undefined : settings.fontSize,
  )
  set(
    '--scribeaside-line-height',
    // A non-finite line height would serialize to a string CSS drops, taking
    // the stylesheet's default down with it; leave the property off instead.
    typeof settings.lineHeight === 'number' &&
      Number.isFinite(settings.lineHeight)
      ? String(settings.lineHeight)
      : undefined,
  )
}
