import styles from './FlagPill.module.css';

/** Each palette colour's class, by the key a flag's body holds (packages/presets FLAG_COLORS). */
const COLOURS: Readonly<Record<string, string | undefined>> = {
  red: styles.red,
  orange: styles.orange,
  yellow: styles.yellow,
  green: styles.green,
  teal: styles.teal,
  blue: styles.blue,
  purple: styles.purple,
  grey: styles.grey,
};

/** The colour of a flag on its own, beside a name that says it: a choice of colour, a pill. */
export function FlagSwatch({ color }: { color: string }) {
  return <span className={`${styles.swatch} ${COLOURS[color] ?? ''}`.trim()} aria-hidden="true" />;
}

/**
 * A flag as staff see it (phase 5 design 8; PRD main 945): its colour, then the colour's name and
 * the flag's, "Red · High", so a flag is never shown by colour alone. Every flag pill in the portal
 * is drawn here, Team setup's and a patient's. `colorName` is the colour's plain name: the API's
 * `colorName` where it sends one, else the palette's (FLAG_COLOR_NAMES, lib/presets.ts), so a page
 * can't leave the name out. A flag removed from the team's list (`archived`) says so, as every
 * screen does for a patient who still carries it (5.1).
 */
export function FlagPill({
  color,
  colorName,
  name,
  archived = false,
}: {
  color: string;
  colorName: string;
  name: string;
  archived?: boolean;
}) {
  return (
    <span className={`sx-pill ${styles.pill} ${COLOURS[color] ?? ''}`.trim()}>
      <FlagSwatch color={color} />
      {`${colorName} · ${name}${archived ? ' · No longer on the team’s list' : ''}`}
    </span>
  );
}

/**
 * A patient's flags in a row of pills (phase 5 design 8.1): the risk level first, then each
 * condition, in the order given, so a list read aloud names them one by one. A removed flag says so.
 */
export function FlagPills({
  flags,
  label,
}: {
  flags: readonly { flagId: string; color: string; colorName: string; name: string; archived: boolean }[];
  /** The list's name, read before its pills. */
  label: string;
}) {
  return (
    <ul className={styles.pills} aria-label={label}>
      {flags.map((f) => (
        <li key={f.flagId}>
          <FlagPill color={f.color} colorName={f.colorName} name={f.name} archived={f.archived} />
        </li>
      ))}
    </ul>
  );
}
