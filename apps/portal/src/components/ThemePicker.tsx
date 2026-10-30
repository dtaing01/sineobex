import { THEME_CHOICES, type ThemeChoice } from '@/lib/theme';
import { setTheme } from '@/app/actions/theme';

const LABELS: Record<ThemeChoice, string> = {
  system: 'Follow my device',
  day: 'Day',
  night: 'Night run',
  contrast: 'High contrast',
};

/** Works without JavaScript: a plain form posting to a server action. */
export function ThemePicker({ current }: { current: ThemeChoice }) {
  return (
    <form action={setTheme} className="px-theme">
      <label htmlFor="theme-choice">Theme</label>
      <select id="theme-choice" name="theme" defaultValue={current}>
        {THEME_CHOICES.map((t) => (
          <option key={t} value={t}>
            {LABELS[t]}
          </option>
        ))}
      </select>
      <button type="submit" className="sx-btn sx-btn--secondary">
        Apply
      </button>
    </form>
  );
}
