## What changed

<!-- One or two sentences. Link the Build plan phase or module this implements. -->

## How it was tested

<!-- Commands run and what they showed. For UI: which themes and screen sizes. -->

## Checklist

- [ ] Every new action writes its audit event, in the same transaction
- [ ] No patient details in logs, crash reports, notifications, URLs or page titles
- [ ] The offline path is tested, not only the online one
- [ ] New screens checked for accessibility in Day, Night run and High contrast
- [ ] `pnpm contract:generate` run if any API route or schema changed
- [ ] New migrations are additive; no applied migration was edited
