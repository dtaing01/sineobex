export const THEME_COOKIE = 'sx-theme';
export type ThemeChoice = 'system' | 'day' | 'night' | 'contrast';
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'day', 'night', 'contrast'];

export function parseTheme(value: string | undefined): ThemeChoice {
  return THEME_CHOICES.includes(value as ThemeChoice) ? (value as ThemeChoice) : 'system';
}

/** The data-theme attribute for <html>; undefined lets CSS follow the system settings. */
export function dataTheme(choice: ThemeChoice): 'day' | 'night' | 'contrast' | undefined {
  return choice === 'system' ? undefined : choice;
}
