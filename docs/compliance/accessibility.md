# Accessibility

**Target:** WCAG 2.2 AA on iOS, Android and the portal, plus a 7:1 High contrast theme. **Legal floor:** WCAG 2.1 AA under the ADA Title II rule (April 26, 2027 for entities serving 50,000+ people) and the HHS Section 504 rule (May 11, 2027 for recipients with 15+ employees). When a contract says "ADA compliant", this is what it means (plan, module 15).

## What CI checks on every pull request

| Surface | Check | Where |
|---|---|---|
| Portal | axe-core with WCAG 2.0/2.1/2.2 A and AA tags plus best practices, on every page, in Day, Night run and High contrast, at 1440 px and 390 px; also with the system's dark and increased-contrast settings | `apps/portal/e2e/a11y.spec.ts` |
| Portal | First Tab reaches the skip link, which moves focus to the main content | same |
| Portal | No CSP violations (a broken CSP can silently break assistive scripts) | same |
| Phone | Text and control colour pairs meet 4.5:1 in Day and Night run and 7:1 in High contrast | `apps/mobile/test/design/contrast_test.dart` |
| Phone | Tap targets at least 48 px, labelled controls, and text contrast on rendered screens (Flutter's guideline matchers) | `apps/mobile/test/design/demo_banner_test.dart` and every new screen test |
| Phone | The Demo data only banner is announced by screen readers, not only drawn | same |

## What automated checks cannot prove

Automated tools find roughly a third of WCAG failures. Before each release and in phase 11:

- VoiceOver (iOS) and TalkBack (Android) walk-throughs of every workflow.
- Keyboard-only walk-through of every portal workflow.
- Text at 200% on the phone and browser zoom at 200% on the portal, with no loss of content.
- An outside audit before the pilot, and an accessibility conformance report (VPAT 2.5, WCAG edition) as a sales document.
