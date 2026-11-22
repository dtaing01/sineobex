import { expect, test, type Locator } from '@playwright/test';
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

// Team setup's pages in the portal (phase 5 design 8.1): each page's states and wording, a refusal's
// sentence for each refusal its routes answer, axe in the three themes, reflow at 320 px, nothing
// kept in the browser, and addresses that carry only IDs. Each page joins this file with its page
// (design 13.4); the Done when walks them in presets.spec.ts. Every name is made up.

/**
 * Team setup's addresses: a page of it, a preset's, and the notice of an act, by ID only, with the
 * field an error summary's link moved to (a form's ID and a body path, `#new-category-behaviour`,
 * `#new-item-categoryId`).
 */
function expectOnlyIds(addresses: string[]) {
  for (const address of addresses)
    expect(address).toMatch(
      /\/team\/presets(\/[a-z-]+(\/[0-9a-f-]{36})?)?(\?done=[a-z_]+&preset=[0-9a-f-]{36})?(#[A-Za-z0-9.-]+)?$|\/(home|sign-in.*|reauth.*)$/,
    );
}

/** The hub's areas (8.1), each with the kinds its page shows; the first is the one it counts. */
const AREAS = [
  {
    title: 'Categories',
    href: '/team/presets/categories',
    kinds: ['order_category'],
    noun: ['category', 'categories'],
  },
  { title: 'Items', href: '/team/presets/items', kinds: ['item'], noun: ['item', 'items'] },
  { title: 'Bundles', href: '/team/presets/bundles', kinds: ['bundle'], noun: ['bundle', 'bundles'] },
  { title: 'Flags', href: '/team/presets/flags', kinds: ['flag'], noun: ['flag', 'flags'] },
  {
    title: 'Condition supplies',
    href: '/team/presets/condition-supplies',
    kinds: ['condition_supply_map', 'settings'],
    noun: ['mapping', 'mappings'],
  },
  {
    title: 'Bag minimums',
    href: '/team/presets/bag-minimums',
    kinds: ['bag', 'settings'],
    noun: ['bag', 'bags'],
  },
] as const;

/** The access.denied events the audit log holds for a seeded staff member, newest first. */
async function deniedOf(email: string) {
  const admin = await staffToken('admin@example.com');
  const members = (await (await apiCall(admin, 'GET', '/v1/team/members')).json()) as {
    userId: string;
    email: string;
  }[];
  const res = await apiCall(admin, 'POST', '/v1/team/audit/search', {
    actorUserId: members.find((m) => m.email === email)!.userId,
    actionPrefix: 'access.denied',
    limit: 100,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { entries: { details: Record<string, unknown> }[] }).entries;
}

type Listed = { state: 'active' | 'archived'; updateOnOffer: boolean };

/** What each card should say, read from the API as a Program Admin: its count, and any update. */
async function expectedCards() {
  const token = await staffToken('admin@example.com');
  const lists = new Map<string, Listed[]>();
  for (const kind of new Set(AREAS.flatMap((a) => a.kinds))) {
    const res = await apiCall(token, 'GET', `/v1/admin/presets/${kind}`);
    expect(res.status, kind).toBe(200);
    lists.set(
      kind,
      ((await res.json()) as Listed[]).filter((p) => p.state === 'active'),
    );
  }
  return AREAS.map((a) => {
    const count = lists.get(a.kinds[0])!.length;
    return {
      ...a,
      count: `${count} ${count === 1 ? a.noun[0] : a.noun[1]}`,
      updateAvailable: a.kinds.some((k) => lists.get(k)!.some((p) => p.updateOnOffer)),
    };
  });
}

test.describe('the hub, /team/presets', () => {
  test('@responsive a Program Admin opens Presets from the navigation and finds a card per area with its count, accessible in all three themes', async ({
    page,
  }) => {
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    const link = portalNav(page).getByRole('link', { name: 'Presets', exact: true });
    await expect(link).toHaveAttribute('href', '/team/presets');
    await link.click();
    await expect(page).toHaveURL(/\/team\/presets$/);
    await expect(page).toHaveTitle('Presets · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Presets');
    await expect(link).toHaveAttribute('aria-current', 'page');

    const expected = await expectedCards();
    const cards = page.getByRole('main').getByRole('listitem');
    await expect(cards).toHaveCount(expected.length);
    for (const [i, area] of expected.entries()) {
      const card = cards.nth(i);
      await expect(card.getByRole('heading', { level: 2 })).toHaveText(area.title);
      await expect(card.getByRole('link', { name: area.title })).toHaveAttribute('href', area.href);
      await expect(card).toContainText(area.count);
      await expect(card.getByText('Update available', { exact: true })).toHaveCount(
        area.updateAvailable ? 1 : 0,
      );
      await expect(card.getByText('couldn’t be loaded')).toHaveCount(0);
    }
    // The seeded team holds the platform's presets at the version the platform holds: none on offer.
    expect(expected.some((a) => a.updateAvailable)).toBe(false);

    await expectAccessible(page, '/team/presets');
    await expectReflow(page, '/team/presets');
    await expectNothingStored(page, '/team/presets');
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('staff without the permission see no Presets, and a typed URL is refused, logged once', async ({
    page,
  }) => {
    const denied = () => deniedOf('clinician@example.com');

    await signIn(page, 'clinician@example.com');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveCount(0);
    const before = (await denied()).length;
    await page.goto('/team/presets');
    await expect(page).toHaveURL(/\/home\?denied=1$/);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Your role doesn’t allow that screen. The attempt was logged.',
    );
    const after = await denied();
    // One list was asked, and refused: the others never were.
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
  });
});

// ------------------------------------------------------------------------------------------------
// Categories (8.1): OTC, Rx, Labs and the team's own, each with what it holds
// ------------------------------------------------------------------------------------------------

test.describe('categories, /team/presets/categories', () => {
  const PAGE = '/team/presets/categories';
  const HOLDS = { supply: 'Supplies', medication: 'Medications', lab: 'Tests' } as const;

  type Category = {
    id: string;
    name: string;
    state: 'active' | 'archived';
    version: number;
    referencedBy: Record<string, number>;
    body: { name: string; behaviour: keyof typeof HOLDS; sort: number };
  };

  /** The team's categories as the API lists them, archived ones included. */
  async function categories(): Promise<Category[]> {
    const res = await apiCall(
      await staffToken('admin@example.com'),
      'GET',
      '/v1/admin/presets/order_category',
    );
    expect(res.status).toBe(200);
    return (await res.json()) as Category[];
  }

  // As the page lists them: by place, then by name as the API sorts names.
  const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const inPlace = (rows: Category[]) =>
    rows
      .filter((c) => c.state === 'active')
      .sort((a, b) => a.body.sort - b.body.sort || byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));

  /** A category of the team's own, added as another admin would add it. */
  async function addedCategory(name: string, behaviour: keyof typeof HOLDS, sort: number): Promise<string> {
    const res = await apiCall(
      await staffToken('admin@example.com'),
      'POST',
      '/v1/admin/presets/order_category',
      {
        body: { name, behaviour, sort },
        reason: 'Demo: set up for a test',
      },
    );
    expect(res.status, name).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  /** Another admin's edit, at the version the category is at now. */
  async function editedMeanwhile(id: string, change: Partial<Category['body']>): Promise<number> {
    const now = (await categories()).find((c) => c.id === id)!;
    const res = await apiCall(
      await staffToken('admin@example.com'),
      'PUT',
      `/v1/admin/presets/order_category/${id}`,
      {
        baseVersion: now.version,
        body: { ...now.body, ...change },
        reason: 'Demo: another admin’s change',
      },
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { version: number }).version;
  }

  /** "12 items", as the page says what uses a category; only items name one. */
  const usedBy = (c: Category) => {
    const n = c.referencedBy.item ?? 0;
    return n === 0 ? 'Nothing yet' : `${n} ${n === 1 ? 'item' : 'items'}`;
  };

  const fact = (section: Locator, term: string) => section.locator(`dt:text-is("${term}") + dd`);

  test('@responsive a Program Admin opens Categories from the hub and finds the team’s categories by their place, each with what it holds, accessible in all three themes', async ({
    page,
  }) => {
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await page.goto('/team/presets');
    await page.getByRole('main').getByRole('link', { name: 'Categories', exact: true }).click();
    await expect(page).toHaveURL(/\/team\/presets\/categories$/);
    await expect(page).toHaveTitle('Categories · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Categories');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const all = await categories();
    const listed = inPlace(all);
    const removed = all.filter((c) => c.state === 'archived').length;
    // Every active category in its place, then Add a category, then the Removed list when any is.
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
      ...listed.map((c) => c.name),
      'Add a category',
      ...(removed > 0 ? [`Removed (${removed})`] : []),
    ]);
    // The platform's (PRD main 104: OTC, Rx, Labs, and the others an admin adds), in their order.
    const platform = ['OTC', 'Rx', 'Labs', 'Supplies'];
    expect(listed.map((c) => c.name).filter((n) => platform.includes(n))).toEqual(platform);
    for (const c of listed) {
      const section = page.getByRole('region', { name: c.name, exact: true });
      await expect(fact(section, 'What it holds')).toHaveText(HOLDS[c.body.behaviour]);
      await expect(fact(section, 'Place in the list')).toHaveText(String(c.body.sort));
      await expect(fact(section, 'Used by')).toHaveText(usedBy(c));
      await expect(section.getByRole('button', { name: `Edit ${c.name}`, exact: true })).toBeVisible();
      await expect(section.getByRole('button', { name: `Remove ${c.name}`, exact: true })).toBeVisible();
      await expect(section.getByRole('region', { name: `History of ${c.name}` })).toBeVisible();
    }
    await expect(
      page
        .getByRole('region', { name: 'History of OTC' })
        .getByRole('row', { name: /Added by Sineobex, version 1/ }),
    ).toHaveCount(1);
    // The seeded team holds the platform's version of each: nothing is on offer.
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);

    const add = page.getByRole('form', { name: 'Add a category' });
    const holds = add.getByRole('group', { name: 'What it holds' });
    await expect(holds).toHaveAccessibleDescription('What it holds can’t be changed later.');
    for (const label of ['Supplies', 'Medications', 'Tests'])
      await expect(holds.getByRole('radio', { name: label, exact: true })).not.toBeChecked();
    await expect(add.getByLabel('Name', { exact: true })).toHaveAccessibleDescription(
      'Don’t put patient names here.',
    );

    await expectAccessible(page, PAGE);
    await expectReflow(page, PAGE);
    await expectNothingStored(page, PAGE);
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('adding a category asks for a reason, a name and what it holds, says each beside its field, keeps what was typed, and puts the new one at the end', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Add a category' });
    const name = form.getByLabel('Name', { exact: true });
    const reason = form.getByLabel('Reason');
    const add = form.getByRole('button', { name: 'Add category' });
    const alert = form.getByRole('alert');

    // Nothing typed: the reason is asked first, as the API reads the request before the body.
    await add.click();
    await expect(alert).toBeFocused();
    await expect(alert).toContainText('Give a reason of 3 to 300 characters.');

    // A reason, and still no name and no choice: each said beside its field, the reason kept.
    await reason.fill('Demo: kits we hand out');
    await add.click();
    await expect(alert.locator('.px-alert__title')).toHaveText(
      'Some fields need changing. Check each one below.',
    );
    await expect(alert.getByRole('link', { name: 'Name: This is too short or too small.' })).toBeVisible();
    const choose = alert.getByRole('link', { name: 'Choose what it holds.' });
    await expect(choose).toBeVisible();
    await expect(reason).toHaveValue('Demo: kits we hand out');
    await expectAccessible(page, 'Add a category, refused', { inPlace: true });
    await expectReflow(page, 'Add a category, refused');
    await choose.click();
    await expect(form.getByRole('group', { name: 'What it holds' })).toBeFocused();

    // A name another category holds, in other letters: refused, keeping what was typed and chosen.
    await name.fill('otc');
    await form.getByRole('radio', { name: 'Medications' }).check();
    await add.click();
    await expect(alert.locator('.px-alert__title')).toHaveText('Another category already has this name.');
    await expect(name).toHaveValue('otc');
    await expect(form.getByRole('radio', { name: 'Medications' })).toBeChecked();

    // Added, at the end of the list.
    const before = await categories();
    await name.fill('Demo: Hygiene kits');
    await form.getByRole('radio', { name: 'Supplies' }).check();
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Hygiene kits. It’s on the phones after their next sync.',
    );
    const place = Math.max(...before.map((c) => c.body.sort)) + 10;
    const made = (await categories()).find((c) => c.name === 'Demo: Hygiene kits')!;
    expect(made).toMatchObject({
      state: 'active',
      version: 1,
      body: { name: 'Demo: Hygiene kits', behaviour: 'supply', sort: place },
    });
    const headings = await page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents();
    expect(headings[headings.indexOf('Add a category') - 1]).toBe('Demo: Hygiene kits');
    const section = page.getByRole('region', { name: 'Demo: Hygiene kits', exact: true });
    await expect(fact(section, 'What it holds')).toHaveText('Supplies');
    await expect(fact(section, 'Place in the list')).toHaveText(String(place));
    await expect(fact(section, 'Used by')).toHaveText('Nothing yet');
    const added = section.getByRole('region', { name: 'History of Demo: Hygiene kits' }).getByRole('row', {
      name: /Added, version 1/,
    });
    await expect(added).toContainText('Alex Rivera (demo)');
    await expect(added).toContainText('Your team’s');
    await expect(added).toContainText('Demo: kits we hand out');
    // The form is ready for the next one.
    await expect(name).toHaveValue('');
    await expect(reason).toHaveValue('');
    await expect(form.getByRole('radio', { checked: true })).toHaveCount(0);

    await expectNothingStored(page, 'Categories after an add');
    expectOnlyIds(traffic.addresses);
  });

  test('editing a category renames it and moves it, with a reason; nothing changed, a place that isn’t a whole number and an edit made stale meanwhile are each refused with their sentence', async ({
    page,
  }) => {
    test.slow();
    const id = await addedCategory('Demo: Foot care kits', 'supply', 900);
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const editOf = (name: string) =>
      page.getByRole('region', { name, exact: true }).getByRole('form', { name: `Edit ${name}` });
    await page.getByRole('button', { name: 'Edit Demo: Foot care kits', exact: true }).click();
    let form = editOf('Demo: Foot care kits');
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Demo: Foot care kits');
    const place = form.getByLabel('Place in the list');
    await expect(place).toHaveValue('900');
    await expect(form.getByLabel('Reason')).toHaveValue('');

    // Saved as it is: nothing changed.
    await form.getByLabel('Reason').fill('Demo: first after OTC');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText('You haven’t changed anything.');

    // A place that isn't a whole number: said beside it, and kept as typed.
    await place.fill('first');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(
      form.getByRole('alert').getByRole('link', {
        name: 'Place in the list: Enter a whole number from 0 to 1,000,000.',
      }),
    ).toBeVisible();
    await expect(place).toHaveValue('first');
    await expect(place).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page, 'Edit a category, refused', { inPlace: true });
    await expectReflow(page, 'Edit a category, refused');

    // Renamed, and moved between OTC and Rx.
    await form.getByLabel('Name', { exact: true }).fill('Demo: Foot care');
    await place.fill('15');
    await form.getByRole('button', { name: 'Save' }).click();
    form = editOf('Demo: Foot care');
    await expect(form.getByRole('status')).toHaveText(
      'Saved: Demo: Foot care. It’s on the phones after their next sync.',
    );
    const saved = (await categories()).find((c) => c.id === id)!;
    expect(saved).toMatchObject({
      version: 2,
      body: { name: 'Demo: Foot care', behaviour: 'supply', sort: 15 },
    });
    const headings = await page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents();
    const at = (n: string) => headings.indexOf(n);
    expect(at('OTC')).toBeLessThan(at('Demo: Foot care'));
    expect(at('Demo: Foot care')).toBeLessThan(at('Rx'));
    const section = page.getByRole('region', { name: 'Demo: Foot care', exact: true });
    await expect(fact(section, 'Place in the list')).toHaveText('15');
    await expect(
      section.getByRole('region', { name: 'History of Demo: Foot care' }).getByRole('row', {
        name: /Edited, version 2/,
      }),
    ).toContainText('Demo: first after OTC');

    // Another admin edits it meanwhile: this form, at version 2, is stale, and stays so.
    expect(await editedMeanwhile(id, { sort: 16 })).toBe(3);
    await form.getByLabel('Name', { exact: true }).fill('Demo: Foot care kit');
    await form.getByLabel('Reason').fill('Demo: a shorter name');
    await form.getByRole('button', { name: 'Save' }).click();
    const stale = 'Someone else changed this while you were editing. Reload to see their version.';
    await expect(form.getByRole('alert')).toHaveText(stale);
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Demo: Foot care kit');
    await expectAccessible(page, 'Edit a category, stale', { inPlace: true });
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(stale);
    expect((await categories()).find((c) => c.id === id)).toMatchObject({
      version: 3,
      body: { name: 'Demo: Foot care', sort: 16 },
    });
    // Reloaded, the page shows their version.
    await page.reload();
    await expect(
      fact(page.getByRole('region', { name: 'Demo: Foot care', exact: true }), 'Place in the list'),
    ).toHaveText('16');
  });

  test('Remove refuses a category items still use, saying how many; an unused one moves to Removed, and Restore brings it back once no other has its name', async ({
    page,
  }) => {
    test.slow();
    const spare = await addedCategory('Demo: Spare shelf', 'medication', 950);
    const otc = (await categories()).find((c) => c.name === 'OTC' && c.state === 'active')!;
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(PAGE);

    // OTC: items use it, so it stays, and the page says how many.
    const otcSection = page.getByRole('region', { name: 'OTC', exact: true });
    await otcSection.getByRole('button', { name: 'Remove OTC', exact: true }).click();
    const removeOtc = otcSection.getByRole('form', { name: 'Remove OTC' });
    await removeOtc.getByLabel('Reason').fill('Demo: trying to remove it');
    await removeOtc.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(removeOtc.getByRole('alert')).toHaveText(
      `Still used by ${usedBy(otc)}. Take it out of those first.`,
    );
    await expect(removeOtc.getByLabel('Reason')).toHaveValue('Demo: trying to remove it');
    await expectAccessible(page, 'Remove OTC, refused', { inPlace: true });
    expect((await categories()).find((c) => c.id === otc.id)).toMatchObject({ state: 'active' });

    // Unused: removed, and listed under Removed.
    await page.getByRole('button', { name: 'Remove Demo: Spare shelf', exact: true }).click();
    const remove = page.getByRole('form', { name: 'Remove Demo: Spare shelf' });
    await remove.getByLabel('Reason').fill('Demo: not needed now');
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}\\?done=removed&preset=${spare}$`));
    await expect(page.getByRole('heading', { name: 'Removed: Demo: Spare shelf' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Demo: Spare shelf', exact: true })).toHaveCount(0);
    const removed = page.getByRole('region', { name: /^Removed \(\d+\)$/ });
    await expect(removed).toContainText('Demo: Spare shelf');
    await expectAccessible(page, 'Categories after a remove');

    // Another category has taken its name since: the restore is refused.
    const taker = await addedCategory('Demo: Spare shelf', 'supply', 960);
    await page.reload();
    await removed.getByRole('button', { name: 'Restore Demo: Spare shelf', exact: true }).click();
    const restore = removed.getByRole('form', { name: 'Restore Demo: Spare shelf' });
    await restore.getByLabel('Reason').fill('Demo: needed again');
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(restore.getByRole('alert')).toHaveText(
      'Another category has this name now. Rename that one first.',
    );
    await expectAccessible(page, 'Restore a category, refused', { inPlace: true });

    // Once that one is renamed, restored at the version it was removed at.
    await editedMeanwhile(taker, { name: 'Demo: Spare shelf two' });
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}\\?done=restored&preset=${spare}$`));
    await expect(page.getByRole('heading', { name: 'Restored: Demo: Spare shelf' })).toBeFocused();
    const back = page.getByRole('region', { name: 'Demo: Spare shelf', exact: true });
    await expect(fact(back, 'What it holds')).toHaveText('Medications');
    const history = back.getByRole('region', { name: 'History of Demo: Spare shelf' });
    await expect(history.getByRole('row', { name: /Removed, version 1/ })).toContainText(
      'Demo: not needed now',
    );
    await expect(history.getByRole('row', { name: /Restored, version 1/ })).toContainText(
      'Demo: needed again',
    );
    expect((await categories()).find((c) => c.id === spare)).toMatchObject({ state: 'active', version: 1 });

    await expectNothingStored(page, 'Categories after a restore');
    expectOnlyIds(traffic.addresses);
  });

  test('a stale sign-in sends a category being added through /reauth and back to the page, adding nothing', async ({
    page,
  }) => {
    const stale = await fetch(`${IDP}/test/stale-sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', minutes: 60 }),
    });
    expect(stale.status).toBe(200);
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Add a category' });
    await form.getByLabel('Name', { exact: true }).fill('Demo: Never added');
    await form.getByRole('radio', { name: 'Supplies' }).check();
    await form.getByLabel('Reason').fill('Demo: an old sign-in');
    await form.getByRole('button', { name: 'Add category' }).click();
    await expect(page).toHaveURL(/\/reauth\?next=%2Fteam%2Fpresets%2Fcategories$/);
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Categories');
    expect((await categories()).some((c) => c.name === 'Demo: Never added')).toBe(false);
  });

  test('staff without the permission are refused Categories at a typed address, logged once', async ({
    page,
  }) => {
    await signIn(page, 'clinician@example.com');
    const before = (await deniedOf('clinician@example.com')).length;
    await page.goto(PAGE);
    await expect(page).toHaveURL(/\/home\?denied=1$/);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Your role doesn’t allow that screen. The attempt was logged.',
    );
    const after = await deniedOf('clinician@example.com');
    // The list was asked, and refused: no history was.
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
  });
});

// ------------------------------------------------------------------------------------------------
// What the item and bundle pages read and write, as another admin would through the API
// ------------------------------------------------------------------------------------------------

type Row<B> = {
  id: string;
  name: string;
  state: 'active' | 'archived';
  version: number;
  updateOnOffer: boolean;
  referencedBy: Record<string, number>;
  body: B;
};

type ItemBody = {
  name: string;
  categoryId: string;
  unit: string;
  medical: boolean;
  captureLot: boolean;
  result: null | { type: 'choice'; options: string[] } | { type: 'number'; unit: string };
};

type BundleBody = {
  name: string;
  medical: boolean;
  prompt: string;
  lines: { itemId: string; qty: number; core: boolean }[];
};

type CategoryBody = { name: string; behaviour: 'supply' | 'medication' | 'lab'; sort: number };

/** A kind's presets as the API lists them to a Program Admin, A to Z, archived ones included. */
async function listed<B>(kind: string): Promise<Row<B>[]> {
  const res = await apiCall(await staffToken('admin@example.com'), 'GET', `/v1/admin/presets/${kind}`);
  expect(res.status, kind).toBe(200);
  return (await res.json()) as Row<B>[];
}

/** The active preset of the kind with this name. */
async function named<B>(kind: string, name: string): Promise<Row<B>> {
  const row = (await listed<B>(kind)).find((p) => p.name === name && p.state === 'active');
  expect(row, `${kind} ${name}`).toBeDefined();
  return row!;
}

/** A preset made as another admin would make it; its ID. */
async function made(kind: string, body: Record<string, unknown>): Promise<string> {
  const res = await apiCall(await staffToken('admin@example.com'), 'POST', `/v1/admin/presets/${kind}`, {
    body,
    reason: 'Demo: set up for a test',
  });
  expect(res.status, `${kind} ${String(body.name)}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Another admin's edit, at the version the preset is at now; its new version. */
async function changedMeanwhile<B>(kind: string, id: string, change: (body: B) => B): Promise<number> {
  const now = (await listed<B>(kind)).find((p) => p.id === id)!;
  const res = await apiCall(await staffToken('admin@example.com'), 'PUT', `/v1/admin/presets/${kind}/${id}`, {
    baseVersion: now.version,
    body: change(now.body),
    reason: 'Demo: another admin’s change',
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

/** Another admin's act on a preset: archive it at the version it is at, or restore it. */
async function actedMeanwhile(kind: string, id: string, act: 'archive' | 'restore') {
  const now = (await listed(kind)).find((p) => p.id === id)!;
  const res = await apiCall(
    await staffToken('admin@example.com'),
    'POST',
    `/v1/admin/presets/${kind}/${id}/${act}`,
    act === 'archive'
      ? { baseVersion: now.version, reason: 'Demo: another admin’s act' }
      : { reason: 'Demo: another admin’s act' },
  );
  expect(res.status, `${act} ${now.name}`).toBe(200);
}

// As the API sorts names (routes/presets-admin.ts), and the pages after it.
const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** The team's active categories by their place in the list, as the pages list them. */
const byPlace = (rows: Row<CategoryBody>[]) =>
  rows
    .filter((c) => c.state === 'active')
    .sort((a, b) => a.body.sort - b.body.sort || byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));

/** "Still used by 1 bundle and 1 bag", as a list row counts what names a preset. */
const usedByOf = (referencedBy: Record<string, number>) => {
  const nouns: Record<string, [string, string]> = {
    bundle: ['bundle', 'bundles'],
    field_supply_map: ['mapping', 'mappings'],
    condition_supply_map: ['condition mapping', 'condition mappings'],
    bag: ['bag', 'bags'],
  };
  const parts = Object.keys(nouns)
    .filter((k) => (referencedBy[k] ?? 0) > 0)
    .map((k) => `${referencedBy[k]} ${referencedBy[k] === 1 ? nouns[k]![0] : nouns[k]![1]}`);
  if (referencedBy.settings) parts.push('the template for new bags');
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
};

/**
 * A category with a long name, made once: the item forms' Category select offers it, so a reflow
 * check at 320 px also checks the select never widens the page, whichever cases ran before.
 */
async function longCategory(): Promise<void> {
  const name = 'Demo: Supplies for the winter outreach van and the shelter';
  if ((await listed('order_category')).some((c) => c.name === name)) return;
  await made('order_category', { name, behaviour: 'supply', sort: 990 });
}

const STALE = 'Someone else changed this while you were editing. Reload to see their version.';

/** A stale sign-in for the admin: their next write goes through /reauth. */
async function staleSignIn() {
  const stale = await fetch(`${IDP}/test/stale-sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', minutes: 60 }),
  });
  expect(stale.status).toBe(200);
}

// ------------------------------------------------------------------------------------------------
// Items (8.1): grouped by category, A to Z, with a search box; Add an item
// ------------------------------------------------------------------------------------------------

test.describe('items, /team/presets/items', () => {
  const PAGE = '/team/presets/items';

  /** The groups the page shows: each category with active items, in its place, its items A to Z. */
  async function expectedGroups() {
    const items = (await listed<ItemBody>('item')).filter((i) => i.state === 'active');
    return byPlace(await listed<CategoryBody>('order_category'))
      .map((c) => ({ name: c.name, items: items.filter((i) => i.body.categoryId === c.id) }))
      .filter((g) => g.items.length > 0);
  }

  test('@responsive a Program Admin opens Items from the hub and finds them by category, A to Z, and searches them in the page, accessible in all three themes', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await page.goto('/team/presets');
    await page.getByRole('main').getByRole('link', { name: 'Items', exact: true }).click();
    await expect(page).toHaveURL(/\/team\/presets\/items$/);
    await expect(page).toHaveTitle('Items · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Items');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const groups = await expectedGroups();
    const removed = (await listed('item')).filter((i) => i.state === 'archived').length;
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2 })).toHaveText([
      ...groups.map((g) => g.name),
      'Add an item',
      ...(removed > 0 ? [`Removed (${removed})`] : []),
    ]);
    // The platform's categories that hold items, in their place (PRD main 104).
    expect(groups.map((g) => g.name).filter((n) => ['OTC', 'Rx', 'Labs', 'Supplies'].includes(n))).toEqual([
      'OTC',
      'Rx',
      'Labs',
      'Supplies',
    ]);
    for (const g of groups) {
      const region = main.getByRole('region', { name: g.name, exact: true });
      // A to Z, as the API sorts names, each opening its own page by its ID.
      await expect(region.getByRole('link')).toHaveText(g.items.map((i) => i.name));
    }
    const gauze = groups.flatMap((g) => g.items).find((i) => i.name === 'Gauze')!;
    const supplies = main.getByRole('region', { name: 'Supplies', exact: true });
    await expect(supplies.getByRole('link', { name: 'Gauze', exact: true })).toHaveAttribute(
      'href',
      `${PAGE}/${gauze.id}`,
    );
    await expect(supplies.getByRole('listitem').filter({ hasText: /^Gauze/ })).toContainText(
      'Counted in each · Non-Medical',
    );
    // The seeded team holds the platform's version of each: nothing is on offer.
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);

    const add = page.getByRole('form', { name: 'Add an item' });
    await expect(add.getByLabel('Counted in')).toHaveAccessibleDescription(
      '1 means one of these, for example 1 tablet or 1 packet. This can’t be changed later. Don’t put patient names here.',
    );
    await expect(add.getByRole('group', { name: 'Result' })).toHaveAccessibleDescription(
      'Only an item in a category that holds tests records a result. What kind of result it records can’t be changed later.',
    );
    await expect(add.getByRole('radio', { name: 'None' })).toBeChecked();
    await expect(add.getByLabel('Medical', { exact: true })).not.toBeChecked();

    await expectAccessible(page, PAGE);
    await expectReflow(page, PAGE);

    // The search narrows the list as it is typed, in the page alone, and says what it found.
    const all = groups.reduce((n, g) => n + g.items.length, 0);
    const vaccines = groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.name.toLowerCase().includes('vaccine')) }))
      .filter((g) => g.items.length > 0);
    const found = vaccines.reduce((n, g) => n + g.items.length, 0);
    expect(found).toBeGreaterThanOrEqual(8);
    const search = page.getByRole('search', { name: 'Items' }).getByLabel('Search items');
    await search.fill('VACCINE');
    await expect(page.getByRole('search').getByRole('status')).toHaveText(`${found} of ${all} items found.`);
    await expect(main.getByRole('heading', { level: 2 })).toHaveText([
      ...vaccines.map((g) => g.name),
      'Add an item',
      ...(removed > 0 ? [`Removed (${removed})`] : []),
    ]);
    await expect(main.getByRole('region', { name: 'Rx', exact: true }).getByRole('link')).toHaveText(
      vaccines.find((g) => g.name === 'Rx')!.items.map((i) => i.name),
    );
    await expectAccessible(page, 'Items, searched', { inPlace: true });
    await expectReflow(page, 'Items, searched');
    await search.fill('Demo: nothing is called this');
    await expect(page.getByText('No item’s name holds that.')).toBeVisible();
    await expect(page.getByRole('search').getByRole('status')).toHaveText(`0 of ${all} items found.`);
    await search.fill('');
    await expect(main.getByRole('heading', { level: 2 })).toHaveCount(
      groups.length + 1 + (removed > 0 ? 1 : 0),
    );
    // Nothing typed reached an address.
    expect(page.url()).toMatch(/\/team\/presets\/items$/);
    expect(await traffic.carrying('nothing is called this')).toEqual([]);

    await expectNothingStored(page, PAGE);
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('adding an item asks for a reason, then each field, says each problem beside its field, keeps what was typed, and lists the new one under its category', async ({
    page,
  }) => {
    test.slow();
    await longCategory();
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Add an item' });
    const name = form.getByLabel('Name', { exact: true });
    const unit = form.getByLabel('Counted in');
    const category = form.getByLabel('Category');
    const reason = form.getByLabel('Reason');
    const add = form.getByRole('button', { name: 'Add item' });
    const alert = form.getByRole('alert');
    const title = alert.locator('.px-alert__title');

    // Nothing typed: the reason is asked first, as the API reads the request before the body.
    await add.click();
    await expect(alert).toBeFocused();
    await expect(alert).toContainText('Give a reason of 3 to 300 characters.');

    // A reason, and nothing else: each field said beside it, the reason kept.
    await reason.fill('Demo: ketone strips for the van');
    await add.click();
    await expect(title).toHaveText('Some fields need changing. Check each one below.');
    await expect(alert.getByRole('link')).toHaveText([
      'Name: This is too short or too small.',
      'Category: Choose one from the list.',
      'Counted in: Enter 1 to 20 characters, such as tablet or packet.',
    ]);
    await expect(reason).toHaveValue('Demo: ketone strips for the van');
    await expectAccessible(page, 'Add an item, refused', { inPlace: true });
    await expectReflow(page, 'Add an item, refused');
    await alert.getByRole('link', { name: 'Category: Choose one from the list.' }).click();
    await expect(category).toBeFocused();

    // A test with no result, not Medical: the team's rules for a Labs item, each beside its field.
    await name.fill('Demo: Ketone test');
    await category.selectOption({ label: 'Labs' });
    await unit.fill('strip');
    await add.click();
    await expect(alert.getByRole('link')).toHaveText([
      'Result: An item records a result exactly when its category holds tests.',
      'Medical: An item in a category that holds medications or tests is always Medical.',
    ]);
    await expect(name).toHaveValue('Demo: Ketone test');
    await expect(unit).toHaveValue('strip');
    await expect(category.locator('option:checked')).toHaveText('Labs');
    await expect(form.getByRole('group', { name: 'Result' })).toContainText(
      'An item records a result exactly when its category holds tests.',
    );

    // A choice from a list with one option twice: said beside that option, the options kept.
    await form.getByLabel('Medical', { exact: true }).check();
    await form.getByRole('radio', { name: 'A choice from a list' }).check();
    const options = form.getByRole('group', { name: 'Options' });
    await expect(options).toHaveAccessibleDescription(
      'The answers staff choose from, such as Positive and Negative: 2 to 12 of them.',
    );
    await options.getByLabel('Option 1', { exact: true }).fill('Positive');
    await options.getByLabel('Option 2', { exact: true }).fill('positive');
    await add.click();
    await expect(alert.getByRole('link')).toHaveText(['Option 2: This option is on the list twice.']);
    await expect(options.getByLabel('Option 2', { exact: true })).toHaveValue('positive');
    await expect(form.getByLabel('Medical', { exact: true })).toBeChecked();
    await expectAccessible(page, 'Add an item, an option twice', { inPlace: true });
    await expectReflow(page, 'Add an item, an option twice');

    // Another item's name, in other letters: refused beside the name.
    await name.fill('gauze');
    await options.getByLabel('Option 2', { exact: true }).fill('Negative');
    await add.click();
    await expect(title).toHaveText('Another item already has this name.');
    await expect(name).toHaveValue('gauze');

    // A number in its unit: added, under Labs.
    await name.fill('Demo: Ketone test');
    await form.getByRole('radio', { name: 'A number' }).check();
    await form.getByLabel('Unit of the result').fill('mmol/L');
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Ketone test. It’s on the phones after their next sync.',
    );
    const labs = await named<CategoryBody>('order_category', 'Labs');
    const ketone = await named<ItemBody>('item', 'Demo: Ketone test');
    expect(ketone).toMatchObject({
      version: 1,
      body: {
        name: 'Demo: Ketone test',
        categoryId: labs.id,
        unit: 'strip',
        medical: true,
        captureLot: false,
        result: { type: 'number', unit: 'mmol/L' },
      },
    });
    await expect(
      page
        .getByRole('region', { name: 'Labs', exact: true })
        .getByRole('listitem')
        .filter({ hasText: 'Demo: Ketone test' }),
    ).toContainText('Counted in strip · Medical · Records a number in mmol/L');
    // The form is ready for the next one.
    await expect(name).toHaveValue('');
    await expect(unit).toHaveValue('');
    await expect(reason).toHaveValue('');
    await expect(form.getByRole('radio', { name: 'None' })).toBeChecked();
    await expect(form.getByLabel('Unit of the result')).toHaveCount(0);
    await expect(form.getByLabel('Medical', { exact: true })).not.toBeChecked();

    // Another added on the first try, with nothing refused before it: the form starts afresh again.
    await name.fill('Demo: Lactate test');
    await category.selectOption({ label: 'Labs' });
    await unit.fill('strip');
    await form.getByLabel('Medical', { exact: true }).check();
    await form.getByRole('radio', { name: 'A number' }).check();
    await form.getByLabel('Unit of the result').fill('mmol/L');
    await reason.fill('Demo: lactate strips for the van');
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Lactate test. It’s on the phones after their next sync.',
    );
    await expect(form.getByRole('radio', { name: 'None' })).toBeChecked();
    await expect(form.getByLabel('Unit of the result')).toHaveCount(0);
    await expect(name).toHaveValue('');

    await expectNothingStored(page, 'Items after an add');
    expectOnlyIds(traffic.addresses);
  });

  test('a stale sign-in sends an item being added through /reauth and back to the page, adding nothing', async ({
    page,
  }) => {
    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Add an item' });
    await form.getByLabel('Name', { exact: true }).fill('Demo: Never added item');
    await form.getByLabel('Category').selectOption({ label: 'Supplies' });
    await form.getByLabel('Counted in').fill('each');
    await form.getByLabel('Reason').fill('Demo: an old sign-in');
    await form.getByRole('button', { name: 'Add item' }).click();
    await expect(page).toHaveURL(/\/reauth\?next=%2Fteam%2Fpresets%2Fitems$/);
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Items');
    expect((await listed('item')).some((i) => i.name === 'Demo: Never added item')).toBe(false);
  });

  test('staff without the permission are refused Items at a typed address, logged once', async ({ page }) => {
    await signIn(page, 'clinician@example.com');
    const before = (await deniedOf('clinician@example.com')).length;
    await page.goto(PAGE);
    await expect(page).toHaveURL(/\/home\?denied=1$/);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Your role doesn’t allow that screen. The attempt was logged.',
    );
    const after = await deniedOf('clinician@example.com');
    // The items were asked, and refused: the categories never were.
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
  });
});

// ------------------------------------------------------------------------------------------------
// An item's own page (8.1): its form, Remove and Restore, and its history
// ------------------------------------------------------------------------------------------------

test.describe('an item, /team/presets/items/[id]', () => {
  const LIST = '/team/presets/items';

  /** An item of the team's own in a category, as another admin would add it; its ID. */
  async function itemIn(category: string, body: Partial<ItemBody> & { name: string }): Promise<string> {
    const { id: categoryId } = await named<CategoryBody>('order_category', category);
    return made('item', {
      unit: 'each',
      medical: false,
      captureLot: false,
      result: null,
      categoryId,
      ...body,
    });
  }

  test('@responsive a Program Admin opens an item from the list and finds its form as the item is, accessible in all three themes', async ({
    page,
  }) => {
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    const gauze = await named<ItemBody>('item', 'Gauze');
    await page.goto(LIST);
    await page
      .getByRole('region', { name: 'Supplies', exact: true })
      .getByRole('link', { name: 'Gauze', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${gauze.id}$`));
    await expect(page).toHaveTitle('Item · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gauze');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const used = usedByOf(gauze.referencedBy);
    expect(used).not.toBe('');
    await expect(page.getByRole('main').locator('.px-lede')).toHaveText(
      `In Supplies, counted in each. Used by ${used}.`,
    );

    const form = page.getByRole('form', { name: 'Edit Gauze' });
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Gauze');
    await expect(form.getByLabel('Category').locator('option:checked')).toHaveText('Supplies');
    const unit = form.getByLabel('Counted in');
    await expect(unit).toHaveValue('each');
    await expect(unit).not.toBeEditable();
    await expect(unit).toHaveAccessibleDescription(
      '1 means one of these, for example 1 tablet or 1 packet. This can’t be changed later.',
    );
    await expect(form.getByLabel('Medical', { exact: true })).not.toBeChecked();
    await expect(form.getByLabel('Capture lot and expiry')).not.toBeChecked();
    await expect(form.getByLabel('Result', { exact: true })).toHaveValue('None');
    await expect(form.getByLabel('Result', { exact: true })).not.toBeEditable();
    await expect(form.getByLabel('Reason')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Remove Gauze', exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'History' })
        .getByRole('row', { name: /Added by Sineobex, version 1/ }),
    ).toHaveCount(1);
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);

    const here = `${LIST}/${gauze.id}`;
    await expectAccessible(page, here);
    await expectReflow(page, here);
    await expectNothingStored(page, here);
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('editing an item saves it with a reason; nothing changed, a move under a Non-Medical bundle, a Medical item made not, a move into Labs and an edit made stale meanwhile are each refused with their sentence', async ({
    page,
  }) => {
    test.slow();
    await longCategory();
    const id = await itemIn('Supplies', { name: 'Demo: Wool socks', unit: 'pair' });
    await made('bundle', {
      name: 'Demo: Cold feet',
      medical: false,
      prompt: '',
      lines: [{ itemId: id, qty: 1, core: true }],
    });
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(`${LIST}/${id}`);
    let form = page.getByRole('form', { name: 'Edit Demo: Wool socks' });
    const category = form.getByLabel('Category');
    const medical = form.getByLabel('Medical', { exact: true });
    const reason = form.getByLabel('Reason');
    const save = form.getByRole('button', { name: 'Save' });
    const alert = form.getByRole('alert');

    // Saved as it is: nothing changed.
    await reason.fill('Demo: socks are a medication now');
    await save.click();
    await expect(alert).toHaveText('You haven’t changed anything.');

    // Into a medication category while a Non-Medical bundle holds it: 8.1's sentence, kept as typed.
    await category.selectOption({ label: 'OTC' });
    await medical.check();
    await save.click();
    await expect(alert).toHaveText(
      'Non-Medical bundles hold this item, and a bundle that holds a medication must be Medical. Make them Medical first.',
    );
    await expect(category.locator('option:checked')).toHaveText('OTC');
    await expect(medical).toBeChecked();
    await expect(reason).toHaveValue('Demo: socks are a medication now');
    await expectAccessible(page, 'Edit an item, under a Non-Medical bundle', { inPlace: true });
    await expectReflow(page, 'Edit an item, under a Non-Medical bundle');
    expect((await listed<ItemBody>('item')).find((i) => i.id === id)).toMatchObject({ version: 1 });

    // In a medication category, not Medical: said beside Medical.
    await category.selectOption({ label: 'Rx' });
    await medical.uncheck();
    await save.click();
    await expect(alert.getByRole('link')).toHaveText([
      'Medical: An item in a category that holds medications or tests is always Medical.',
    ]);
    await expect(medical).not.toBeChecked();

    // Into Labs: what it records can't change, so the move is said beside the result.
    await category.selectOption({ label: 'Labs' });
    await medical.check();
    await save.click();
    const result = alert.getByRole('link', {
      name: 'Result: An item records a result exactly when its category holds tests.',
    });
    await expect(result).toBeVisible();
    await expectAccessible(page, 'Edit an item, into Labs', { inPlace: true });
    await result.click();
    await expect(form.getByLabel('Result', { exact: true })).toBeFocused();

    // Renamed, ticked to record its lot, and kept in Supplies: saved, with its history.
    await category.selectOption({ label: 'Supplies' });
    await medical.uncheck();
    await form.getByLabel('Name', { exact: true }).fill('Demo: Warm wool socks');
    await form.getByLabel('Capture lot and expiry').check();
    await reason.fill('Demo: we record the lot now');
    await save.click();
    form = page.getByRole('form', { name: 'Edit Demo: Warm wool socks' });
    await expect(form.getByRole('status')).toHaveText(
      'Saved: Demo: Warm wool socks. It’s on the phones after their next sync.',
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo: Warm wool socks');
    const supplies = await named<CategoryBody>('order_category', 'Supplies');
    expect((await listed<ItemBody>('item')).find((i) => i.id === id)).toMatchObject({
      version: 2,
      body: {
        name: 'Demo: Warm wool socks',
        categoryId: supplies.id,
        unit: 'pair',
        medical: false,
        captureLot: true,
        result: null,
      },
    });
    await expect(form.getByLabel('Capture lot and expiry')).toBeChecked();
    await expect(form.getByLabel('Reason')).toHaveValue('');
    await expect(
      page.getByRole('region', { name: 'History' }).getByRole('row', { name: /Edited, version 2/ }),
    ).toContainText('Demo: we record the lot now');

    // Another admin edits it meanwhile: this form, at version 2, is stale, and stays so.
    expect(await changedMeanwhile<ItemBody>('item', id, (b) => ({ ...b, captureLot: false }))).toBe(3);
    await form.getByLabel('Name', { exact: true }).fill('Demo: Wool socks, warm');
    await form.getByLabel('Reason').fill('Demo: a better name');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(STALE);
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Demo: Wool socks, warm');
    await expectAccessible(page, 'Edit an item, stale', { inPlace: true });
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(STALE);
    // Reloaded, the page shows their version.
    await page.reload();
    await expect(
      page.getByRole('form', { name: 'Edit Demo: Warm wool socks' }).getByLabel('Capture lot and expiry'),
    ).not.toBeChecked();
    await expectNothingStored(page, 'An item after an edit');
    expectOnlyIds(traffic.addresses);
  });

  test('a test’s options change on its page, each problem said beside its option', async ({ page }) => {
    test.slow();
    const id = await itemIn('Labs', {
      name: 'Demo: Strep test',
      unit: 'test',
      medical: true,
      result: { type: 'choice', options: ['Positive', 'Negative'] },
    });
    await signIn(page, 'admin@example.com');
    await page.goto(`${LIST}/${id}`);
    const form = page.getByRole('form', { name: 'Edit Demo: Strep test' });
    const result = form.getByRole('group', { name: 'Result' });
    await expect(result).toHaveAccessibleDescription(
      'It records a choice from a list. What kind of result it records can’t be changed later; its options can.',
    );
    await expect(result.getByRole('radio')).toHaveCount(0);
    const options = form.getByRole('group', { name: 'Options' });
    await expect(options.getByRole('textbox')).toHaveCount(2);

    // A third option, given in other letters as the first: said beside it, the options kept.
    await options.getByRole('button', { name: 'Add an option' }).click();
    await options.getByLabel('Option 3', { exact: true }).fill('positive');
    await form.getByLabel('Reason').fill('Demo: some results are unclear');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert').getByRole('link')).toHaveText([
      'Option 3: This option is on the list twice.',
    ]);
    await expect(options.getByLabel('Option 3', { exact: true })).toHaveValue('positive');
    await expect(options.getByLabel('Option 3', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page, 'Edit a test, an option twice', { inPlace: true });
    await expectReflow(page, 'Edit a test, an option twice');

    await options.getByLabel('Option 3', { exact: true }).fill('Unclear');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('status')).toHaveText(
      'Saved: Demo: Strep test. It’s on the phones after their next sync.',
    );
    expect((await listed<ItemBody>('item')).find((i) => i.id === id)).toMatchObject({
      version: 2,
      body: { result: { type: 'choice', options: ['Positive', 'Negative', 'Unclear'] } },
    });

    // Down to one option: the API asks for two, and the page says so.
    await options.getByRole('button', { name: 'Take out option 3' }).click();
    await options.getByRole('button', { name: 'Take out option 2' }).click();
    await form.getByLabel('Reason').fill('Demo: one answer is enough');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert').getByRole('link')).toHaveText(['Options: Give 2 to 12 options.']);
    await expect(options.getByRole('textbox')).toHaveCount(1);
  });

  test('Remove refuses an item a bundle holds, saying what holds it; an unused one goes to the Removed list, and Restore on its page brings it back', async ({
    page,
  }) => {
    test.slow();
    const held = await itemIn('Supplies', { name: 'Demo: Ice packs' });
    await made('bundle', {
      name: 'Demo: Sprain care',
      medical: false,
      prompt: '',
      lines: [{ itemId: held, qty: 2, core: true }],
    });
    const spare = await itemIn('Supplies', { name: 'Demo: Spare gloves', unit: 'pair' });
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);

    // Held by a bundle: it stays, and the page says what holds it.
    await page.goto(`${LIST}/${held}`);
    await page.getByRole('button', { name: 'Remove Demo: Ice packs', exact: true }).click();
    const refused = page.getByRole('form', { name: 'Remove Demo: Ice packs' });
    await refused.getByLabel('Reason').fill('Demo: trying to remove it');
    await refused.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(refused.getByRole('alert')).toHaveText(
      'Still used by 1 bundle. Take it out of those first.',
    );
    await expectAccessible(page, 'Remove an item, refused', { inPlace: true });
    expect((await listed('item')).find((i) => i.id === held)).toMatchObject({ state: 'active' });

    // Unused: removed, and the list says so.
    await page.goto(`${LIST}/${spare}`);
    await page.getByRole('button', { name: 'Remove Demo: Spare gloves', exact: true }).click();
    const remove = page.getByRole('form', { name: 'Remove Demo: Spare gloves' });
    await remove.getByLabel('Reason').fill('Demo: we have none left');
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?done=removed&preset=${spare}$`));
    await expect(page.getByRole('heading', { name: 'Removed: Demo: Spare gloves' })).toBeFocused();
    await expect(
      page
        .getByRole('region', { name: 'Supplies', exact: true })
        .getByRole('link', { name: 'Demo: Spare gloves' }),
    ).toHaveCount(0);
    await expect(page.getByRole('region', { name: /^Removed \(\d+\)$/ })).toContainText('Demo: Spare gloves');
    await expectAccessible(page, 'Items after a remove');

    // Its own page says it is removed, and restores it there.
    await page.goto(`${LIST}/${spare}`);
    await expect(page.getByRole('form', { name: 'Edit Demo: Spare gloves' })).toHaveCount(0);
    const gone = page.getByRole('region', { name: 'Removed', exact: true });
    await expect(gone).toContainText('This item isn’t offered for new work. Restore it to offer it again.');
    await expectAccessible(page, 'A removed item');
    await gone.getByLabel('Reason').fill('Demo: a box came in');
    await gone.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${spare}\\?done=restored&preset=${spare}$`));
    await expect(page.getByRole('heading', { name: 'Restored: Demo: Spare gloves' })).toBeFocused();
    await expect(page.getByRole('form', { name: 'Edit Demo: Spare gloves' })).toBeVisible();
    const history = page.getByRole('region', { name: 'History' });
    await expect(history.getByRole('row', { name: /Removed, version 1/ })).toContainText(
      'Demo: we have none left',
    );
    await expect(history.getByRole('row', { name: /Restored, version 1/ })).toContainText(
      'Demo: a box came in',
    );
    expect((await listed('item')).find((i) => i.id === spare)).toMatchObject({ state: 'active', version: 1 });

    await expectNothingStored(page, 'An item after a restore');
    expectOnlyIds(traffic.addresses);
  });

  test('an address that names no item of the team’s is no page', async ({ page }) => {
    await signIn(page, 'admin@example.com');
    const category = await named<CategoryBody>('order_category', 'Labs');
    for (const id of ['30e00000-0000-4000-8000-0000000000ff', category.id, 'not-an-id']) {
      await page.goto(`${LIST}/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    }
  });

  test('a stale sign-in sends an item being saved through /reauth and back to its page, saving nothing', async ({
    page,
  }) => {
    const id = await itemIn('Supplies', { name: 'Demo: Rain hats' });
    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(`${LIST}/${id}`);
    const form = page.getByRole('form', { name: 'Edit Demo: Rain hats' });
    await form.getByLabel('Name', { exact: true }).fill('Demo: Rain caps');
    await form.getByLabel('Reason').fill('Demo: an old sign-in');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(new RegExp(`/reauth\\?next=${encodeURIComponent(`${LIST}/${id}`)}$`));
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo: Rain hats');
    expect((await listed('item')).find((i) => i.id === id)).toMatchObject({
      version: 1,
      name: 'Demo: Rain hats',
    });
  });

  test('staff without the permission are refused an item at a typed address, logged once', async ({
    page,
  }) => {
    const gauze = await named('item', 'Gauze');
    await signIn(page, 'clinician@example.com');
    const before = (await deniedOf('clinician@example.com')).length;
    await page.goto(`${LIST}/${gauze.id}`);
    await expect(page).toHaveURL(/\/home\?denied=1$/);
    const after = await deniedOf('clinician@example.com');
    // The items were asked, and refused: neither the categories nor the history were.
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
  });
});

// ------------------------------------------------------------------------------------------------
// Bundles (8.1): A to Z, each with its tag, its lines and its prompt; Add a bundle
// ------------------------------------------------------------------------------------------------

test.describe('bundles, /team/presets/bundles', () => {
  const PAGE = '/team/presets/bundles';

  /** "Medical · 3 items, 1 optional · Asks before applying", as the list says what a bundle is. */
  const summaryOf = (b: BundleBody) => {
    const optional = b.lines.filter((l) => !l.core).length;
    const n = b.lines.length;
    return [
      b.medical ? 'Medical' : 'Non-Medical',
      `${n} ${n === 1 ? 'item' : 'items'}${optional > 0 ? `, ${optional} optional` : ''}`,
      ...(b.prompt !== '' ? ['Asks before applying'] : []),
    ].join(' · ');
  };

  test('@responsive a Program Admin opens Bundles from the hub and finds them A to Z, each with what it is, accessible in all three themes', async ({
    page,
  }) => {
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await page.goto('/team/presets');
    await page.getByRole('main').getByRole('link', { name: 'Bundles', exact: true }).click();
    await expect(page).toHaveURL(/\/team\/presets\/bundles$/);
    await expect(page).toHaveTitle('Bundles · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bundles');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const all = await listed<BundleBody>('bundle');
    const active = all.filter((b) => b.state === 'active');
    const removed = all.length - active.length;
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2 })).toHaveText([
      'Your team’s bundles',
      'Add a bundle',
      ...(removed > 0 ? [`Removed (${removed})`] : []),
    ]);
    const list = main.getByRole('region', { name: 'Your team’s bundles' });
    // A to Z, as the API sorts names, each opening its own page by its ID.
    await expect(list.getByRole('link')).toHaveText(active.map((b) => b.name));
    for (const b of active)
      await expect(
        list.getByRole('listitem').filter({ has: page.getByRole('link', { name: b.name, exact: true }) }),
      ).toContainText(summaryOf(b.body));
    const rainy = active.find((b) => b.name === 'Demo: Rainy night')!;
    await expect(list.getByRole('link', { name: 'Demo: Rainy night' })).toHaveAttribute(
      'href',
      `${PAGE}/${rainy.id}`,
    );
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);

    const add = page.getByRole('form', { name: 'Add a bundle' });
    const tag = add.getByRole('group', { name: 'Medical or Non-Medical' });
    await expect(tag).toHaveAccessibleDescription('A bundle that holds a medication must be Medical.');
    await expect(tag.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(add.getByRole('group', { name: 'Items' })).toHaveAccessibleDescription(
      'A core item is ticked when the bundle is used; an optional one is left for staff to tick.',
    );
    await expect(add.getByLabel('Ask before applying (optional)')).toHaveAccessibleDescription(
      'Asked before the bundle is used, so a bundle never stands in for an assessment. Don’t put patient names here.',
    );

    await expectAccessible(page, PAGE);
    await expectReflow(page, PAGE);
    await expectNothingStored(page, PAGE);
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('adding a bundle asks for a reason, then each field, says each line’s problem on its line and a medication’s rule beside the tag, keeps what was typed, and lists the new one', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Add a bundle' });
    const name = form.getByLabel('Name', { exact: true });
    const reason = form.getByLabel('Reason');
    const add = form.getByRole('button', { name: 'Add bundle' });
    const alert = form.getByRole('alert');
    const title = alert.locator('.px-alert__title');
    const line = (n: number) => form.getByRole('group', { name: `Line ${n}`, exact: true });

    // Nothing typed: the reason is asked first, as the API reads the request before the body.
    await add.click();
    await expect(alert).toBeFocused();
    await expect(alert).toContainText('Give a reason of 3 to 300 characters.');

    // A reason, and nothing else: each field said beside it.
    await reason.fill('Demo: what we give for a burn');
    await add.click();
    await expect(title).toHaveText('Some fields need changing. Check each one below.');
    await expect(alert.getByRole('link')).toHaveText([
      'Name: This is too short or too small.',
      'Medical or Non-Medical: Choose Medical or Non-Medical.',
      'Items: Give the bundle 1 to 40 items.',
    ]);
    await expectAccessible(page, 'Add a bundle, refused', { inPlace: true });
    await expectReflow(page, 'Add a bundle, refused');
    await alert.getByRole('link', { name: 'Medical or Non-Medical: Choose Medical or Non-Medical.' }).click();
    await expect(form.getByRole('group', { name: 'Medical or Non-Medical' })).toBeFocused();

    // A line with no item, and a quantity that isn't one: each said on its line.
    await name.fill('Demo: Burn care');
    await form.getByRole('radio', { name: 'Non-Medical' }).check();
    await form.getByRole('button', { name: 'Add an item' }).click();
    await line(1).getByLabel('Quantity').fill('lots');
    await add.click();
    await expect(alert.getByRole('link')).toHaveText([
      'Item on line 1: Choose one from the list.',
      'Quantity on line 1: Enter a whole number from 1 to 99.',
    ]);
    await expect(line(1).getByLabel('Quantity')).toHaveValue('lots');
    await expect(line(1).getByLabel('Quantity')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page, 'Add a bundle, a line refused', { inPlace: true });
    await expectReflow(page, 'Add a bundle, a line refused');

    // A medication in a Non-Medical bundle: 8.1's sentence, beside the tag.
    await line(1).getByLabel('Item').selectOption({ label: 'Acetaminophen' });
    await line(1).getByLabel('Quantity').fill('2');
    await form.getByRole('button', { name: 'Add an item' }).click();
    await line(2).getByLabel('Item').selectOption({ label: 'Gauze' });
    await line(2).getByLabel('Core').uncheck();
    await add.click();
    await expect(title).toHaveText('This bundle holds a medication, so it must be Medical.');
    await expect(alert.getByRole('link')).toHaveText([
      'Medical or Non-Medical: This bundle holds a medication, so it must be Medical.',
    ]);
    await expect(form.getByRole('radio', { name: 'Non-Medical' })).toBeChecked();
    await expect(line(2).getByLabel('Core')).not.toBeChecked();
    await expectAccessible(page, 'Add a bundle, a medication not Medical', { inPlace: true });

    // One item on two lines: said on the later line.
    await form.getByRole('radio', { name: 'Medical', exact: true }).check();
    await line(2).getByLabel('Item').selectOption({ label: 'Acetaminophen' });
    await add.click();
    await expect(alert.getByRole('link')).toHaveText(['Item on line 2: This item is on the list twice.']);

    // Added, with its prompt, and listed.
    await line(2).getByLabel('Item').selectOption({ label: 'Gauze' });
    await form
      .getByLabel('Ask before applying (optional)')
      .fill('Demo: Ask how the burn happened before giving this bundle.');
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Burn care. It’s on the phones after their next sync.',
    );
    const acetaminophen = await named<ItemBody>('item', 'Acetaminophen');
    const gauze = await named<ItemBody>('item', 'Gauze');
    expect(await named<BundleBody>('bundle', 'Demo: Burn care')).toMatchObject({
      version: 1,
      body: {
        name: 'Demo: Burn care',
        medical: true,
        prompt: 'Demo: Ask how the burn happened before giving this bundle.',
        lines: [
          { itemId: acetaminophen.id, qty: 2, core: true },
          { itemId: gauze.id, qty: 1, core: false },
        ],
      },
    });
    await expect(
      page
        .getByRole('region', { name: 'Your team’s bundles' })
        .getByRole('listitem')
        .filter({ hasText: 'Demo: Burn care' }),
    ).toContainText('Medical · 2 items, 1 optional · Asks before applying');
    // The form is ready for the next one.
    await expect(name).toHaveValue('');
    await expect(form.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(form.getByRole('group', { name: 'Items' })).toContainText('None yet.');
    await expect(form.getByLabel('Ask before applying (optional)')).toHaveValue('');
    await expect(reason).toHaveValue('');

    // Another added on the first try, with nothing refused before it: its lines go with it.
    await name.fill('Demo: Bite care');
    await form.getByRole('radio', { name: 'Non-Medical' }).check();
    await form.getByRole('button', { name: 'Add an item' }).click();
    await line(1).getByLabel('Item').selectOption({ label: 'Gauze' });
    await reason.fill('Demo: what we give for a bite');
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Bite care. It’s on the phones after their next sync.',
    );
    await expect(form.getByRole('group', { name: 'Items' })).toContainText('None yet.');
    await expect(form.getByRole('group', { name: /^Line \d+$/ })).toHaveCount(0);

    await expectNothingStored(page, 'Bundles after an add');
    expectOnlyIds(traffic.addresses);
  });

  test('Restore refuses a Non-Medical bundle whose item became a medication while it was removed, in 8.1’s words', async ({
    page,
  }) => {
    const supplies = await named<CategoryBody>('order_category', 'Supplies');
    const otc = await named<CategoryBody>('order_category', 'OTC');
    const gel = await made('item', {
      name: 'Demo: Warming gel',
      categoryId: supplies.id,
      unit: 'tube',
      medical: false,
      captureLot: false,
      result: null,
    });
    const warm = await made('bundle', {
      name: 'Demo: Warm hands',
      medical: false,
      prompt: '',
      lines: [{ itemId: gel, qty: 1, core: true }],
    });
    await actedMeanwhile('bundle', warm, 'archive');
    // No active bundle holds the gel now, so it may become a medication.
    await changedMeanwhile<ItemBody>('item', gel, (b) => ({ ...b, categoryId: otc.id, medical: true }));

    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const removed = page.getByRole('region', { name: /^Removed \(\d+\)$/ });
    await removed.getByRole('button', { name: 'Restore Demo: Warm hands', exact: true }).click();
    const restore = removed.getByRole('form', { name: 'Restore Demo: Warm hands' });
    await restore.getByLabel('Reason').fill('Demo: winter again');
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(restore.getByRole('alert')).toHaveText(
      'This bundle now holds a medication, so it must be Medical. Add a Medical bundle instead.',
    );
    await expect(restore.getByLabel('Reason')).toHaveValue('Demo: winter again');
    await expectAccessible(page, 'Restore a bundle, refused', { inPlace: true });
    await expectReflow(page, 'Restore a bundle, refused');
    expect((await listed('bundle')).find((b) => b.id === warm)).toMatchObject({ state: 'archived' });
  });

  test('a stale sign-in sends a bundle being added through /reauth and back to the page, adding nothing', async ({
    page,
  }) => {
    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Add a bundle' });
    await form.getByLabel('Name', { exact: true }).fill('Demo: Never added bundle');
    await form.getByRole('radio', { name: 'Non-Medical' }).check();
    await form.getByRole('button', { name: 'Add an item' }).click();
    await form
      .getByRole('group', { name: 'Line 1', exact: true })
      .getByLabel('Item')
      .selectOption({ label: 'Gauze' });
    await form.getByLabel('Reason').fill('Demo: an old sign-in');
    await form.getByRole('button', { name: 'Add bundle' }).click();
    await expect(page).toHaveURL(/\/reauth\?next=%2Fteam%2Fpresets%2Fbundles$/);
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bundles');
    expect((await listed('bundle')).some((b) => b.name === 'Demo: Never added bundle')).toBe(false);
  });

  test('staff without the permission are refused Bundles at a typed address, logged once', async ({
    page,
  }) => {
    await signIn(page, 'clinician@example.com');
    const before = (await deniedOf('clinician@example.com')).length;
    await page.goto(PAGE);
    await expect(page).toHaveURL(/\/home\?denied=1$/);
    const after = await deniedOf('clinician@example.com');
    // The bundles were asked, and refused: the items never were.
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
  });
});

// ------------------------------------------------------------------------------------------------
// A bundle's own page (8.1): its form with its lines, Core and the prompt; Remove and Restore
// ------------------------------------------------------------------------------------------------

test.describe('a bundle, /team/presets/bundles/[id]', () => {
  const LIST = '/team/presets/bundles';

  /** A bundle of the team's own, as another admin would add it, its lines by their items' names; its ID. */
  async function bundleOf(
    name: string,
    medical: boolean,
    lines: [item: string, qty: number, core: boolean][],
    prompt = '',
  ): Promise<string> {
    const items = await listed<ItemBody>('item');
    return made('bundle', {
      name,
      medical,
      prompt,
      lines: lines.map(([item, qty, core]) => ({
        itemId: items.find((i) => i.name === item && i.state === 'active')!.id,
        qty,
        core,
      })),
    });
  }

  test('@responsive a Program Admin opens a bundle from the list and finds its form with its lines as the bundle is, accessible in all three themes', async ({
    page,
  }) => {
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    const rainy = await named<BundleBody>('bundle', 'Demo: Rainy night');
    const items = await listed<ItemBody>('item');
    const nameOf = (id: string) => items.find((i) => i.id === id)!.name;
    await page.goto(LIST);
    await page.getByRole('link', { name: 'Demo: Rainy night', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${rainy.id}$`));
    await expect(page).toHaveTitle('Bundle · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo: Rainy night');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('main').locator('.px-lede')).toHaveText(
      'Non-Medical · 3 items, 1 optional · Asks before applying',
    );

    const form = page.getByRole('form', { name: 'Edit Demo: Rainy night' });
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Demo: Rainy night');
    await expect(form.getByRole('radio', { name: 'Non-Medical' })).toBeChecked();
    for (const [i, line] of rainy.body.lines.entries()) {
      const group = form.getByRole('group', { name: `Line ${i + 1}`, exact: true });
      await expect(group.getByLabel('Item').locator('option:checked')).toHaveText(nameOf(line.itemId));
      await expect(group.getByLabel('Quantity')).toHaveValue(String(line.qty));
      if (line.core) await expect(group.getByLabel('Core')).toBeChecked();
      else await expect(group.getByLabel('Core')).not.toBeChecked();
    }
    await expect(form.getByRole('group', { name: /^Line \d+$/ })).toHaveCount(rainy.body.lines.length);
    const prompt = form.getByLabel('Ask before applying (optional)');
    await expect(prompt).toHaveValue(rainy.body.prompt);
    await expect(prompt).toHaveAccessibleDescription(
      'Asked before the bundle is used, so a bundle never stands in for an assessment. Don’t put patient names here.',
    );
    await expect(page.getByRole('button', { name: 'Remove Demo: Rainy night', exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'History' }).getByRole('row', { name: /Added, version 1/ }),
    ).toContainText('Demo: what we give on a wet night');

    const here = `${LIST}/${rainy.id}`;
    await expectAccessible(page, here);
    await expectReflow(page, here);
    await expectNothingStored(page, here);
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('editing a bundle saves its tag, lines, Core and prompt with a reason; nothing changed, a medication not Medical, an item twice and an edit made stale meanwhile are each refused with their sentence', async ({
    page,
  }) => {
    test.slow();
    const id = await bundleOf('Demo: Blister care', true, [['Acetaminophen', 1, true]]);
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(`${LIST}/${id}`);
    let form = page.getByRole('form', { name: 'Edit Demo: Blister care' });
    const line = (n: number) => form.getByRole('group', { name: `Line ${n}`, exact: true });
    const reason = form.getByLabel('Reason');
    const save = form.getByRole('button', { name: 'Save' });
    const alert = form.getByRole('alert');

    // Saved as it is: nothing changed.
    await reason.fill('Demo: plasters for long walks');
    await save.click();
    await expect(alert).toHaveText('You haven’t changed anything.');

    // Non-Medical while it holds a medication: 8.1's sentence, beside the tag, kept as chosen.
    await form.getByRole('radio', { name: 'Non-Medical' }).check();
    await save.click();
    await expect(alert.locator('.px-alert__title')).toHaveText(
      'This bundle holds a medication, so it must be Medical.',
    );
    await expect(alert.getByRole('link')).toHaveText([
      'Medical or Non-Medical: This bundle holds a medication, so it must be Medical.',
    ]);
    await expect(form.getByRole('radio', { name: 'Non-Medical' })).toBeChecked();
    await expectAccessible(page, 'Edit a bundle, a medication not Medical', { inPlace: true });
    await expectReflow(page, 'Edit a bundle, a medication not Medical');

    // The same item on a second line: said on that line, the lines kept.
    await form.getByRole('radio', { name: 'Medical', exact: true }).check();
    await form.getByRole('button', { name: 'Add an item' }).click();
    await line(2).getByLabel('Item').selectOption({ label: 'Acetaminophen' });
    await save.click();
    await expect(alert.getByRole('link')).toHaveText(['Item on line 2: This item is on the list twice.']);
    await expect(line(2).getByLabel('Item').locator('option:checked')).toHaveText('Acetaminophen');

    // That line taken out, another added: Gauze, two of them, optional; and a prompt.
    await line(2).getByRole('button', { name: 'Take out line 2' }).click();
    await expect(form.getByRole('group', { name: /^Line \d+$/ })).toHaveCount(1);
    await form.getByRole('button', { name: 'Add an item' }).click();
    await line(2).getByLabel('Item').selectOption({ label: 'Gauze' });
    await line(2).getByLabel('Quantity').fill('2');
    await line(2).getByLabel('Core').uncheck();
    await form.getByLabel('Ask before applying (optional)').fill('Demo: Ask how long they have walked.');
    await save.click();
    form = page.getByRole('form', { name: 'Edit Demo: Blister care' });
    await expect(form.getByRole('status')).toHaveText(
      'Saved: Demo: Blister care. It’s on the phones after their next sync.',
    );
    const acetaminophen = await named<ItemBody>('item', 'Acetaminophen');
    const gauze = await named<ItemBody>('item', 'Gauze');
    expect((await listed<BundleBody>('bundle')).find((b) => b.id === id)).toMatchObject({
      version: 2,
      body: {
        medical: true,
        prompt: 'Demo: Ask how long they have walked.',
        lines: [
          { itemId: acetaminophen.id, qty: 1, core: true },
          { itemId: gauze.id, qty: 2, core: false },
        ],
      },
    });
    await expect(page.getByRole('main').locator('.px-lede')).toHaveText(
      'Medical · 2 items, 1 optional · Asks before applying',
    );
    await expect(line(2).getByLabel('Core')).not.toBeChecked();
    await expect(form.getByLabel('Reason')).toHaveValue('');
    await expect(
      page.getByRole('region', { name: 'History' }).getByRole('row', { name: /Edited, version 2/ }),
    ).toContainText('Demo: plasters for long walks');

    // Another admin edits it meanwhile: this form, at version 2, is stale, and stays so.
    expect(await changedMeanwhile<BundleBody>('bundle', id, (b) => ({ ...b, prompt: '' }))).toBe(3);
    await form.getByLabel('Name', { exact: true }).fill('Demo: Blister kit');
    await form.getByLabel('Reason').fill('Demo: a shorter name');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(STALE);
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Demo: Blister kit');
    await expect(form.getByRole('group', { name: /^Line \d+$/ })).toHaveCount(2);
    await expectAccessible(page, 'Edit a bundle, stale', { inPlace: true });
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(STALE);
    // Reloaded, the page shows their version.
    await page.reload();
    await expect(
      page
        .getByRole('form', { name: 'Edit Demo: Blister care' })
        .getByLabel('Ask before applying (optional)'),
    ).toHaveValue('');
    await expectNothingStored(page, 'A bundle after an edit');
    expectOnlyIds(traffic.addresses);
  });

  test('Remove on a bundle’s page moves it to the Removed list, and Restore on its page brings it back', async ({
    page,
  }) => {
    test.slow();
    const id = await bundleOf('Demo: Spare kit', false, [['Gauze', 1, true]]);
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(`${LIST}/${id}`);
    await page.getByRole('button', { name: 'Remove Demo: Spare kit', exact: true }).click();
    const remove = page.getByRole('form', { name: 'Remove Demo: Spare kit' });
    await remove.getByLabel('Reason').fill('Demo: nobody uses it');
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?done=removed&preset=${id}$`));
    await expect(page.getByRole('heading', { name: 'Removed: Demo: Spare kit' })).toBeFocused();
    await expect(
      page
        .getByRole('region', { name: 'Your team’s bundles' })
        .getByRole('link', { name: 'Demo: Spare kit' }),
    ).toHaveCount(0);
    await expect(page.getByRole('region', { name: /^Removed \(\d+\)$/ })).toContainText('Demo: Spare kit');
    await expectAccessible(page, 'Bundles after a remove');

    await page.goto(`${LIST}/${id}`);
    await expect(page.getByRole('form', { name: 'Edit Demo: Spare kit' })).toHaveCount(0);
    const gone = page.getByRole('region', { name: 'Removed', exact: true });
    await expect(gone).toContainText('This bundle isn’t offered for new work. Restore it to offer it again.');
    await expectAccessible(page, 'A removed bundle');
    await gone.getByLabel('Reason').fill('Demo: needed after all');
    await gone.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${id}\\?done=restored&preset=${id}$`));
    await expect(page.getByRole('heading', { name: 'Restored: Demo: Spare kit' })).toBeFocused();
    await expect(page.getByRole('form', { name: 'Edit Demo: Spare kit' })).toBeVisible();
    const history = page.getByRole('region', { name: 'History' });
    await expect(history.getByRole('row', { name: /Removed, version 1/ })).toContainText(
      'Demo: nobody uses it',
    );
    await expect(history.getByRole('row', { name: /Restored, version 1/ })).toContainText(
      'Demo: needed after all',
    );

    await expectNothingStored(page, 'A bundle after a restore');
    expectOnlyIds(traffic.addresses);
  });

  test('an address that names no bundle of the team’s is no page', async ({ page }) => {
    await signIn(page, 'admin@example.com');
    const gauze = await named('item', 'Gauze');
    for (const id of ['30e00000-0000-4000-8000-0000000000fe', gauze.id, 'not-an-id']) {
      await page.goto(`${LIST}/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    }
  });

  test('a stale sign-in sends a bundle being saved through /reauth and back to its page, saving nothing', async ({
    page,
  }) => {
    const id = await bundleOf('Demo: Sun care', false, [['Gauze', 1, true]]);
    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(`${LIST}/${id}`);
    const form = page.getByRole('form', { name: 'Edit Demo: Sun care' });
    await form.getByLabel('Name', { exact: true }).fill('Demo: Sun cover');
    await form.getByLabel('Reason').fill('Demo: an old sign-in');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(new RegExp(`/reauth\\?next=${encodeURIComponent(`${LIST}/${id}`)}$`));
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo: Sun care');
    expect((await listed('bundle')).find((b) => b.id === id)).toMatchObject({
      version: 1,
      name: 'Demo: Sun care',
    });
  });

  test('staff without the permission are refused a bundle at a typed address, logged once', async ({
    page,
  }) => {
    const rainy = await named('bundle', 'Demo: Rainy night');
    await signIn(page, 'clinician@example.com');
    const before = (await deniedOf('clinician@example.com')).length;
    await page.goto(`${LIST}/${rainy.id}`);
    await expect(page).toHaveURL(/\/home\?denied=1$/);
    const after = await deniedOf('clinician@example.com');
    // The bundles were asked, and refused: nothing else was.
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
  });
});
