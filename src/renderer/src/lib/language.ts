export type Language = 'zh' | 'en'

export function resolveLanguage(value: unknown): Language {
  if (value === 'zh' || value === 'en') return value
  return 'zh'
}
