import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  apiCall,
  expectAccessible,
  expectNothingStored,
  expectReflow,
  IDP,
  MFA_CODE,
  portalNav,
  signIn,
  staffToken,
  watchCsp,
  watchTraffic,
} from './helpers';

// Team setup's note types in the portal (phase 5 design 5.4, 8.1): the list and a note type's own
// page with its editor; each page's states and wording, a refusal's sentence for each refusal the
// routes answer, axe in the three themes, reflow at 320 px, nothing kept in the browser, and
// addresses that carry only keys. What is expected is read from the API, never counted from the
// seed: every spec shares the database. Every name is made up.

const LIST = '/team/presets/note-types';
const REASON_LINE = 'Reason: Give a reason of 3 to 300 characters.';
const FIELDS_TITLE = 'Some fields need changing. Check each one below.';
const PROTECTED = 'This part can’t be changed.';
const NOT_COPYABLE =
  'This section comes from a note type for other visits or other readers, so it can’t be copied here.';
const STALE = 'Someone else changed this while you were editing. Reload to see their version.';

/**
 * The note type pages' addresses: the list, a note type's page by its key, and the notice of an act
 * or of a publish, by keys and numbers only, with the field or change an alert's link moved to.
 */
function expectOnlyKeys(addresses: string[]) {
  for (const address of addresses)
    expect(address).toMatch(
      /\/team\/presets(\/note-types(\/[a-z][a-z0-9_]{1,60})?)?(\?((done|refused)=[a-z_]+&noteType=[a-z][a-z0-9_]{1,60}|published=\d+(&also=[a-z0-9_,]+)?))?(#[A-Za-z0-9.-]+)?$|\/(home(\?denied=1)?|sign-in.*|reauth.*)$/,
    );
}

type NoteType = {
  key: string;
  title: string;
  state: 'active' | 'archived';
  version: number;
  customized: boolean;
  referencedBy: Record<string, number>;
  definition: {
    kinds: string[];
    group: string;
    sensitivity: string;
    sections: {
      id: string;
      title: string;
      fields: { id: string; kind: string; label: string; options?: { code: string; label: string }[] }[];
    }[];
  };
};

const admin = () => staffToken('admin@example.com');

/** The team's note types as the API lists them, removed ones included, in the list's order. */
async function noteTypes(): Promise<NoteType[]> {
  const res = await apiCall(await admin(), 'GET', '/v1/admin/note-types');
  expect(res.status).toBe(200);
  return (await res.json()) as NoteType[];
}
const noteType = async (key: string) => (await noteTypes()).find((n) => n.key === key)!;

/** A note type of the team's own, a copy or a blank one, added as another admin would add it. */
async function added(body: Record<string, unknown>): Promise<string> {
  const res = await apiCall(await admin(), 'POST', '/v1/admin/note-types', {
    reason: 'Demo: set up for a test',
    ...body,
  });
  expect(res.status, JSON.stringify(body)).toBe(201);
  return ((await res.json()) as { key: string }).key;
}

/** Another admin's publish of a note type, at the version it is at now. */
async function publishedMeanwhile(key: string, ops: unknown[]): Promise<number> {
  const now = await noteType(key);
  const res = await apiCall(await admin(), 'PUT', `/v1/admin/note-types/${key}`, {
    baseVersion: now.version,
    ops,
    reason: 'Demo: another admin’s change',
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

/** The access.denied events the audit log holds for a seeded staff member, newest first. */
async function deniedOf(email: string) {
  const token = await admin();
  const members = (await (await apiCall(token, 'GET', '/v1/team/members')).json()) as {
    userId: string;
    email: string;
  }[];
  const res = await apiCall(token, 'POST', '/v1/team/audit/search', {
    actorUserId: members.find((m) => m.email === email)!.userId,
    actionPrefix: 'access.denied',
    limit: 100,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { entries: { details: Record<string, unknown> }[] }).entries;
}

/** The words of 8.1's facts, as the pages show them. */
const VISITS: Record<string, string> = {
  medical: 'Medical',
  non_medical: 'Non-Medical',
  'medical,non_medical': 'Medical and Non-Medical',
};
const GROUPS: Record<string, string> = {
  clinical: 'Clinical',
  psych: 'Psych',
  social: 'Social',
  outreach: 'Outreach',
  harm_reduction: 'Harm reduction',
  wound: 'Wound',
};

const fact = (section: Locator, term: string) => section.locator(`dt:text-is("${term}") + dd`);

/** The editor's parts on a note type's own page. */
function editorOf(page: Page) {
  const held = page.getByRole('region', { name: /^Changes to publish \(\d+\)$/ });
  return {
    held,
    heldItems: held.getByRole('listitem'),
    said: page.locator('#editor-said'),
    reason: held.getByLabel('Reason', { exact: true }),
    publish: held.getByRole('button', { name: 'Publish', exact: true }),
    alert: held.getByRole('alert'),
    section: (title: string) => page.getByRole('region', { name: title, exact: true }),
  };
}

// ------------------------------------------------------------------------------------------------
// The list
// ------------------------------------------------------------------------------------------------

test.describe('note types, /team/presets/note-types', () => {
  test('@responsive a Program Admin opens Note types from the hub and finds each note type with its visits, group, version, Edit and Remove, accessible in all three themes', async ({
    page,
  }) => {
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await page.goto('/team/presets');
    const all = await noteTypes();
    const active = all.filter((n) => n.state === 'active');
    const removed = all.filter((n) => n.state === 'archived').length;
    const card = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Note types' });
    await expect(card).toContainText(`${active.length} ${active.length === 1 ? 'note type' : 'note types'}`);
    await card.getByRole('link', { name: 'Note types', exact: true }).click();
    await expect(page).toHaveURL(/\/team\/presets\/note-types$/);
    await expect(page).toHaveTitle('Note types · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Note types');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Each active note type in the list's order, then Add a note type, then Removed when any is.
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
      ...active.map((n) => n.title),
      'Add a note type',
      ...(removed > 0 ? [`Removed (${removed})`] : []),
    ]);
    for (const n of active) {
      const section = page.getByRole('region', { name: n.title, exact: true });
      await expect(fact(section, 'Which visits')).toHaveText(VISITS[n.definition.kinds.join(',')]!);
      await expect(fact(section, 'Timeline group')).toHaveText(GROUPS[n.definition.group]!);
      await expect(fact(section, 'Whose version')).toHaveText(
        `${n.customized ? 'Your team’s' : 'Sineobex’s, used as is'}, version ${n.version}`,
      );
      await expect(section.getByRole('link', { name: `Edit ${n.title}`, exact: true })).toHaveAttribute(
        'href',
        `${LIST}/${n.key}`,
      );
      await expect(section.getByRole('button', { name: `Remove ${n.title}`, exact: true })).toBeVisible();
      await expect(section.getByRole('region', { name: `History of ${n.title}` })).toBeVisible();
    }
    await expect(
      page
        .getByRole('region', { name: 'History of Wound care' })
        .getByRole('row', { name: /Added by Sineobex, version 1/ }),
    ).toHaveCount(1);
    // The seeded team holds the platform's version of each: nothing is on offer.
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);

    const add = page.getByRole('form', { name: 'Add a note type' });
    await expect(
      add.getByRole('group', { name: 'Which visits (for a blank one)' }),
    ).toHaveAccessibleDescription(
      'A note type can’t change between Medical and Non-Medical: Add a new note type instead.',
    );
    await expect(add.getByLabel('Title', { exact: true })).toHaveAccessibleDescription(
      /Don’t put patient names here\.$/,
    );

    await expectAccessible(page, LIST);
    await expectReflow(page, LIST);
    await expectNothingStored(page, LIST);
    expectOnlyKeys(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('adding a note type asks a reason first, then says each field beside it, refuses a held title and a copy of the quick encounter, and adds a blank one and a copy', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(LIST);
    const form = page.getByRole('form', { name: 'Add a note type' });
    const title = form.getByLabel('Title', { exact: true });
    const reason = form.getByLabel('Reason');
    const add = form.getByRole('button', { name: 'Add note type' });
    const alert = form.getByRole('alert');

    // Nothing typed, ticked or chosen: the request's own check names every field in one answer,
    // each in a line of its own, and its link moves focus to the field.
    await add.click();
    await expect(alert).toBeFocused();
    await expect(alert.locator('.px-alert__title')).toHaveText(FIELDS_TITLE);
    for (const line of [
      'Title: Enter a title of 1 to 80 characters.',
      REASON_LINE,
      'Which visits: Choose Medical, Non-Medical or both.',
      'Timeline group: Choose where the timeline files its notes.',
    ])
      await expect(alert.getByRole('link', { name: line, exact: true })).toBeVisible();
    await expectAccessible(page, 'Add a note type, refused', { inPlace: true });
    await expectReflow(page, 'Add a note type, refused');
    await alert.getByRole('link', { name: 'Which visits: Choose Medical, Non-Medical or both.' }).click();
    await expect(form.getByRole('group', { name: 'Which visits (for a blank one)' })).toBeFocused();

    // A reason: kept with what else was sent.
    await reason.fill('Demo: the night team asked');

    // A title another note type holds, in other letters: beside the title, what was typed kept.
    await title.fill('wound CARE');
    await form.getByRole('checkbox', { name: 'Medical', exact: true }).check();
    await form.getByRole('checkbox', { name: 'Non-Medical', exact: true }).check();
    await form.getByRole('radio', { name: 'Outreach', exact: true }).check();
    await add.click();
    await expect(alert.getByRole('link')).toHaveText(['Title: Another note type already has this name.']);
    await expect(title).toHaveValue('wound CARE');
    await expect(form.getByRole('checkbox', { name: 'Medical', exact: true })).toBeChecked();
    await expect(form.getByRole('checkbox', { name: 'Non-Medical', exact: true })).toBeChecked();
    await expect(form.getByRole('radio', { name: 'Outreach', exact: true })).toBeChecked();

    // A copy of the quick encounter: the API refuses it, beside Copy of.
    await title.fill('Demo: Quick, again');
    await form.getByLabel('Copy of').selectOption({ label: 'Quick encounter' });
    await add.click();
    await expect(alert.getByRole('link')).toHaveText([
      'Copy of: The quick encounter and the Red flags note can’t be copied. Choose another, or start a blank one.',
    ]);
    await expectAccessible(page, 'Add a note type, not copyable', { inPlace: true });

    // A blank one, for both kinds of visit.
    await form.getByLabel('Copy of').selectOption({ label: 'None: start a blank one' });
    await title.fill('Demo: Night outreach');
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Night outreach. It’s on the phones after their next sync.',
    );
    const blank = (await noteTypes()).find((n) => n.title === 'Demo: Night outreach')!;
    expect(blank).toMatchObject({ state: 'active', version: 1, customized: true });
    expect(blank.key).toMatch(/^t_[0-9a-f]{12}$/);
    expect(blank.definition).toMatchObject({
      kinds: ['medical', 'non_medical'],
      group: 'outreach',
      sections: [{ id: 'notes', title: 'Notes', fields: [{ id: 'notes', kind: 'text', label: 'Notes' }] }],
    });
    const section = page.getByRole('region', { name: 'Demo: Night outreach', exact: true });
    await expect(fact(section, 'Which visits')).toHaveText('Medical and Non-Medical');
    await expect(fact(section, 'Whose version')).toHaveText('Your team’s, version 1');
    const made = section.getByRole('region', { name: 'History of Demo: Night outreach' }).getByRole('row', {
      name: /Added, version 1/,
    });
    await expect(made).toContainText('Your team’s');
    await expect(made).toContainText('Demo: the night team asked');
    // The form is ready for the next one.
    await expect(title).toHaveValue('');
    await expect(reason).toHaveValue('');

    // A copy, of a note type for both kinds of visit: it takes the copied one's.
    await title.fill('Demo: Day outreach');
    await form.getByLabel('Copy of').selectOption({ label: 'Outreach' });
    await reason.fill('Demo: a day round too');
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Day outreach. It’s on the phones after their next sync.',
    );
    const copy = (await noteTypes()).find((n) => n.title === 'Demo: Day outreach')!;
    const outreach = await noteType('outreach');
    expect(copy.definition.kinds).toEqual(outreach.definition.kinds);
    expect(copy.definition.sections.map((s) => s.id)).toEqual(outreach.definition.sections.map((s) => s.id));

    await expectNothingStored(page, 'Note types after an add');
    expectOnlyKeys(traffic.addresses);
  });

  test('Remove refuses the Red flags note, saying why; another moves to Removed, and Restore brings it back once no other has its title', async ({
    page,
  }) => {
    test.slow();
    const key = await added({ title: 'Demo: Spare round', kinds: ['non_medical'], group: 'outreach' });
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(LIST);

    // The Red flags note: a Medical note can't be finished without it, so it stays.
    const redFlags = page.getByRole('region', { name: 'Red flags and disposition', exact: true });
    await redFlags.getByRole('button', { name: 'Remove Red flags and disposition', exact: true }).click();
    const removeRed = redFlags.getByRole('form', { name: 'Remove Red flags and disposition' });
    await removeRed.getByLabel('Reason').fill('Demo: trying to remove it');
    await removeRed.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(removeRed.getByRole('alert')).toHaveText(
      'The Red flags note can’t be removed: a Medical note can’t be finished without it.',
    );
    await expect(removeRed.getByLabel('Reason')).toHaveValue('Demo: trying to remove it');
    await expectAccessible(page, 'Remove the Red flags note, refused', { inPlace: true });
    expect(await noteType('red_flags_disposition')).toMatchObject({ state: 'active' });

    // Removed, and listed under Removed.
    await page.getByRole('button', { name: 'Remove Demo: Spare round', exact: true }).click();
    const remove = page.getByRole('form', { name: 'Remove Demo: Spare round' });
    await remove.getByLabel('Reason').fill('Demo: not needed now');
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?done=removed&noteType=${key}$`));
    await expect(page.getByRole('heading', { name: 'Removed: Demo: Spare round' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Demo: Spare round', exact: true })).toHaveCount(0);
    const removed = page.getByRole('region', { name: /^Removed \(\d+\)$/ });
    await expect(removed).toContainText('Demo: Spare round');
    await expectAccessible(page, 'Note types after a remove');
    await expectReflow(page, 'Note types after a remove');

    // Its own page says it is removed, and offers Restore, not the editor.
    await page.goto(`${LIST}/${key}`);
    await expect(page.getByRole('region', { name: 'Removed', exact: true })).toContainText(
      'This note type isn’t offered for new notes.',
    );
    await expect(page.getByRole('region', { name: /^Changes to publish/ })).toHaveCount(0);
    await expectAccessible(page, 'A removed note type’s page');
    await expectReflow(page, 'A removed note type’s page');
    await page.goto(LIST);

    // Another note type has taken its title since: the restore is refused.
    const taker = await added({ title: 'Demo: Spare round', kinds: ['non_medical'], group: 'social' });
    await page.reload();
    await removed.getByRole('button', { name: 'Restore Demo: Spare round', exact: true }).click();
    const restore = removed.getByRole('form', { name: 'Restore Demo: Spare round' });
    await restore.getByLabel('Reason').fill('Demo: needed again');
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(restore.getByRole('alert')).toHaveText(
      'Another note type has this name now. Rename that one first.',
    );
    await expectAccessible(page, 'Restore a note type, refused', { inPlace: true });

    // Once that one is renamed, restored at the version it was removed at.
    await publishedMeanwhile(taker, [{ op: 'rename_type', title: 'Demo: Spare round two' }]);
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?done=restored&noteType=${key}$`));
    await expect(page.getByRole('heading', { name: 'Restored: Demo: Spare round' })).toBeFocused();
    const history = page.getByRole('region', { name: 'History of Demo: Spare round' });
    await expect(history.getByRole('row', { name: /Removed, version 1/ })).toContainText(
      'Demo: not needed now',
    );
    await expect(history.getByRole('row', { name: /Restored, version 1/ })).toContainText(
      'Demo: needed again',
    );
    expect(await noteType(key)).toMatchObject({ state: 'active', version: 1 });

    await expectNothingStored(page, 'Note types after a restore');
    expectOnlyKeys(traffic.addresses);
  });

  test('a Remove that another admin’s Remove made pointless comes back to the list saying so, and nothing is written', async ({
    page,
  }) => {
    const key = await added({ title: 'Demo: Removed twice', kinds: ['non_medical'], group: 'outreach' });
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(LIST);
    await page.getByRole('button', { name: 'Remove Demo: Removed twice', exact: true }).click();
    const remove = page.getByRole('form', { name: 'Remove Demo: Removed twice' });
    await remove.getByLabel('Reason').fill('Demo: not used any more');
    // Another admin removes it first.
    const res = await apiCall(await admin(), 'POST', `/v1/admin/note-types/${key}/archive`, {
      baseVersion: 1,
      reason: 'Demo: another admin’s remove',
    });
    expect(res.status).toBe(200);
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?refused=archived&noteType=${key}$`));
    await expect(
      page.getByRole('heading', { name: 'Removed by another admin: Demo: Removed twice' }),
    ).toBeFocused();
    await expect(page.getByRole('main')).toContainText('so what you sent wasn’t saved');
    await expectAccessible(page, 'Note types, a remove refused meanwhile');
    await expectReflow(page, 'Note types, a remove refused meanwhile');
    // Listed once under Removed, at the version the other admin removed it at.
    await expect(
      page
        .getByRole('region', { name: /^Removed \(\d+\)$/ })
        .getByRole('listitem')
        .filter({ hasText: 'Demo: Removed twice' }),
    ).toHaveCount(1);
    expect(await noteType(key)).toMatchObject({ state: 'archived', version: 1 });
    expectOnlyKeys(traffic.addresses);
  });

  test('staff without the permission are refused Note types and a note type’s page at a typed address, each logged once', async ({
    page,
  }) => {
    await signIn(page, 'clinician@example.com');
    for (const address of [LIST, `${LIST}/outreach`]) {
      const before = (await deniedOf('clinician@example.com')).length;
      await page.goto(address);
      await expect(page).toHaveURL(/\/home\?denied=1$/);
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        'Your role doesn’t allow that screen. The attempt was logged.',
      );
      // The list was asked, and refused: no history was.
      const after = await deniedOf('clinician@example.com');
      expect(after, address).toHaveLength(before + 1);
      expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
    }
  });
});

// ------------------------------------------------------------------------------------------------
// A note type's own page: the editor
// ------------------------------------------------------------------------------------------------

test.describe('a note type’s editor, /team/presets/note-types/[key]', () => {
  test('@responsive a note type’s page opens from Edit with its facts, protected parts said as such, accessible in all three themes', async ({
    page,
  }) => {
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await page.goto(LIST);
    const red = await noteType('red_flags_disposition');
    await page
      .getByRole('region', { name: red.title, exact: true })
      .getByRole('link', { name: `Edit ${red.title}`, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/red_flags_disposition$`));
    await expect(page).toHaveTitle('Note type · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(red.title);
    await expect(page.getByRole('main').locator('dt:text-is("Which visits") + dd')).toContainText(
      'A note type can’t change between Medical and Non-Medical: Add a new note type instead.',
    );
    const editor = editorOf(page);
    await expect(editor.held).toContainText('Nothing yet.');
    // Every section of the Red flags note is protected: each says so, and offers no change.
    for (const s of red.definition.sections) {
      const section = editor.section(s.title);
      await expect(section).toContainText(PROTECTED);
      await expect(section.getByRole('button', { name: /^(Rename|Hide)/ })).toHaveCount(0);
    }
    await editor
      .section(red.definition.sections[0]!.title)
      .getByRole('button', { name: /^Show its fields/ })
      .click();
    // The section's sentence, and each field's, a group's own fields among them.
    type Field = NoteType['definition']['sections'][number]['fields'][number] & { fields?: Field[] };
    const count = (fields: Field[]): number => fields.reduce((n, f) => n + 1 + count(f.fields ?? []), 0);
    await expect(editor.section(red.definition.sections[0]!.title).getByText(PROTECTED)).toHaveCount(
      1 + count(red.definition.sections[0]!.fields),
    );

    await expectAccessible(page, `${LIST}/red_flags_disposition`);
    await expectReflow(page, `${LIST}/red_flags_disposition`);
    await expectNothingStored(page, `${LIST}/red_flags_disposition`);
    expectOnlyKeys(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('the editor holds each change by keyboard until Publish, says each, and publishes them as the next version', async ({
    page,
  }) => {
    test.slow();
    const key = await added({ title: 'Demo: Street round', copyOf: 'outreach' });
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await page.goto(`${LIST}/${key}`);
    const editor = editorOf(page);
    const section = editor.section('Outreach / community encounter');
    await section.getByRole('button', { name: /^Show its fields/ }).click();
    // The button to Red flags is protected; the other fields are not.
    await expect(
      section.getByRole('listitem').filter({ hasText: 'Go to Red flags and disposition' }),
    ).toContainText(PROTECTED);

    // Rename a field by keyboard: the box takes focus, Enter keeps it, focus is back on Rename.
    const rename = section.getByRole('button', { name: 'Rename the field “Notes”', exact: true });
    await rename.focus();
    await page.keyboard.press('Enter');
    const box = section.getByLabel('New words for the field “Notes”');
    await expect(box).toBeFocused();
    await box.fill('Demo: What happened');
    await page.keyboard.press('Enter');
    await expect(rename).toBeFocused();
    await expect(editor.said).toHaveText(
      'Held: Rename the field “Notes” to “Demo: What happened”. 1 change to publish.',
    );
    await expect(section).toContainText('Renamed to “Demo: What happened” when you publish.');

    // Hide keeps focus on its button, which then says Show again; Show again takes it back.
    const hide = section.getByRole('button', { name: 'Hide the field “Follow-up”', exact: true });
    await hide.focus();
    await page.keyboard.press('Enter');
    const showAgain = section.getByRole('button', { name: 'Show again the field “Follow-up”', exact: true });
    await expect(showAgain).toBeFocused();
    await expect(editor.heldItems).toHaveCount(2);
    await page.keyboard.press('Enter');
    await expect(hide).toBeFocused();
    await expect(editor.heldItems).toHaveCount(1);

    // A choice's answers: Move down keeps focus on the answer's Move down, Retire gives it to Keep it.
    await section.getByRole('button', { name: /^Show its answers \(\d+\) of “Support provided”$/ }).click();
    const answers = section.getByRole('list', { name: 'Answers of “Support provided”, in order' });
    await answers.getByRole('button', { name: 'Move down the answer “Food”', exact: true }).click();
    await expect(
      answers.getByRole('button', { name: 'Move down the answer “Food”', exact: true }),
    ).toBeFocused();
    await expect(editor.said).toContainText('Move the answer “Food” down in “Support provided”, to 2nd of 8');
    await expect(answers.getByRole('listitem').first()).toContainText('Clothing');
    await answers.getByRole('button', { name: 'Retire the answer “Phone”', exact: true }).click();
    await expect(
      section.getByRole('button', { name: 'Keep it the answer “Phone”', exact: true }),
    ).toBeFocused();
    await section.getByLabel('A new answer for “Support provided”').fill('Demo: Blankets');
    await page.keyboard.press('Enter');
    await expect(section.getByLabel('A new answer for “Support provided”')).toBeFocused();
    await expect(editor.heldItems).toHaveCount(4);

    // A field of the team's own: Yes or No.
    await section
      .getByRole('button', { name: 'Add a field to “Outreach / community encounter”', exact: true })
      .click();
    const addField = section.getByRole('form', { name: 'Add a field to “Outreach / community encounter”' });
    await expect(addField.getByLabel('What it asks')).toBeFocused();
    await addField.getByLabel('What it asks').fill('Demo: Dog with them');
    await addField.getByRole('radio', { name: 'Yes or No', exact: true }).check();
    await addField.getByRole('button', { name: 'Hold this field', exact: true }).click();
    await expect(
      section.getByRole('button', { name: 'Add a field to “Outreach / community encounter”', exact: true }),
    ).toBeFocused();
    await expect(editor.heldItems).toHaveCount(5);
    await expect(section).toContainText(
      'A new field when you publish: “Demo: Dog with them” (Choice, one answer).',
    );

    // A section of the team's own, after this one, starting with a field: its form checked as drawn.
    const addSection = page.getByRole('region', { name: 'Add a section', exact: true });
    const openSection = addSection.getByRole('button', { name: 'Add a section of your own', exact: true });
    await openSection.click();
    const sectionForm = addSection.getByRole('form', { name: 'Add a section' });
    await expect(sectionForm.getByLabel('Its title')).toBeFocused();
    await sectionForm.getByRole('radio', { name: 'A choice of answers', exact: true }).check();
    await expect(sectionForm.getByLabel('Answer 2')).toBeVisible();
    await sectionForm.getByRole('button', { name: 'Add another answer', exact: true }).click();
    await expect(sectionForm.getByLabel('Answer 3')).toBeFocused();
    await expectAccessible(page, 'The editor, adding a section', { inPlace: true });
    await expectReflow(page, 'The editor, adding a section');
    await sectionForm.getByRole('radio', { name: 'Words', exact: true }).check();
    await sectionForm.getByRole('radio', { name: 'Long answer, several lines', exact: true }).check();
    await sectionForm.getByLabel('Its title').fill('Demo: Pets');
    await sectionForm.getByLabel('What it asks').fill('Demo: Their names');
    await expect(sectionForm.getByLabel('Where it goes')).toHaveValue('outreach');
    await sectionForm.getByRole('button', { name: 'Hold this section', exact: true }).click();
    await expect(openSection).toBeFocused();
    await expect(editor.heldItems).toHaveCount(6);
    await expect(section).toContainText('A new section after this one when you publish:');

    // Publish with no reason: the alert takes focus and names the Reason box.
    await editor.publish.click();
    await expect(editor.alert).toBeFocused();
    await expect(editor.alert.getByRole('link', { name: REASON_LINE })).toBeVisible();
    await expectAccessible(page, 'Publish, refused for its reason', { inPlace: true });
    await expectReflow(page, 'Publish, refused for its reason');
    expect((await noteType(key)).version).toBe(1);

    // Published: the page loads again on version 2, saying so.
    await editor.reason.fill('Demo: plainer words for the night team');
    await editor.publish.click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${key}\\?published=2$`));
    await expect(page.getByRole('heading', { name: 'Published', exact: true })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Published', exact: true })).toContainText(
      'Version 2 is live. Notes already started stay on the version they began on.',
    );
    await expect(editorOf(page).held).toContainText('Nothing yet.');
    const now = await noteType(key);
    expect(now.version).toBe(2);
    const fields = now.definition.sections[0]!.fields;
    expect(fields.find((f) => f.id === 'notes')!.label).toBe('Demo: What happened');
    expect(fields.find((f) => f.id === 'follow_up')).toBeDefined();
    expect(fields.find((f) => f.id === 'support')!.options!.map((o) => o.label)).toEqual([
      'Clothing',
      'Food',
      'Hygiene',
      'Charging',
      'Transportation',
      'Supplies',
      'Information',
      'Demo: Blankets',
    ]);
    expect(fields.at(-1)).toMatchObject({
      kind: 'choice',
      label: 'Demo: Dog with them',
      options: [{ label: 'Yes' }, { label: 'No' }],
    });
    expect(now.definition.sections.map((x) => x.title)).toEqual([
      'Outreach / community encounter',
      'Demo: Pets',
    ]);
    expect(now.definition.sections[1]!.fields).toMatchObject([
      { kind: 'text', label: 'Demo: Their names', lines: 'many', maxLength: 2000 },
    ]);
    await expect(
      page
        .getByRole('region', { name: 'History', exact: true })
        .getByRole('row', { name: /Edited, version 2/ }),
    ).toContainText('Demo: plainer words for the night team');

    await expectAccessible(page, 'A note type, published');
    await expectReflow(page, 'A note type, published');
    await expectNothingStored(page, 'A note type, published');
    expectOnlyKeys(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('a refused change is named in the alert and beside it, and nothing is published: a protected part, a section from another kind of note type, and an edit made stale meanwhile', async ({
    page,
  }) => {
    test.slow();
    const key = await added({ title: 'Demo: Evening round', copyOf: 'outreach' });
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);

    // The Red flags note's title: the API answers that it can't be changed, naming the change.
    await page.goto(`${LIST}/red_flags_disposition`);
    let editor = editorOf(page);
    const red = await noteType('red_flags_disposition');
    await page.getByRole('button', { name: 'Rename the note type', exact: true }).click();
    await page.getByLabel('New title').fill('Demo: Red flags, ours');
    await page.keyboard.press('Enter');
    await editor.reason.fill('Demo: a shorter title');
    await editor.publish.click();
    await expect(editor.alert).toBeFocused();
    await expect(editor.alert).toContainText(
      `Change 1, Rename the note type to “Demo: Red flags, ours”: ${PROTECTED}`,
    );
    await expect(editor.heldItems.first()).toContainText(PROTECTED);
    await expect(editor.reason).toHaveValue('Demo: a shorter title');
    await expectAccessible(page, 'Publish, a protected part refused', { inPlace: true });
    await expectReflow(page, 'Publish, a protected part refused');
    expect((await noteType('red_flags_disposition')).version).toBe(red.version);

    // A section from a note type for other visits: 8.1's sentence beside the copy.
    await page.goto(`${LIST}/${key}`);
    editor = editorOf(page);
    const copy = page.getByRole('region', { name: 'Copy a section', exact: true });
    await copy.getByRole('button', { name: 'Copy a section from another note type', exact: true }).click();
    await expect(copy.getByLabel('From the note type')).toBeFocused();
    await copy.getByLabel('From the note type').selectOption({ label: 'General / primary care' });
    await copy.getByLabel('The section').selectOption({ label: 'Vitals' });
    await copy.getByRole('button', { name: 'Hold this copy', exact: true }).click();
    await expect(
      copy.getByRole('button', { name: 'Copy a section from another note type', exact: true }),
    ).toBeFocused();
    await editor.reason.fill('Demo: vitals for the round');
    await editor.publish.click();
    await expect(editor.alert).toContainText(
      `Change 1, Copy the section “Vitals” from “General / primary care” after “Outreach / community encounter”: ${NOT_COPYABLE}`,
    );
    await expect(editor.heldItems.first()).toContainText(NOT_COPYABLE);
    await expectAccessible(page, 'Publish, a copy refused', { inPlace: true });
    expect((await noteType(key)).version).toBe(1);

    // Undo the copy: focus moves to the list's heading, and the alert goes with the change.
    await editor.heldItems.first().getByRole('button', { name: /^Undo/ }).click();
    await expect(page.getByRole('heading', { name: 'Changes to publish (0)' })).toBeFocused();
    await expect(editor.alert).toHaveCount(0);

    // Another admin publishes meanwhile: this editor, at version 1, is stale, and stays so.
    await page.getByRole('button', { name: 'Rename the note type', exact: true }).click();
    await page.getByLabel('New title').fill('Demo: Evening round, late');
    await page.keyboard.press('Enter');
    expect(await publishedMeanwhile(key, [{ op: 'rename_type', title: 'Demo: Evening round, early' }])).toBe(
      2,
    );
    // A server action on the page (a Remove refused for its reason) renders it again from a fresh
    // read: the editor keeps the version it opened (D115), says another one is live, and holds on.
    await page.getByRole('button', { name: 'Remove Demo: Evening round', exact: true }).click();
    // Named by the title the page last read, which the other admin's publish changed.
    const remove = page.getByRole('form', { name: /^Remove Demo: Evening round/ });
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(remove.getByRole('alert')).toBeFocused();
    await expect(page.getByRole('main')).toContainText(
      'Someone else published version 2 while you were editing, so your changes here would be refused.',
    );
    await expect(editor.heldItems).toHaveCount(1);
    await editor.publish.click();
    await expect(editor.alert).toHaveText(STALE);
    await expect(editor.heldItems).toHaveCount(1);
    await expectAccessible(page, 'Publish, stale', { inPlace: true });
    expect(await noteType(key)).toMatchObject({ version: 2, title: 'Demo: Evening round, early' });

    await expectNothingStored(page, 'The editor after its refusals');
    expectOnlyKeys(traffic.addresses);
  });

  test('a stale sign-in at Publish is confirmed in a tab of its own, and the held changes stay to be published', async ({
    page,
  }) => {
    test.slow();
    const key = await added({ title: 'Demo: Late round', kinds: ['non_medical'], group: 'outreach' });
    const stale = await fetch(`${IDP}/test/stale-sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', minutes: 60 }),
    });
    expect(stale.status).toBe(200);
    await signIn(page, 'admin@example.com');
    await page.goto(`${LIST}/${key}`);
    const editor = editorOf(page);
    await page.getByRole('button', { name: 'Rename the note type', exact: true }).click();
    await page.getByLabel('New title').fill('Demo: Late round, renamed');
    await page.keyboard.press('Enter');
    await editor.reason.fill('Demo: an old sign-in');
    await editor.publish.click();
    await expect(editor.alert).toBeFocused();
    await expect(editor.alert).toContainText('Confirm it’s you before you publish');
    const confirm = editor.alert.getByRole('link', { name: 'Confirm it’s you (opens in a new tab)' });
    await expect(confirm).toHaveAttribute('href', `/reauth?next=${encodeURIComponent(`${LIST}/${key}`)}`);
    await expectAccessible(page, 'Publish, a stale sign-in', { inPlace: true });
    expect((await noteType(key)).version).toBe(1);

    const [tab] = await Promise.all([page.context().waitForEvent('page'), confirm.click()]);
    await tab.getByLabel('6-digit code').fill(MFA_CODE);
    await tab.getByRole('button', { name: 'Continue' }).click();
    await expect(tab).toHaveURL(new RegExp(`${LIST}/${key}$`));
    await tab.close();

    // Back on the editor: the change is still held, and goes through now.
    await expect(editor.heldItems).toHaveCount(1);
    await editor.publish.click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${key}\\?published=2$`));
    expect(await noteType(key)).toMatchObject({ version: 2, title: 'Demo: Late round, renamed' });
  });
});
