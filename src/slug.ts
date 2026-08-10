export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'note'

const pad = (value: number, width: number): string =>
  String(value).padStart(width, '0')

// Local components, not UTC: the name is a human-facing ordering cue in a file
// tree, and the sort is stable either way.
export const timestampFileName = (date: Date): string =>
  `note-${date.getFullYear()}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}-${pad(date.getHours(), 2)}${pad(date.getMinutes(), 2)}${pad(date.getSeconds(), 2)}.md`

export const uniqueFileName = (
  name: string,
  taken: ReadonlySet<string>,
): string => {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  const ext = dot === -1 ? '' : name.slice(dot)
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!taken.has(candidate)) return candidate
  }
}
