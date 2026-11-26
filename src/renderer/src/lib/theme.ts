export type ThemeMode = 'system' | 'light' | 'dark'

export function resolveThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system'
}
