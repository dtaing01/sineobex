# Sineobex website

The public marketing site for Sineobex. Its one job is to explain the product and send teams to the waitlist.

- **Content source:** the [Sineobex Build & Strategy Plan](https://claude.ai/code/artifact/6f83b7b9-4134-4c36-ad0c-17a41eed3af3). If a page disagrees with the plan, the plan wins.
- **Design source:** the [Sineobex Field design system](https://claude.ai/artifact/5HMw4MtUiGeuP21s91i21V). `src/styles/tokens.css` and `src/styles/sineobex-field.css` are copies of it; update them by re-copying, never by editing values.
- **Waitlist:** every "Join the waitlist" button opens the Google Form set in `src/lib/site.ts`. The site itself collects nothing.

## Run it

```bash
cd website
npm install
npm run dev      # http://localhost:3000
npm run build    # static site in out/
npm start        # serve out/ locally
npm run lint     # type check
```

Node 20.9 or newer.

## How it is built

- Next.js App Router with `output: 'export'`, so the build is plain HTML, CSS and JS in `out/`. Host it on S3 + CloudFront next to the app, or any static host. There is no server and no API route.
- Fonts (Atkinson Hyperlegible Next, Atkinson Hyperlegible Mono, Barlow Condensed) are self-hosted through `@fontsource`, so visitors' browsers never call Google Fonts.
- Icons are Lucide (`lucide-react`), as the design system specifies.
- Themes follow the visitor's system: dark mode uses Night run, "increase contrast" uses High contrast (`src/app/globals.css`).
- The phone pictures on Home and Product are built from real design-system components (`src/components/PhonePreviews.tsx`) with sample data. They are decorative: nothing inside them is focusable, and screen readers get the caption.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Problem, how a run works, who it's for, security teaser |
| `/product/` | `src/app/product/page.tsx` | Every module in plain words, plus what's later |
| `/security/` | `src/app/security/page.tsx` | HIPAA safeguards, BAA, accessibility for public buyers |
| `/waitlist/` | `src/app/waitlist/page.tsx` | How joining works, FAQ, link to the form |
| `/about/` | `src/app/about/page.tsx` | Why Sineobex exists and how it is built |

## Rules for editing copy

- The site says **waitlist only**: no prices, no pilot terms, no availability dates.
- Say only what the plan supports. No "HIPAA certified" (it doesn't exist), no customer names or quotes without written permission, no claims about features the plan marks V2 except under "Later".
- Write the way the design system's voice section says: short, plain, person-first.

## Accessibility checks

Every page passed axe-core (WCAG 2.0/2.1/2.2 A and AA plus best practices) with zero violations at 1440px and 390px, in light, dark and high-contrast modes, with no horizontal scrolling. Re-run after any change to layout or colour.
