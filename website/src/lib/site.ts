/** Site-wide settings. Change the waitlist link here and every button follows. */
export const SITE = {
  name: 'Sineobex',
  url: 'https://sineobex.com',
  description:
    'Sineobex is a field-first medical record for street medicine teams, free clinics and public health outreach. It works offline, charts with a gloved thumb and only calls a note saved once the server confirms it.',
  /** Google Form that collects waitlist requests. It must never ask for patient information. */
  waitlistUrl: 'https://forms.gle/zsAAUKYC9khhb8vaA',
} as const;

export const NAV = [
  { href: '/product/', label: 'Product' },
  { href: '/security/', label: 'Security & compliance' },
  { href: '/about/', label: 'About' },
] as const;
