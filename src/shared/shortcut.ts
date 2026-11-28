/** DOM key names differ from Electron accelerator names. */
export function shortcutKey(key: string): string {
  return (
    (
      {
        ArrowUp: 'Up',
        ArrowDown: 'Down',
        ArrowLeft: 'Left',
        ArrowRight: 'Right',
        ' ': 'Space',
        '+': 'Plus',
        Escape: 'Esc'
      } as Record<string, string>
    )[key] || (key.length === 1 ? key.toUpperCase() : key)
  )
}
