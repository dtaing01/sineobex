import { execFileSync } from 'node:child_process';
import { expect, test, type Locator } from '@playwright/test';
import {
  apiCall,
  customRole,
  expectAccessible,
  expectNothingStored,
  expectReflow,
  IDP,
  MFA_CODE,
  portalNav,
  setRole,
  signIn,
  staffToken,
  TEAM,
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

/**
 * The summary's title over the fields a refusal names, each in a line of its own that names its
 * field (lib/refusals.ts), so one sentence is never said twice.
 */
const FIELDS_TITLE = 'Some fields need changing. Check each one below.';

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

  test('only team.manage_presets opens Presets: every other seeded role is refused it, and a role holding that key alone has it', async ({
    page,
  }) => {
    test.slow();
    // The seeded members of every standard role but Program Admin, and the community health worker
    // preset: none holds the key, so none has the item, and the hub is refused at a typed address.
    for (const email of [
      'logistics@example.com',
      'resident@example.com',
      'billing@example.com',
      'chw@example.com',
    ]) {
      await signIn(page, email);
      await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true }), email).toHaveCount(0);
      await page.goto('/team/presets');
      await expect(page, email).toHaveURL(/\/home\?denied=1$/);
    }

    // The nav and the pages follow the key, not the role's name: a custom role of it alone opens them.
    const role = await customRole('Presets only', ['team.manage_presets']);
    await setRole('resident@example.com', role);
    try {
      await signIn(page, 'resident@example.com');
      const link = portalNav(page).getByRole('link', { name: 'Presets', exact: true });
      await link.click();
      await expect(page).toHaveURL(/\/team\/presets$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Presets');
      await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(AREAS.length);
      for (const area of AREAS) {
        await page.goto(area.href);
        await expect(page.getByRole('heading', { level: 1 }), area.title).toHaveText(area.title);
      }
    } finally {
      await setRole('resident@example.com', 'healthcare_staff');
    }
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

    // Nothing typed: the reason is asked first, as the API reads the request before the body. Its
    // line names the Reason box, under a title of its own, so the alert says it once.
    await add.click();
    await expect(alert).toBeFocused();
    await expect(alert.locator('.px-alert__title')).toHaveText(FIELDS_TITLE);
    await expect(alert.getByRole('link')).toHaveText(['Reason: Give a reason of 3 to 300 characters.']);
    await expect(
      form.getByText('Reason: Give a reason of 3 to 300 characters.', { exact: true }),
    ).toHaveCount(2);

    // A reason, and still no name and no choice: each said beside its field, the reason kept.
    await reason.fill('Demo: kits we hand out');
    await add.click();
    await expect(alert.locator('.px-alert__title')).toHaveText(
      'Some fields need changing. Check each one below.',
    );
    await expect(
      alert.getByRole('link', { name: 'Name: Enter a name of 1 to 80 characters.' }),
    ).toBeVisible();
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
    await expect(alert.locator('.px-alert__title')).toHaveText(FIELDS_TITLE);
    await expect(alert.getByRole('link')).toHaveText(['Name: Another category already has this name.']);
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
      `Still used by ${usedBy(otc)}. Take it out of ${otc.referencedBy.item === 1 ? 'that' : 'those'} first.`,
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

/**
 * A take refused stale (lib/refusals.ts, TAKE_STALE): the page is read again, so each says what
 * changed since the review instead of asking for a reload.
 */
const TAKE_STALE = {
  copyChanged:
    'Someone else changed this while you were reviewing the update. Review it again below before you take it.',
  noOffer:
    'Someone else changed this while you were reviewing the update, and there’s no update to take now.',
};

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
      'Name: Enter a name of 1 to 80 characters.',
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
    await expect(title).toHaveText(FIELDS_TITLE);
    await expect(alert.getByRole('link')).toHaveText(['Name: Another item already has this name.']);
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
    await expect(refused.getByRole('alert')).toHaveText('Still used by 1 bundle. Take it out of that first.');
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
      'Name: Enter a name of 1 to 80 characters.',
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

// ------------------------------------------------------------------------------------------------
// Flags (8.1): Risk level and Conditions, each by rank, with Move up and Move down; Add a flag
// ------------------------------------------------------------------------------------------------

type FlagBody = {
  name: string;
  tier: 'primary' | 'secondary';
  criteria: string;
  color: string;
  rank: number;
  sensitive: boolean;
};

/** The palette's names (packages/presets FLAG_COLORS), which every pill reads first. */
const COLOUR_NAMES: Record<string, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  grey: 'Grey',
};

/** A flag as staff see it: "Red · High". */
const pillOf = (f: Row<FlagBody>) => `${COLOUR_NAMES[f.body.color]} · ${f.name}`;

/** A tier's active flags as the page lists them: by rank, then by name as the API sorts names. */
async function tierOf(tier: 'primary' | 'secondary'): Promise<Row<FlagBody>[]> {
  return (await listed<FlagBody>('flag'))
    .filter((f) => f.state === 'active' && f.body.tier === tier)
    .sort((a, b) => a.body.rank - b.body.rank || byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
}

/** A condition of the team's own, made as another admin would make it, at the end of its list; its ID. */
async function madeCondition(name: string, color: string): Promise<string> {
  const ranks = (await listed<FlagBody>('flag'))
    .filter((f) => f.body.tier === 'secondary')
    .map((f) => f.body.rank);
  return made('flag', {
    name,
    tier: 'secondary',
    criteria: '',
    color,
    rank: Math.max(0, ...ranks) + 10,
    sensitive: false,
  });
}

/** A preset's history as the API answers it, oldest first. */
async function historyOf(kind: string, id: string) {
  const res = await apiCall(
    await staffToken('admin@example.com'),
    'GET',
    `/v1/admin/presets/${kind}/${id}/history`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { act: string; version: number; reason: string | null }[];
}

/** 1st, 2nd, 3rd, 4th, as a move's line counts. */
const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

test.describe('flags, /team/presets/flags', () => {
  const PAGE = '/team/presets/flags';

  test('@responsive a Program Admin opens Flags from the hub and finds the risk levels, highest risk first, and the conditions, each as staff see it, accessible in all three themes', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await page.goto('/team/presets');
    await page.getByRole('main').getByRole('link', { name: 'Flags', exact: true }).click();
    await expect(page).toHaveURL(/\/team\/presets\/flags$/);
    await expect(page).toHaveTitle('Flags · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flags');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const main = page.getByRole('main');
    const removed = (await listed('flag')).filter((f) => f.state === 'archived').length;
    await expect(main.getByRole('heading', { level: 2 })).toHaveText([
      'Risk level',
      'Conditions',
      'Add a flag',
      ...(removed > 0 ? [`Removed (${removed})`] : []),
    ]);
    const risk = main.getByRole('region', { name: 'Risk level', exact: true });
    const conditions = main.getByRole('region', { name: 'Conditions', exact: true });
    const primary = await tierOf('primary');
    const secondary = await tierOf('secondary');
    // 8.1's default, highest risk first: no case of this file moves a risk level.
    expect(primary.map(pillOf)).toEqual(['Red · High', 'Yellow · Medium', 'Green · Low']);
    await expect(risk.getByRole('listitem').getByRole('link')).toHaveText(primary.map(pillOf));
    await expect(conditions.getByRole('listitem').getByRole('link')).toHaveText(secondary.map(pillOf));
    for (const f of [...primary, ...secondary])
      await expect(main.getByRole('link', { name: pillOf(f), exact: true })).toHaveAttribute(
        'href',
        `${PAGE}/${f.id}`,
      );
    // The platform's sensitive condition says so (PRD main 121).
    await expect(conditions.getByRole('listitem').filter({ hasText: 'Purple · Pregnancy' })).toContainText(
      'Sensitive',
    );
    // Each moves up unless it is first, and down unless it is last, its button naming it.
    await expect(risk.getByRole('button')).toHaveCount(4);
    for (const name of ['Move down High', 'Move up Medium', 'Move down Medium', 'Move up Low'])
      await expect(risk.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(
      risk.getByRole('form', { name: 'Order of the risk levels' }).getByLabel('Reason for moving'),
    ).toHaveAccessibleDescription('Don’t put patient names here.');
    // The seeded team holds the platform's version of each: nothing is on offer.
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);

    const add = page.getByRole('form', { name: 'Add a flag' });
    await expect(add.getByRole('group', { name: 'List', exact: true })).toHaveAccessibleDescription(
      'Which list a flag is on can’t be changed later.',
    );
    await expect(add.getByRole('group', { name: 'Colour', exact: true }).getByRole('radio')).toHaveCount(8);
    await expect(add.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(add.getByLabel('Criteria (optional)')).toHaveAccessibleDescription(
      'Staff read these when they choose a flag. Nothing flags a patient by itself. Don’t put patient names here.',
    );
    const sensitive = add.getByLabel('Sensitive', { exact: true });
    await expect(sensitive).not.toBeChecked();
    await expect(sensitive).toHaveAccessibleDescription(
      'Sensitive flags are hidden from Billing and Data. Whether a flag is sensitive can’t be changed later.',
    );

    await expectAccessible(page, PAGE);
    await expectReflow(page, PAGE);
    await expectNothingStored(page, PAGE);
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('adding a flag asks for a reason, then each field, says each problem beside its field, keeps what was typed, and puts the new one at the end of its list', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Add a flag' });
    const name = form.getByLabel('Name', { exact: true });
    const reason = form.getByLabel('Reason', { exact: true });
    const criteria = form.getByLabel('Criteria (optional)');
    const sensitive = form.getByLabel('Sensitive', { exact: true });
    const radio = (label: string) => form.getByRole('radio', { name: label, exact: true });
    const add = form.getByRole('button', { name: 'Add flag' });
    const alert = form.getByRole('alert');
    const conditions = page.getByRole('region', { name: 'Conditions', exact: true });

    // Nothing typed: the reason is asked first, as the API reads the request before the body.
    await add.click();
    await expect(alert).toBeFocused();
    await expect(alert).toContainText('Give a reason of 3 to 300 characters.');

    // A reason, and still no name, list or colour: each said beside its field, the reason kept.
    await reason.fill('Demo: wet weather this month');
    await add.click();
    await expect(alert.locator('.px-alert__title')).toHaveText(
      'Some fields need changing. Check each one below.',
    );
    await expect(
      alert.getByRole('link', { name: 'Name: Enter a name of 1 to 80 characters.' }),
    ).toBeVisible();
    await expect(alert.getByRole('link', { name: 'Colour: Choose a colour.' })).toBeVisible();
    const chooseList = alert.getByRole('link', { name: 'List: Choose Risk level or Conditions.' });
    await expect(chooseList).toBeVisible();
    await expect(reason).toHaveValue('Demo: wet weather this month');
    await expectAccessible(page, 'Add a flag, refused', { inPlace: true });
    await expectReflow(page, 'Add a flag, refused');
    await chooseList.click();
    await expect(form.getByRole('group', { name: 'List', exact: true })).toBeFocused();

    // A sensitive risk level: said beside Sensitive, keeping what was chosen and ticked.
    await name.fill('Demo: Very high');
    await radio('Risk level').check();
    await radio('Red').check();
    await sensitive.check();
    await add.click();
    await expect(alert.getByRole('link')).toHaveText(['Sensitive: A risk level can’t be sensitive.']);
    await expect(sensitive).toBeChecked();
    await expect(radio('Risk level')).toBeChecked();
    await expect(radio('Red')).toBeChecked();
    await expect(name).toHaveValue('Demo: Very high');

    // A name another flag holds, in other letters.
    await sensitive.uncheck();
    await radio('Conditions').check();
    await name.fill('frost risk');
    await add.click();
    await expect(alert.locator('.px-alert__title')).toHaveText(FIELDS_TITLE);
    await expect(alert.getByRole('link')).toHaveText(['Name: Another flag already has this name.']);
    await expect(name).toHaveValue('frost risk');
    await expect(radio('Conditions')).toBeChecked();

    // Added, after every condition the team holds.
    const ranks = (await listed<FlagBody>('flag'))
      .filter((f) => f.body.tier === 'secondary')
      .map((f) => f.body.rank);
    await name.fill('Demo: Wet feet');
    await radio('Teal').check();
    await criteria.fill('Demo: slept out in the rain.');
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Wet feet. It’s on the phones after their next sync.',
    );
    const wet = await named<FlagBody>('flag', 'Demo: Wet feet');
    expect(wet).toMatchObject({
      version: 1,
      body: {
        name: 'Demo: Wet feet',
        tier: 'secondary',
        criteria: 'Demo: slept out in the rain.',
        color: 'teal',
        rank: Math.max(...ranks) + 10,
        sensitive: false,
      },
    });
    await expect(conditions.getByRole('listitem').getByRole('link').last()).toHaveText(
      'Teal · Demo: Wet feet',
    );
    expect((await historyOf('flag', wet.id)).at(-1)).toMatchObject({
      act: 'created',
      version: 1,
      reason: 'Demo: wet weather this month',
    });
    // The form is ready for the next one.
    await expect(name).toHaveValue('');
    await expect(reason).toHaveValue('');
    await expect(criteria).toHaveValue('');
    await expect(form.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(sensitive).not.toBeChecked();

    // A second, on the first try: a sensitive condition, after the first.
    await name.fill('Demo: Heat stroke risk');
    await radio('Conditions').check();
    await radio('Orange').check();
    await sensitive.check();
    await reason.fill('Demo: the heat wave');
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Heat stroke risk. It’s on the phones after their next sync.',
    );
    const last = conditions.getByRole('listitem').last();
    await expect(last.getByRole('link')).toHaveText('Orange · Demo: Heat stroke risk');
    await expect(last).toContainText('Sensitive');
    expect((await named<FlagBody>('flag', 'Demo: Heat stroke risk')).body).toMatchObject({
      tier: 'secondary',
      color: 'orange',
      rank: wet.body.rank + 10,
      sensitive: true,
    });
    await expect(name).toHaveValue('');
    await expect(form.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(sensitive).not.toBeChecked();

    await expectNothingStored(page, 'Flags after an add');
    expectOnlyIds(traffic.addresses);
  });

  test('Move up and Move down move a condition one place, by mouse and by keyboard, say where it went and keep focus on it', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    let posted = 0;
    page.on('request', (r) => void (r.method() === 'POST' && posted++));
    await page.goto(PAGE);
    const before = await tierOf('secondary');
    expect(before.length).toBeGreaterThanOrEqual(3);
    const [first, second] = before as [Row<FlagBody>, Row<FlagBody>];
    const form = page.getByRole('form', { name: 'Order of the conditions' });
    const status = form.getByRole('status');
    const pills = page
      .getByRole('region', { name: 'Conditions', exact: true })
      .getByRole('listitem')
      .getByRole('link');
    const button = (label: string) => form.getByRole('button', { name: label, exact: true });
    const reason = form.getByLabel('Reason for moving');
    const REASON = 'Demo: what we see most this winter';
    await reason.fill(REASON);

    // Enter in the Reason box moves nothing.
    await reason.press('Enter');
    await page.waitForTimeout(1000);
    expect(posted).toBe(0);
    await expect(pills).toHaveText(before.map(pillOf));

    // By mouse: the second moves up, to the top. It can't go further up, so focus is on its Move down.
    await button(`Move up ${second.name}`).click();
    await expect(status).toHaveText(`${second.name} moved up. It’s now 1st of ${before.length} conditions.`);
    await expect(pills).toHaveText([second, first, ...before.slice(2)].map(pillOf));
    await expect(button(`Move down ${second.name}`)).toBeFocused();
    await expect(reason).toHaveValue(REASON);
    const moved = await tierOf('secondary');
    expect(moved.map((f) => f.id)).toEqual([second, first, ...before.slice(2)].map((f) => f.id));
    // Each flag whose rank the move changed is at its next version, the move in its history.
    for (const f of moved) {
      const was = before.find((b) => b.id === f.id)!;
      if (f.body.rank === was.body.rank) {
        expect(f.version, f.name).toBe(was.version);
        continue;
      }
      expect(f.version, f.name).toBe(was.version + 1);
      expect((await historyOf('flag', f.id)).at(-1), f.name).toMatchObject({
        act: 'reordered',
        version: f.version,
        reason: REASON,
      });
    }
    await expectAccessible(page, 'Flags after a move', { inPlace: true });
    await expectReflow(page, 'Flags after a move');

    // By keyboard: Enter on its Move down takes it back; it can go further, so focus stays there.
    await button(`Move down ${second.name}`).focus();
    await page.keyboard.press('Enter');
    await expect(status).toHaveText(
      `${second.name} moved down. It’s now 2nd of ${before.length} conditions.`,
    );
    await expect(pills).toHaveText(before.map(pillOf));
    await expect(button(`Move down ${second.name}`)).toBeFocused();
    // Shift+Tab reaches its Move up, and Space takes it up again: focus goes to its Move down.
    await page.keyboard.press('Shift+Tab');
    await expect(button(`Move up ${second.name}`)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(status).toHaveText(`${second.name} moved up. It’s now 1st of ${before.length} conditions.`);
    await expect(pills).toHaveText([second, first, ...before.slice(2)].map(pillOf));
    await expect(button(`Move down ${second.name}`)).toBeFocused();
    expect((await tierOf('secondary')).map((f) => f.id)).toEqual(
      [second, first, ...before.slice(2)].map((f) => f.id),
    );

    await expectNothingStored(page, 'Flags after a move');
    expectOnlyIds(traffic.addresses);
  });

  test('a move from a list another admin changed since is refused with the stale sentence, the list is read again, and the next move goes through', async ({
    page,
  }) => {
    test.slow();
    const id = await madeCondition('Demo: Chapped lips', 'grey');
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Order of the conditions' });
    const region = page.getByRole('region', { name: 'Conditions', exact: true });
    const button = (label: string) => form.getByRole('button', { name: label, exact: true });
    const alert = form.getByRole('alert');
    await form.getByLabel('Reason for moving').fill('Demo: lips before the rest');

    // Another admin renames it meanwhile: the list the page shows is out of date.
    await changedMeanwhile<FlagBody>('flag', id, (b) => ({ ...b, name: 'Demo: Cracked lips' }));
    const before = await tierOf('secondary');
    await button('Move up Demo: Chapped lips').click();
    await expect(alert).toHaveText(STALE);
    await expect(alert).toBeFocused();
    // Read again: their change is on the page, and nothing moved.
    await expect(region.getByRole('listitem').getByRole('link')).toHaveText(before.map(pillOf));
    await expect(form.getByRole('status')).toHaveText('');
    await expect(form.getByLabel('Reason for moving')).toHaveValue('Demo: lips before the rest');
    expect((await tierOf('secondary')).map((f) => [f.id, f.version])).toEqual(
      before.map((f) => [f.id, f.version]),
    );
    await expectAccessible(page, 'A move refused stale', { inPlace: true });

    // The next move is made from the list as it is now, and goes through.
    await button('Move up Demo: Cracked lips').click();
    await expect(form.getByRole('status')).toHaveText(
      `Demo: Cracked lips moved up. It’s now ${ordinal(before.length - 1)} of ${before.length} conditions.`,
    );
    await expect(button('Move up Demo: Cracked lips')).toBeFocused();
    expect((await tierOf('secondary')).at(-2)!.id).toBe(id);

    // Another admin adds a condition meanwhile: the list the page sends lacks it.
    await madeCondition('Demo: Blisters', 'green');
    const grown = await tierOf('secondary');
    await button('Move down Demo: Cracked lips').click();
    await expect(alert).toHaveText(STALE);
    await expect(region.getByRole('listitem').getByRole('link')).toHaveText(grown.map(pillOf));
    expect((await tierOf('secondary')).map((f) => [f.id, f.version])).toEqual(
      grown.map((f) => [f.id, f.version]),
    );
    await button('Move down Demo: Cracked lips').click();
    await expect(form.getByRole('status')).toHaveText(
      `Demo: Cracked lips moved down. It’s now ${ordinal(grown.length - 1)} of ${grown.length} conditions.`,
    );
    expect((await tierOf('secondary')).map((f) => f.name).slice(-2)).toEqual([
      'Demo: Cracked lips',
      'Demo: Blisters',
    ]);
  });

  test('a move asks for a reason first, and moves nothing without one', async ({ page }) => {
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const before = await tierOf('secondary');
    const form = page.getByRole('form', { name: 'Order of the conditions' });
    await form.getByRole('button', { name: `Move down ${before[0]!.name}`, exact: true }).click();
    const alert = form.getByRole('alert');
    await expect(alert).toBeFocused();
    await expect(alert).toContainText('Give a reason of 3 to 300 characters.');
    await expect(form.getByLabel('Reason for moving')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page, 'A move without a reason', { inPlace: true });
    await expectReflow(page, 'A move without a reason');
    expect((await tierOf('secondary')).map((f) => [f.id, f.version])).toEqual(
      before.map((f) => [f.id, f.version]),
    );
  });

  test('a stale sign-in sends a move through /reauth and back to the page, moving nothing', async ({
    page,
  }) => {
    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const before = await tierOf('secondary');
    const form = page.getByRole('form', { name: 'Order of the conditions' });
    await form.getByLabel('Reason for moving').fill('Demo: an old sign-in');
    await form.getByRole('button', { name: `Move down ${before[0]!.name}`, exact: true }).click();
    await expect(page).toHaveURL(/\/reauth\?next=%2Fteam%2Fpresets%2Fflags$/);
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flags');
    expect((await tierOf('secondary')).map((f) => [f.id, f.version])).toEqual(
      before.map((f) => [f.id, f.version]),
    );
  });

  test('staff without the permission are refused Flags at a typed address, logged once', async ({ page }) => {
    await signIn(page, 'clinician@example.com');
    const before = (await deniedOf('clinician@example.com')).length;
    await page.goto(PAGE);
    await expect(page).toHaveURL(/\/home\?denied=1$/);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Your role doesn’t allow that screen. The attempt was logged.',
    );
    const after = await deniedOf('clinician@example.com');
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
  });
});

test.describe('a flag, /team/presets/flags/[id]', () => {
  const LIST = '/team/presets/flags';

  test('@responsive a Program Admin opens a flag from the list and finds its form as the flag is, its list and Sensitive fixed, accessible in all three themes', async ({
    page,
  }) => {
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    const high = await named<FlagBody>('flag', 'High');
    await page.goto(LIST);
    await page.getByRole('link', { name: 'Red · High', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${high.id}$`));
    await expect(page).toHaveTitle('Flag · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('High');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('main').locator('.px-lede')).toHaveText(
      'A risk level, shown to staff as Red · High.',
    );

    const form = page.getByRole('form', { name: 'Edit High' });
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('High');
    const list = form.getByLabel('List', { exact: true });
    await expect(list).toHaveValue('Risk level');
    await expect(list).not.toBeEditable();
    await expect(list).toHaveAccessibleDescription('Which list a flag is on can’t be changed later.');
    await expect(form.getByRole('radio', { name: 'Red', exact: true })).toBeChecked();
    await expect(form.getByRole('radio', { checked: true })).toHaveCount(1);
    await expect(form.getByLabel('Criteria (optional)')).toHaveValue(high.body.criteria);
    const sensitive = form.getByLabel('Sensitive', { exact: true });
    await expect(sensitive).toHaveValue('No');
    await expect(sensitive).not.toBeEditable();
    await expect(sensitive).toHaveAccessibleDescription(
      'Sensitive flags are hidden from Billing and Data. Whether a flag is sensitive can’t be changed later.',
    );
    await expect(page.getByRole('button', { name: 'Remove High', exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'History' })
        .getByRole('row', { name: /Added by Sineobex, version 1/ }),
    ).toHaveCount(1);
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);

    const here = `${LIST}/${high.id}`;
    await expectAccessible(page, here);
    await expectReflow(page, here);
    await expectNothingStored(page, here);
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('a sensitive condition’s page says so, and shows Sensitive fixed at Yes', async ({ page }) => {
    await signIn(page, 'admin@example.com');
    const pregnancy = await named<FlagBody>('flag', 'Pregnancy');
    await page.goto(`${LIST}/${pregnancy.id}`);
    await expect(page.getByRole('main').locator('.px-lede')).toHaveText(
      'A sensitive condition, shown to staff as Purple · Pregnancy.',
    );
    const form = page.getByRole('form', { name: 'Edit Pregnancy' });
    await expect(form.getByLabel('List', { exact: true })).toHaveValue('Conditions');
    await expect(form.getByLabel('Sensitive', { exact: true })).toHaveValue('Yes');
    await expectAccessible(page, 'A sensitive condition');
  });

  test('editing a flag saves its name, colour and criteria with a reason, in its place on the list; nothing changed, a name taken, criteria too long and an edit made stale meanwhile are each refused with their sentence', async ({
    page,
  }) => {
    test.slow();
    const id = await madeCondition('Demo: Sore feet', 'grey');
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(`${LIST}/${id}`);
    let form = page.getByRole('form', { name: 'Edit Demo: Sore feet' });
    const name = form.getByLabel('Name', { exact: true });
    const criteria = form.getByLabel('Criteria (optional)');
    const reason = form.getByLabel('Reason');
    const save = form.getByRole('button', { name: 'Save' });
    const alert = form.getByRole('alert');

    // Saved as it is: nothing changed.
    await reason.fill('Demo: our own words for it');
    await save.click();
    await expect(alert).toHaveText('You haven’t changed anything.');

    // A name another flag holds, in other letters: said beside the name, kept as typed.
    await name.fill('high');
    await save.click();
    await expect(alert.locator('.px-alert__title')).toHaveText(FIELDS_TITLE);
    await expect(alert.getByRole('link')).toHaveText(['Name: Another flag already has this name.']);
    await expect(name).toHaveValue('high');

    // Criteria too long: said beside them, kept as typed.
    const long = `Demo: ${'walks all day '.repeat(40)}`.trim();
    await name.fill('Demo: Sore feet');
    await criteria.fill(long);
    await save.click();
    await expect(alert.getByRole('link')).toHaveText(['Criteria: Keep it to 500 characters.']);
    await expect(criteria).toHaveValue(long);
    await expect(criteria).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page, 'Edit a flag, refused', { inPlace: true });
    await expectReflow(page, 'Edit a flag, refused');

    // Renamed, in blue, with criteria: saved at its next version, in the same place on the list.
    const place = (await tierOf('secondary')).findIndex((f) => f.id === id);
    await name.fill('Demo: Sore toes');
    await form.getByRole('radio', { name: 'Blue', exact: true }).check();
    await criteria.fill('Demo: walked all night in wet shoes.');
    await save.click();
    form = page.getByRole('form', { name: 'Edit Demo: Sore toes' });
    await expect(form.getByRole('status')).toHaveText(
      'Saved: Demo: Sore toes. It’s on the phones after their next sync.',
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo: Sore toes');
    await expect(page.getByRole('main').locator('.px-lede')).toHaveText(
      'A condition, shown to staff as Blue · Demo: Sore toes.',
    );
    const saved = (await listed<FlagBody>('flag')).find((f) => f.id === id)!;
    expect(saved).toMatchObject({
      version: 2,
      body: { name: 'Demo: Sore toes', tier: 'secondary', color: 'blue', sensitive: false },
    });
    expect(saved.body.criteria).toBe('Demo: walked all night in wet shoes.');
    expect((await tierOf('secondary')).findIndex((f) => f.id === id)).toBe(place);
    await expect(form.getByRole('radio', { name: 'Blue', exact: true })).toBeChecked();
    await expect(form.getByLabel('Reason')).toHaveValue('');
    await expect(
      page.getByRole('region', { name: 'History' }).getByRole('row', { name: /Edited, version 2/ }),
    ).toContainText('Demo: our own words for it');

    // Another admin edits it meanwhile: this form, at version 2, is stale, and stays so.
    expect(await changedMeanwhile<FlagBody>('flag', id, (b) => ({ ...b, criteria: '' }))).toBe(3);
    await form.getByLabel('Name', { exact: true }).fill('Demo: Sore soles');
    await form.getByLabel('Reason').fill('Demo: a better name');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(STALE);
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Demo: Sore soles');
    await expectAccessible(page, 'Edit a flag, stale', { inPlace: true });
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(STALE);
    // Reloaded, the page shows their version.
    await page.reload();
    await expect(
      page.getByRole('form', { name: 'Edit Demo: Sore toes' }).getByLabel('Criteria (optional)'),
    ).toHaveValue('');
    await expectNothingStored(page, 'A flag after an edit');
    expectOnlyIds(traffic.addresses);
  });

  test('Remove on a flag’s page says patients keep it, moves it to the Removed list, and Restore on its page brings it back to its list', async ({
    page,
  }) => {
    test.slow();
    const id = await madeCondition('Demo: Spare flag', 'green');
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(`${LIST}/${id}`);
    await page.getByRole('button', { name: 'Remove Demo: Spare flag', exact: true }).click();
    const remove = page.getByRole('form', { name: 'Remove Demo: Spare flag' });
    await expect(remove).toContainText('Patients who have this flag keep it until someone clears it.');
    await expectAccessible(page, 'Remove a flag', { inPlace: true });
    await remove.getByLabel('Reason').fill('Demo: nobody uses it');
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?done=removed&preset=${id}$`));
    await expect(page.getByRole('heading', { name: 'Removed: Demo: Spare flag' })).toBeFocused();
    const conditions = page.getByRole('region', { name: 'Conditions', exact: true });
    await expect(conditions.getByRole('link', { name: 'Green · Demo: Spare flag' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: /^Removed \(\d+\)$/ })).toContainText('Demo: Spare flag');
    await expectAccessible(page, 'Flags after a remove');

    await page.goto(`${LIST}/${id}`);
    await expect(page.getByRole('form', { name: 'Edit Demo: Spare flag' })).toHaveCount(0);
    const gone = page.getByRole('region', { name: 'Removed', exact: true });
    await expect(gone).toContainText(
      'This flag isn’t offered when staff flag a patient, and patients who have it keep it until someone clears it. Restore it to offer it again.',
    );
    await expectAccessible(page, 'A removed flag');
    await gone.getByLabel('Reason').fill('Demo: needed after all');
    await gone.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${id}\\?done=restored&preset=${id}$`));
    await expect(page.getByRole('heading', { name: 'Restored: Demo: Spare flag' })).toBeFocused();
    await expect(page.getByRole('form', { name: 'Edit Demo: Spare flag' })).toBeVisible();
    const history = page.getByRole('region', { name: 'History' });
    await expect(history.getByRole('row', { name: /Removed, version 1/ })).toContainText(
      'Demo: nobody uses it',
    );
    await expect(history.getByRole('row', { name: /Restored, version 1/ })).toContainText(
      'Demo: needed after all',
    );
    // Back in its list, at the rank it was removed at.
    await page.goto(LIST);
    await expect(conditions.getByRole('listitem').getByRole('link')).toHaveText(
      (await tierOf('secondary')).map(pillOf),
    );
    await expect(
      conditions.getByRole('link', { name: 'Green · Demo: Spare flag', exact: true }),
    ).toBeVisible();

    await expectNothingStored(page, 'A flag after a restore');
    expectOnlyIds(traffic.addresses);
  });

  test('an address that names no flag of the team’s is no page', async ({ page }) => {
    await signIn(page, 'admin@example.com');
    const gauze = await named('item', 'Gauze');
    for (const id of ['30f00000-0000-4000-8000-0000000000fe', gauze.id, 'not-an-id']) {
      await page.goto(`${LIST}/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
    }
  });

  test('a stale sign-in sends a flag being saved through /reauth and back to its page, saving nothing', async ({
    page,
  }) => {
    const id = await madeCondition('Demo: Sun burn', 'orange');
    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(`${LIST}/${id}`);
    const form = page.getByRole('form', { name: 'Edit Demo: Sun burn' });
    await form.getByLabel('Name', { exact: true }).fill('Demo: Sunburn');
    await form.getByLabel('Reason').fill('Demo: an old sign-in');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(new RegExp(`/reauth\\?next=${encodeURIComponent(`${LIST}/${id}`)}$`));
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo: Sun burn');
    expect((await listed('flag')).find((f) => f.id === id)).toMatchObject({
      version: 1,
      name: 'Demo: Sun burn',
    });
  });

  test('staff without the permission are refused a flag at a typed address, logged once', async ({
    page,
  }) => {
    const high = await named('flag', 'High');
    await signIn(page, 'clinician@example.com');
    const before = (await deniedOf('clinician@example.com')).length;
    await page.goto(`${LIST}/${high.id}`);
    await expect(page).toHaveURL(/\/home\?denied=1$/);
    const after = await deniedOf('clinician@example.com');
    // The flags were asked, and refused: nothing else was.
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
  });
});

// ------------------------------------------------------------------------------------------------
// The team's settings, which Condition supplies and Bag minimums each edit a field of
// ------------------------------------------------------------------------------------------------

type ConditionBody = { name: string; codes: string[]; lines: { itemId: string; qtyPerPatient: number }[] };

type Minimum = { itemId: string; min: number };

type SettingsBody = {
  name: 'Team settings';
  bagMinimumsOn: boolean;
  newBagMinimums: Minimum[];
  problemCheckDays: number;
};

/** The team's settings as the API lists them: the one preset of its kind. */
async function settingsRow(): Promise<Row<SettingsBody>> {
  const [row] = await listed<SettingsBody>('settings');
  expect(row, 'the team’s settings').toBeDefined();
  return row!;
}

/**
 * The team's settings put back as a case found them, as another admin would: the window and the
 * switch other specs read are the platform's again, and no item stays in the template, where it
 * could not be removed.
 */
async function settingsBack(body: SettingsBody) {
  const now = await settingsRow();
  if (JSON.stringify(now.body) !== JSON.stringify(body))
    await changedMeanwhile<SettingsBody>('settings', now.id, () => body);
}

/** Each item's name by its ID, removed ones too, as the pages name a line's item. */
async function itemNames(): Promise<Record<string, string>> {
  return Object.fromEntries((await listed<ItemBody>('item')).map((i) => [i.id, i.name]));
}

/** A fact of a preset's section, by its term. */
const factOf = (section: Locator, term: string) => section.locator(`dt:text-is("${term}") + dd`);

// ------------------------------------------------------------------------------------------------
// Condition supplies (8.1): condition codes, items and a quantity per patient; the status check
// window, "Check problems not updated in [90] days"
// ------------------------------------------------------------------------------------------------

test.describe('condition supplies, /team/presets/condition-supplies', () => {
  const PAGE = '/team/presets/condition-supplies';
  const CODES_HINT =
    'ICD-10-CM codes, such as R21 or L30.9: 1 to 20 of them. A problem counts only when its code is one of these exactly, so L30 doesn’t count L30.9.';
  const LINES_HINT =
    'For each patient on a route with one of these conditions, New or Ongoing, the bag check counts this many of each item.';
  const WINDOW = 'Check problems not updated in: Enter a whole number of days from 7 to 365.';

  /** A line as the page says it: "Hydrocortisone cream × 1 per patient". */
  const lineOf = (names: Record<string, string>) => (l: ConditionBody['lines'][number]) =>
    `${names[l.itemId]} × ${l.qtyPerPatient} per patient`;

  test('@responsive a Program Admin opens Condition supplies from the hub and finds each mapping with its codes and items, and the status check window, accessible in all three themes', async ({
    page,
  }) => {
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await page.goto('/team/presets');
    await page.getByRole('main').getByRole('link', { name: 'Condition supplies', exact: true }).click();
    await expect(page).toHaveURL(/\/team\/presets\/condition-supplies$/);
    await expect(page).toHaveTitle('Condition supplies · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Condition supplies');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const all = await listed<ConditionBody>('condition_supply_map');
    const active = all
      .filter((m) => m.state === 'active')
      .sort((a, b) => byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
    const removed = all.length - active.length;
    const names = await itemNames();
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2 })).toHaveText([
      ...active.map((m) => m.name),
      'Add a mapping',
      ...(removed > 0 ? [`Removed (${removed})`] : []),
      'Status check',
    ]);
    // Each mapping A to Z, as the API sorts names, with its codes, its items per patient, its acts
    // and its history.
    for (const m of active) {
      const section = main.getByRole('region', { name: m.name, exact: true });
      await expect(factOf(section, 'Condition codes')).toHaveText(m.body.codes.join(', '));
      await expect(factOf(section, 'Items').getByRole('listitem')).toHaveText(
        m.body.lines.map(lineOf(names)),
      );
      await expect(section.getByRole('button', { name: `Edit ${m.name}`, exact: true })).toBeVisible();
      await expect(section.getByRole('button', { name: `Remove ${m.name}`, exact: true })).toBeVisible();
      await expect(section.getByRole('region', { name: `History of ${m.name}` })).toBeVisible();
    }
    // The platform's, from the PRD's own example (main 476).
    const rash = main.getByRole('region', { name: 'Rash or dermatitis', exact: true });
    await expect(factOf(rash, 'Condition codes')).toHaveText('R21, L30.9');
    await expect(factOf(rash, 'Items')).toHaveText('Hydrocortisone cream × 1 per patient');
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);

    const add = page.getByRole('form', { name: 'Add a mapping' });
    await expect(add.getByLabel('Name', { exact: true })).toHaveAccessibleDescription(
      'What the condition is called, such as Rash or dermatitis. Don’t put patient names here.',
    );
    await expect(add.getByRole('group', { name: 'Condition codes' })).toHaveAccessibleDescription(CODES_HINT);
    const first = add.getByLabel('Condition code 1', { exact: true });
    await expect(first).toHaveValue('');
    await expect(first).toHaveAccessibleDescription('Don’t put patient names here.');
    await expect(add.getByRole('group', { name: 'Items' })).toHaveAccessibleDescription(LINES_HINT);

    // The window, as the team's settings hold it, with its history.
    const settings = await settingsRow();
    const check = main.getByRole('region', { name: 'Status check', exact: true });
    const days = check
      .getByRole('form', { name: 'Status check' })
      .getByLabel('Check problems not updated in');
    await expect(days).toHaveValue(String(settings.body.problemCheckDays));
    await expect(days).toHaveAccessibleDescription('days');
    await expect(
      check
        .getByRole('region', { name: 'History of the team’s settings' })
        .getByRole('row', { name: /Added by Sineobex, version 1/ }),
    ).toBeVisible();

    await expectAccessible(page, PAGE);
    await expectReflow(page, PAGE);
    await expectNothingStored(page, PAGE);
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('adding a mapping asks for a reason, then each field, says each code’s and each line’s problem beside it, keeps what was typed, and lists the new one', async ({
    page,
  }) => {
    test.slow();
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Add a mapping' });
    const name = form.getByLabel('Name', { exact: true });
    const code = (n: number) => form.getByLabel(`Condition code ${n}`, { exact: true });
    const reason = form.getByLabel('Reason');
    const add = form.getByRole('button', { name: 'Add mapping' });
    const alert = form.getByRole('alert');
    const title = alert.locator('.px-alert__title');
    const line = (n: number) => form.getByRole('group', { name: `Line ${n}`, exact: true });

    // Nothing typed: the reason is asked first, as the API reads the request before the body.
    await add.click();
    await expect(alert).toBeFocused();
    await expect(alert).toContainText('Give a reason of 3 to 300 characters.');

    // A reason, and nothing else: each field said beside it.
    await reason.fill('Demo: what a sunburn needs');
    await add.click();
    await expect(title).toHaveText('Some fields need changing. Check each one below.');
    await expect(alert.getByRole('link')).toHaveText([
      'Name: Enter a name of 1 to 80 characters.',
      'Condition code 1: Enter a code as a problem records it, such as R21 or L30.9.',
      'Items: Give the mapping 1 to 10 items.',
    ]);
    await expectAccessible(page, 'Add a mapping, refused', { inPlace: true });
    await expectReflow(page, 'Add a mapping, refused');
    await alert.getByRole('link', { name: /^Condition code 1:/ }).click();
    await expect(code(1)).toBeFocused();

    // A code that isn't one, a code added and one taken out, and a line with no item and a
    // quantity that isn't one: each said beside it, and kept as typed.
    await name.fill('Demo: Sunburn');
    await code(1).fill('l55.9');
    await form.getByRole('button', { name: 'Add a code' }).click();
    await code(2).fill('L55');
    await form.getByRole('button', { name: 'Add a code' }).click();
    await code(3).fill('L55.0');
    await form.getByRole('button', { name: 'Take out condition code 3' }).click();
    await expect(code(3)).toHaveCount(0);
    await form.getByRole('button', { name: 'Add an item' }).click();
    await line(1).getByLabel('Quantity per patient').fill('lots');
    await add.click();
    await expect(alert.getByRole('link')).toHaveText([
      'Condition code 1: Enter a code as a problem records it, such as R21 or L30.9.',
      'Item on line 1: Choose one from the list.',
      'Quantity per patient on line 1: Enter a whole number from 1 to 99.',
    ]);
    await expect(code(1)).toHaveValue('l55.9');
    await expect(code(1)).toHaveAttribute('aria-invalid', 'true');
    await expect(code(2)).toHaveValue('L55');
    await expect(line(1).getByLabel('Quantity per patient')).toHaveValue('lots');
    await expectAccessible(page, 'Add a mapping, a code and a line refused', { inPlace: true });
    await expectReflow(page, 'Add a mapping, a code and a line refused');

    // A name another mapping holds, in any case: said beside the name.
    await code(1).fill('L55.9');
    await line(1).getByLabel('Item').selectOption({ label: 'Hydrocortisone cream' });
    await line(1).getByLabel('Quantity per patient').fill('1');
    await name.fill('rash or dermatitis');
    await add.click();
    await expect(title).toHaveText(FIELDS_TITLE);
    await expect(alert.getByRole('link')).toHaveText([
      'Name: Another condition mapping already has this name.',
    ]);
    await expect(name).toHaveValue('rash or dermatitis');
    await expect(code(2)).toHaveValue('L55');

    // Added, and listed with its history.
    await name.fill('Demo: Sunburn');
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Sunburn. It’s on the phones after their next sync.',
    );
    const cream = await named<ItemBody>('item', 'Hydrocortisone cream');
    expect(await named<ConditionBody>('condition_supply_map', 'Demo: Sunburn')).toMatchObject({
      version: 1,
      body: {
        name: 'Demo: Sunburn',
        codes: ['L55.9', 'L55'],
        lines: [{ itemId: cream.id, qtyPerPatient: 1 }],
      },
    });
    const sunburn = page.getByRole('region', { name: 'Demo: Sunburn', exact: true });
    await expect(factOf(sunburn, 'Condition codes')).toHaveText('L55.9, L55');
    await expect(factOf(sunburn, 'Items')).toHaveText('Hydrocortisone cream × 1 per patient');
    const added = sunburn
      .getByRole('region', { name: 'History of Demo: Sunburn' })
      .getByRole('row', { name: /Added, version 1/ });
    await expect(added).toContainText('Alex Rivera (demo)');
    await expect(added).toContainText('Demo: what a sunburn needs');
    // The form is ready for the next one.
    await expect(name).toHaveValue('');
    await expect(code(1)).toHaveValue('');
    await expect(code(2)).toHaveCount(0);
    await expect(form.getByRole('group', { name: 'Items' })).toContainText('None yet.');
    await expect(reason).toHaveValue('');

    // Another added on the first try, with nothing refused before it: its codes and lines go with it.
    await name.fill('Demo: Chafing');
    await code(1).fill('L30.4');
    await form.getByRole('button', { name: 'Add a code' }).click();
    await code(2).fill('L30.8');
    await form.getByRole('button', { name: 'Add an item' }).click();
    await line(1).getByLabel('Item').selectOption({ label: 'Dry skin and chafing kit' });
    await reason.fill('Demo: what chafing needs');
    await add.click();
    await expect(form.getByRole('status')).toHaveText(
      'Added: Demo: Chafing. It’s on the phones after their next sync.',
    );
    await expect(code(1)).toHaveValue('');
    await expect(code(2)).toHaveCount(0);
    await expect(form.getByRole('group', { name: /^Line \d+$/ })).toHaveCount(0);

    await expectNothingStored(page, 'Condition supplies after an add');
    expectOnlyIds(traffic.addresses);
  });

  test('editing a mapping saves its codes and lines at its next version with its history, refuses a save that changes nothing, and stays stale until reloaded', async ({
    page,
  }) => {
    test.slow();
    const gauze = await named<ItemBody>('item', 'Gauze');
    const bandage = await named<ItemBody>('item', 'Bandage');
    const id = await made('condition_supply_map', {
      name: 'Demo: Blisters',
      codes: ['T14.8'],
      lines: [{ itemId: gauze.id, qtyPerPatient: 2 }],
    });
    const mapping = async () =>
      (await listed<ConditionBody>('condition_supply_map')).find((m) => m.id === id);
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const section = (name: string) => page.getByRole('region', { name, exact: true });
    await section('Demo: Blisters').getByRole('button', { name: 'Edit Demo: Blisters', exact: true }).click();
    let form = section('Demo: Blisters').getByRole('form', { name: 'Edit Demo: Blisters' });
    const line = (n: number) => form.getByRole('group', { name: `Line ${n}`, exact: true });
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Demo: Blisters');
    await expect(form.getByLabel('Condition code 1', { exact: true })).toHaveValue('T14.8');
    await expect(line(1).getByLabel('Item')).toHaveValue(gauze.id);
    await expect(line(1).getByLabel('Quantity per patient')).toHaveValue('2');
    await expect(form.getByLabel('Reason')).toHaveValue('');

    // Saved as it is: nothing changed.
    await form.getByLabel('Reason').fill('Demo: blisters from new shoes');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText('You haven’t changed anything.');

    // Renamed, a code and a line added, a quantity changed: saved at version 2.
    await form.getByLabel('Name', { exact: true }).fill('Demo: Blisters on the feet');
    await form.getByRole('button', { name: 'Add a code' }).click();
    await form.getByLabel('Condition code 2', { exact: true }).fill('L98.8');
    await line(1).getByLabel('Quantity per patient').fill('3');
    await form.getByRole('button', { name: 'Add an item' }).click();
    await line(2).getByLabel('Item').selectOption({ label: 'Bandage' });
    await form.getByRole('button', { name: 'Save' }).click();
    form = section('Demo: Blisters on the feet').getByRole('form', {
      name: 'Edit Demo: Blisters on the feet',
    });
    await expect(form.getByRole('status')).toHaveText(
      'Saved: Demo: Blisters on the feet. It’s on the phones after their next sync.',
    );
    expect(await mapping()).toMatchObject({
      version: 2,
      body: {
        name: 'Demo: Blisters on the feet',
        codes: ['T14.8', 'L98.8'],
        lines: [
          { itemId: gauze.id, qtyPerPatient: 3 },
          { itemId: bandage.id, qtyPerPatient: 1 },
        ],
      },
    });
    const saved = section('Demo: Blisters on the feet');
    await expect(factOf(saved, 'Condition codes')).toHaveText('T14.8, L98.8');
    await expect(factOf(saved, 'Items').getByRole('listitem')).toHaveText([
      'Gauze × 3 per patient',
      'Bandage × 1 per patient',
    ]);
    await expect(
      saved
        .getByRole('region', { name: 'History of Demo: Blisters on the feet' })
        .getByRole('row', { name: /Edited, version 2/ }),
    ).toContainText('Demo: blisters from new shoes');

    // Another admin edits it meanwhile: this form, at version 2, is stale, and stays so.
    expect(
      await changedMeanwhile<ConditionBody>('condition_supply_map', id, (b) => ({ ...b, codes: ['T14.8'] })),
    ).toBe(3);
    await form.getByRole('button', { name: 'Add a code' }).click();
    await form.getByLabel('Condition code 3', { exact: true }).fill('L60.8');
    await form.getByLabel('Reason').fill('Demo: toenails too');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(STALE);
    await expect(form.getByLabel('Condition code 3', { exact: true })).toHaveValue('L60.8');
    await expectAccessible(page, 'Edit a mapping, stale', { inPlace: true });
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(STALE);
    expect(await mapping()).toMatchObject({ version: 3, body: { codes: ['T14.8'] } });
    // Reloaded, the page shows their version.
    await page.reload();
    await expect(factOf(section('Demo: Blisters on the feet'), 'Condition codes')).toHaveText('T14.8');
  });

  test('Remove moves a mapping to Removed, and Restore brings it back once no other has its name, each with its reason in its history', async ({
    page,
  }) => {
    test.slow();
    const cream = await named<ItemBody>('item', 'Hydrocortisone cream');
    const body = {
      name: 'Demo: Heat rash',
      codes: ['L74.0'],
      lines: [{ itemId: cream.id, qtyPerPatient: 1 }],
    };
    const id = await made('condition_supply_map', body);
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(PAGE);
    await page.getByRole('button', { name: 'Remove Demo: Heat rash', exact: true }).click();
    const remove = page.getByRole('form', { name: 'Remove Demo: Heat rash' });
    await remove.getByLabel('Reason').fill('Demo: not this summer');
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}\\?done=removed&preset=${id}$`));
    await expect(page.getByRole('heading', { name: 'Removed: Demo: Heat rash' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Demo: Heat rash', exact: true })).toHaveCount(0);
    const removed = page.getByRole('region', { name: /^Removed \(\d+\)$/ });
    await expect(removed).toContainText('Demo: Heat rash');
    await expectAccessible(page, 'Condition supplies after a remove');

    // Another mapping has taken its name since: the restore is refused.
    const taker = await made('condition_supply_map', body);
    await page.reload();
    await removed.getByRole('button', { name: 'Restore Demo: Heat rash', exact: true }).click();
    const restore = removed.getByRole('form', { name: 'Restore Demo: Heat rash' });
    await restore.getByLabel('Reason').fill('Demo: summer again');
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(restore.getByRole('alert')).toHaveText(
      'Another condition mapping has this name now. Rename that one first.',
    );
    await expect(restore.getByLabel('Reason')).toHaveValue('Demo: summer again');
    await expectAccessible(page, 'Restore a mapping, refused', { inPlace: true });
    await expectReflow(page, 'Restore a mapping, refused');

    // Once that one is renamed, restored at the version it was removed at.
    await changedMeanwhile<ConditionBody>('condition_supply_map', taker, (b) => ({
      ...b,
      name: 'Demo: Heat rash, second',
    }));
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}\\?done=restored&preset=${id}$`));
    await expect(page.getByRole('heading', { name: 'Restored: Demo: Heat rash' })).toBeFocused();
    const history = page
      .getByRole('region', { name: 'Demo: Heat rash', exact: true })
      .getByRole('region', { name: 'History of Demo: Heat rash' });
    await expect(history.getByRole('row', { name: /Removed, version 1/ })).toContainText(
      'Demo: not this summer',
    );
    await expect(history.getByRole('row', { name: /Restored, version 1/ })).toContainText(
      'Demo: summer again',
    );
    expect((await listed('condition_supply_map')).find((m) => m.id === id)).toMatchObject({
      state: 'active',
      version: 1,
    });

    await expectNothingStored(page, 'Condition supplies after a restore');
    expectOnlyIds(traffic.addresses);
  });

  test('the status check window saves the team’s number of days with its own reason, says its range beside the box, and stays stale once another admin changed the settings', async ({
    page,
  }) => {
    test.slow();
    const before = await settingsRow();
    try {
      await signIn(page, 'admin@example.com');
      const traffic = watchTraffic(page);
      await page.goto(PAGE);
      const form = page.getByRole('form', { name: 'Status check' });
      const days = form.getByLabel('Check problems not updated in');
      const save = form.getByRole('button', { name: 'Save' });
      await expect(days).toHaveValue(String(before.body.problemCheckDays));

      // Not a number of days: said beside the box, and kept as typed.
      await days.fill('ninety');
      await form.getByLabel('Reason').fill('Demo: check problems sooner');
      await save.click();
      await expect(form.getByRole('alert').getByRole('link')).toHaveText([WINDOW]);
      await expect(days).toHaveValue('ninety');
      await expect(days).toHaveAttribute('aria-invalid', 'true');
      await expect(days).toHaveAccessibleDescription(`days ${WINDOW}`);
      await expectAccessible(page, 'Status check, refused', { inPlace: true });
      await expectReflow(page, 'Status check, refused');

      // Saved: the team's settings at their next version, the rest of them as they were.
      await days.fill('60');
      await save.click();
      await expect(form.getByRole('status')).toHaveText(
        'Saved: Check problems not updated in 60 days. It’s on the phones after their next sync.',
      );
      const saved = await settingsRow();
      expect(saved).toMatchObject({
        version: before.version + 1,
        body: { ...before.body, problemCheckDays: 60 },
      });
      await expect(days).toHaveValue('60');
      await expect(
        page
          .getByRole('region', { name: 'History of the team’s settings' })
          .getByRole('row', { name: new RegExp(`Edited, version ${saved.version}`) }),
      ).toContainText('Demo: check problems sooner');

      // Another admin changes the settings meanwhile: this form is stale, and stays so.
      await changedMeanwhile<SettingsBody>('settings', saved.id, (b) => ({ ...b, problemCheckDays: 45 }));
      await days.fill('30');
      await form.getByLabel('Reason').fill('Demo: sooner still');
      await save.click();
      await expect(form.getByRole('alert')).toHaveText(STALE);
      await expect(days).toHaveValue('30');
      await expectAccessible(page, 'Status check, stale', { inPlace: true });
      await save.click();
      await expect(form.getByRole('alert')).toHaveText(STALE);
      expect((await settingsRow()).body.problemCheckDays).toBe(45);
      // Reloaded, the page shows their number.
      await page.reload();
      await expect(days).toHaveValue('45');

      await expectNothingStored(page, 'Condition supplies after the window is saved');
      expectOnlyIds(traffic.addresses);
    } finally {
      await settingsBack(before.body);
    }
  });

  test('a stale sign-in sends a mapping being added through /reauth and back to the page, adding nothing', async ({
    page,
  }) => {
    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Add a mapping' });
    await form.getByLabel('Name', { exact: true }).fill('Demo: Never added mapping');
    await form.getByLabel('Condition code 1', { exact: true }).fill('R21');
    await form.getByRole('button', { name: 'Add an item' }).click();
    await form
      .getByRole('group', { name: 'Line 1', exact: true })
      .getByLabel('Item')
      .selectOption({ label: 'Gauze' });
    await form.getByLabel('Reason').fill('Demo: an old sign-in');
    await form.getByRole('button', { name: 'Add mapping' }).click();
    await expect(page).toHaveURL(/\/reauth\?next=%2Fteam%2Fpresets%2Fcondition-supplies$/);
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Condition supplies');
    expect((await listed('condition_supply_map')).some((m) => m.name === 'Demo: Never added mapping')).toBe(
      false,
    );
  });

  test('staff without the permission are refused Condition supplies at a typed address, logged once', async ({
    page,
  }) => {
    await signIn(page, 'clinician@example.com');
    const before = (await deniedOf('clinician@example.com')).length;
    await page.goto(PAGE);
    await expect(page).toHaveURL(/\/home\?denied=1$/);
    const after = await deniedOf('clinician@example.com');
    // The mappings were asked, and refused: nothing else was.
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
  });
});

// ------------------------------------------------------------------------------------------------
// Bag minimums (8.1; PRD main 477, 930): the team's switch and its template for new bags, each bag
// with its minimums, and Add bag, filled from the template or from a bag chosen under Copy from
// ------------------------------------------------------------------------------------------------

type BagBody = { name: string; minimums: Minimum[] };

test.describe('bag minimums, /team/presets/bag-minimums', () => {
  const PAGE = '/team/presets/bag-minimums';
  const OFF = 'Bag minimums are off. Nobody is reminded to restock.';
  const ON =
    'Bag minimums are on. When a bag drops below a minimum, after a visit or a count, the team is reminded to restock it, whether or not a route is planned.';
  const MINIMUMS_HINT =
    'The least of each item a bag should hold. While bag minimums are on, the team is reminded to restock a bag that holds fewer.';
  const COPY_HINT =
    'Choosing one fills the minimums below with its list, in place of what they hold. Change them before you add the bag, or later.';

  /** A minimum as the page says it: "Socks: at least 10". */
  const minimumOf = (names: Record<string, string>) => (m: Minimum) =>
    `${names[m.itemId]}: at least ${m.min}`;

  /** The team's active bags A to Z, as the page lists them. */
  const bagsInOrder = async () =>
    (await listed<BagBody>('bag'))
      .filter((b) => b.state === 'active')
      .sort((a, b) => byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));

  /**
   * A bag with a long name, made once: Copy from offers it, so a reflow check at 320 px also checks
   * the choice never widens the page, whichever cases ran before.
   */
  /** A bag with a long name and no minimums, made once. */
  const LONG_BAG = 'Demo: Winter outreach van bag for the shelter and the river camp';
  async function longBag(): Promise<void> {
    if ((await listed('bag')).some((b) => b.name === LONG_BAG)) return;
    await made('bag', { name: LONG_BAG, minimums: [] });
  }

  test('@responsive a Program Admin opens Bag minimums from the hub and finds the team’s switch and template, and each bag with its minimums, accessible in all three themes', async ({
    page,
  }) => {
    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await page.goto('/team/presets');
    await page.getByRole('main').getByRole('link', { name: 'Bag minimums', exact: true }).click();
    await expect(page).toHaveURL(/\/team\/presets\/bag-minimums$/);
    await expect(page).toHaveTitle('Bag minimums · Sineobex');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bag minimums');
    await expect(portalNav(page).getByRole('link', { name: 'Presets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const active = await bagsInOrder();
    const removed = (await listed('bag')).length - active.length;
    const names = await itemNames();
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2 })).toHaveText([
      'Your team’s settings',
      ...active.map((b) => b.name),
      'Add a bag',
      ...(removed > 0 ? [`Removed (${removed})`] : []),
    ]);

    // The switch and the template, as the team's settings hold them.
    const settings = await settingsRow();
    const team = main.getByRole('region', { name: 'Your team’s settings' });
    await expect(team).toContainText(settings.body.bagMinimumsOn ? ON : OFF);
    const on = settings.body.bagMinimumsOn;
    await expect(
      team
        .getByRole('form', { name: on ? 'Turn bag minimums off' : 'Turn bag minimums on' })
        .getByRole('button', { name: on ? 'Turn off' : 'Turn on' }),
    ).toBeVisible();
    const template = team.getByRole('form', { name: 'Template for new bags' });
    await expect(template.getByRole('group', { name: 'Minimums' })).toHaveAccessibleDescription(
      MINIMUMS_HINT,
    );
    await expect(template.getByRole('group', { name: /^Line \d+$/ })).toHaveCount(
      settings.body.newBagMinimums.length,
    );
    await expect(
      team
        .getByRole('region', { name: 'History of the team’s settings' })
        .getByRole('row', { name: /Added by Sineobex, version 1/ }),
    ).toBeVisible();

    // Each bag A to Z, as the API sorts names, with its minimums, its acts and its history.
    for (const b of active) {
      const section = main.getByRole('region', { name: b.name, exact: true });
      const minimums = factOf(section, 'Minimums');
      if (b.body.minimums.length === 0) await expect(minimums).toHaveText('None');
      else await expect(minimums.getByRole('listitem')).toHaveText(b.body.minimums.map(minimumOf(names)));
      await expect(section.getByRole('button', { name: `Edit ${b.name}`, exact: true })).toBeVisible();
      await expect(section.getByRole('button', { name: `Remove ${b.name}`, exact: true })).toBeVisible();
      await expect(section.getByRole('region', { name: `History of ${b.name}` })).toBeVisible();
    }
    // The demo team's own bag, from the seed.
    await expect(
      factOf(
        main.getByRole('region', { name: 'Demo: Outreach backpack', exact: true }),
        'Minimums',
      ).getByRole('listitem'),
    ).toHaveText([
      'Demo: Rain poncho: at least 4',
      'Socks: at least 10',
      'Gauze: at least 20',
      'Bandage: at least 20',
      'Naloxone kit: at least 2',
    ]);
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);

    // Add a bag: its name, and Copy from the template, to start with, or any bag A to Z.
    const add = page.getByRole('form', { name: 'Add a bag' });
    await expect(add.getByLabel('Name', { exact: true })).toHaveAccessibleDescription(
      'Such as Wound care bag or Harm reduction bag. Don’t put patient names here.',
    );
    const copyFrom = add.getByLabel('Copy from');
    await expect(copyFrom).toHaveAccessibleDescription(COPY_HINT);
    await expect(copyFrom).toHaveValue('template');
    await expect(copyFrom.getByRole('option')).toHaveText([
      'The template for new bags',
      ...active.map((b) => b.name),
    ]);
    await expect(add.getByRole('group', { name: 'Minimums' })).toHaveAccessibleDescription(MINIMUMS_HINT);
    await expect(add.getByRole('group', { name: /^Line \d+$/ })).toHaveCount(
      settings.body.newBagMinimums.length,
    );

    await expectAccessible(page, PAGE);
    await expectReflow(page, PAGE);
    await expectNothingStored(page, PAGE);
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('the switch turns bag minimums on and off for the team, each with its own reason, and a form sent after another admin’s change is refused stale', async ({
    page,
  }) => {
    test.slow();
    const before = await settingsRow();
    try {
      // Off to start with, whatever an earlier case left: the platform's default (design 11, row 35).
      if (before.body.bagMinimumsOn)
        await changedMeanwhile<SettingsBody>('settings', before.id, (b) => ({ ...b, bagMinimumsOn: false }));
      const start = await settingsRow();
      await signIn(page, 'admin@example.com');
      const traffic = watchTraffic(page);
      await page.goto(PAGE);
      const team = page.getByRole('region', { name: 'Your team’s settings' });
      await expect(team).toContainText(OFF);

      // Turned on, with a reason, asked first.
      let form = team.getByRole('form', { name: 'Turn bag minimums on' });
      await form.getByRole('button', { name: 'Turn on' }).click();
      await expect(form.getByRole('alert')).toContainText('Give a reason of 3 to 300 characters.');
      await expectAccessible(page, 'Turn bag minimums on, refused', { inPlace: true });
      await form.getByLabel('Reason').fill('Demo: remind us to restock');
      await form.getByRole('button', { name: 'Turn on' }).click();
      form = team.getByRole('form', { name: 'Turn bag minimums off' });
      await expect(form.getByRole('status')).toHaveText(
        'Saved: bag minimums are on. It’s on the phones after their next sync.',
      );
      await expect(team).toContainText(ON);
      await expect(team).not.toContainText(OFF);
      const turnedOn = await settingsRow();
      expect(turnedOn).toMatchObject({
        version: start.version + 1,
        body: { ...start.body, bagMinimumsOn: true },
      });
      await expect(
        team
          .getByRole('region', { name: 'History of the team’s settings' })
          .getByRole('row', { name: new RegExp(`Edited, version ${turnedOn.version}`) }),
      ).toContainText('Demo: remind us to restock');
      await expectAccessible(page, 'Bag minimums on', { inPlace: true });
      await expectReflow(page, 'Bag minimums on');

      // Another admin changes the settings meanwhile: this form, at the version it showed, is stale.
      await changedMeanwhile<SettingsBody>('settings', turnedOn.id, (b) => ({ ...b, problemCheckDays: 120 }));
      await form.getByLabel('Reason').fill('Demo: too many reminders');
      await form.getByRole('button', { name: 'Turn off' }).click();
      await expect(form.getByRole('alert')).toHaveText(STALE);
      await expect(form.getByLabel('Reason')).toHaveValue('Demo: too many reminders');
      expect((await settingsRow()).body).toMatchObject({ bagMinimumsOn: true, problemCheckDays: 120 });

      // Reloaded, turned off: 8.1's sentence again.
      await page.reload();
      form = team.getByRole('form', { name: 'Turn bag minimums off' });
      await form.getByLabel('Reason').fill('Demo: too many reminders');
      await form.getByRole('button', { name: 'Turn off' }).click();
      await expect(team.getByRole('form', { name: 'Turn bag minimums on' }).getByRole('status')).toHaveText(
        'Saved: bag minimums are off. It’s on the phones after their next sync.',
      );
      await expect(team).toContainText(OFF);
      expect((await settingsRow()).body).toMatchObject({ bagMinimumsOn: false, problemCheckDays: 120 });

      await expectNothingStored(page, 'Bag minimums after the switch');
      expectOnlyIds(traffic.addresses);
    } finally {
      await settingsBack(before.body);
    }
  });

  test('the template for new bags saves its lines with its own reason, says each line’s problem beside it, and is what Add bag starts from', async ({
    page,
  }) => {
    test.slow();
    const before = await settingsRow();
    const gauze = await named<ItemBody>('item', 'Gauze');
    const socks = await named<ItemBody>('item', 'Socks');
    try {
      await signIn(page, 'admin@example.com');
      await page.goto(PAGE);
      const form = page.getByRole('form', { name: 'Template for new bags' });
      const line = (n: number) => form.getByRole('group', { name: `Line ${n}`, exact: true });
      const save = form.getByRole('button', { name: 'Save' });
      const alert = form.getByRole('alert');
      for (let n = before.body.newBagMinimums.length; n > 0; n--)
        await form.getByRole('button', { name: `Take out line ${n}` }).click();

      // A minimum of none: said on its line, and kept as typed.
      await form.getByRole('button', { name: 'Add an item' }).click();
      await line(1).getByLabel('Item').selectOption({ label: 'Gauze' });
      await line(1).getByLabel('Minimum').fill('0');
      await form.getByLabel('Reason').fill('Demo: what every bag starts with');
      await save.click();
      await expect(alert.locator('.px-alert__title')).toHaveText(
        'Some fields need changing. Check each one below.',
      );
      await expect(alert.getByRole('link')).toHaveText([
        'Minimum on line 1: Enter a whole number from 1 to 999.',
      ]);
      await expect(line(1).getByLabel('Minimum')).toHaveValue('0');
      await expect(line(1).getByLabel('Minimum')).toHaveAttribute('aria-invalid', 'true');
      await expectAccessible(page, 'Template for new bags, refused', { inPlace: true });
      await expectReflow(page, 'Template for new bags, refused');

      // One item on two lines: said on the later line.
      await line(1).getByLabel('Minimum').fill('15');
      await form.getByRole('button', { name: 'Add an item' }).click();
      await line(2).getByLabel('Item').selectOption({ label: 'Gauze' });
      await save.click();
      await expect(alert.getByRole('link')).toHaveText(['Item on line 2: This item is on the list twice.']);

      // Saved: the template at the settings' next version, the rest of them as they were.
      await line(2).getByLabel('Item').selectOption({ label: 'Socks' });
      await line(2).getByLabel('Minimum').fill('6');
      await save.click();
      await expect(form.getByRole('status')).toHaveText(
        'Saved: Template for new bags. It’s on the phones after their next sync.',
      );
      const saved = await settingsRow();
      expect(saved).toMatchObject({
        version: before.version + 1,
        body: {
          ...before.body,
          newBagMinimums: [
            { itemId: gauze.id, min: 15 },
            { itemId: socks.id, min: 6 },
          ],
        },
      });
      await expect(
        page
          .getByRole('region', { name: 'History of the team’s settings' })
          .getByRole('row', { name: new RegExp(`Edited, version ${saved.version}`) }),
      ).toContainText('Demo: what every bag starts with');

      // Add a bag starts from it.
      const add = page.getByRole('form', { name: 'Add a bag' });
      const addLine = (n: number) => add.getByRole('group', { name: `Line ${n}`, exact: true });
      await expect(add.getByLabel('Copy from')).toHaveValue('template');
      await expect(add.getByRole('group', { name: /^Line \d+$/ })).toHaveCount(2);
      await expect(addLine(1).getByLabel('Item')).toHaveValue(gauze.id);
      await expect(addLine(1).getByLabel('Minimum')).toHaveValue('15');
      await expect(addLine(2).getByLabel('Item')).toHaveValue(socks.id);
      await expect(addLine(2).getByLabel('Minimum')).toHaveValue('6');
    } finally {
      await settingsBack(before.body);
    }
  });

  test('adding a bag fills its minimums from the template, or from a bag chosen under Copy from, also after a refusal, stores the lines sent, and lists the new one', async ({
    page,
  }) => {
    test.slow();
    await longBag();
    const before = await settingsRow();
    const gauze = await named<ItemBody>('item', 'Gauze');
    const backpack = await named<BagBody>('bag', 'Demo: Outreach backpack');
    const template = [{ itemId: gauze.id, min: 15 }];
    try {
      await changedMeanwhile<SettingsBody>('settings', before.id, (b) => ({
        ...b,
        newBagMinimums: template,
      }));
      await signIn(page, 'admin@example.com');
      const traffic = watchTraffic(page);
      await page.goto(PAGE);
      const form = page.getByRole('form', { name: 'Add a bag' });
      const name = form.getByLabel('Name', { exact: true });
      const copyFrom = form.getByLabel('Copy from');
      const reason = form.getByLabel('Reason');
      const add = form.getByRole('button', { name: 'Add bag' });
      const alert = form.getByRole('alert');
      const lines = form.getByRole('group', { name: /^Line \d+$/ });
      const line = (n: number) => form.getByRole('group', { name: `Line ${n}`, exact: true });
      // What the form says: its answer, or each fill of the lines, whichever it holds now.
      const said = form.getByRole('status').filter({ hasText: /\S/ });

      // From the template, to start with.
      await expect(copyFrom).toHaveValue('template');
      await expect(lines).toHaveCount(1);
      await expect(line(1).getByLabel('Item')).toHaveValue(gauze.id);
      await expect(line(1).getByLabel('Minimum')).toHaveValue('15');

      // Nothing typed: the reason is asked first. Then the name, the lines kept as sent.
      await add.click();
      await expect(alert).toBeFocused();
      await expect(alert).toContainText('Give a reason of 3 to 300 characters.');
      await reason.fill('Demo: a bag for foot care');
      await add.click();
      await expect(alert.getByRole('link')).toHaveText(['Name: Enter a name of 1 to 80 characters.']);
      await expect(line(1).getByLabel('Minimum')).toHaveValue('15');
      await expectAccessible(page, 'Add a bag, refused', { inPlace: true });
      await expectReflow(page, 'Add a bag, refused');

      // Copy from a bag, after the refusal: its list fills the lines, and a screen reader is told.
      await copyFrom.selectOption({ label: 'Demo: Outreach backpack' });
      await expect(said).toHaveText(
        `Minimums filled from Demo: Outreach backpack: ${backpack.body.minimums.length} items.`,
      );
      await expect(lines).toHaveCount(backpack.body.minimums.length);
      for (const [i, m] of backpack.body.minimums.entries()) {
        await expect(line(i + 1).getByLabel('Item')).toHaveValue(m.itemId);
        await expect(line(i + 1).getByLabel('Minimum')).toHaveValue(String(m.min));
      }
      // Chosen again, the template fills them again, said in running text; a bag that holds none
      // empties them, said plainly; then the bag, changed before it is added.
      await copyFrom.selectOption({ label: 'The template for new bags' });
      await expect(said).toHaveText('Minimums filled from the template for new bags: 1 item.');
      await expect(lines).toHaveCount(1);
      await copyFrom.selectOption({ label: LONG_BAG });
      await expect(said).toHaveText(`${LONG_BAG} holds no minimums, so none are filled.`);
      await expect(lines).toHaveCount(0);
      await copyFrom.selectOption({ label: 'Demo: Outreach backpack' });
      await expect(lines).toHaveCount(backpack.body.minimums.length);
      await line(2).getByLabel('Minimum').fill('12');
      await form.getByRole('button', { name: `Take out line ${backpack.body.minimums.length}` }).click();

      // A name another bag holds, in any case: said beside the name, the lines kept.
      await name.fill('demo: outreach backpack');
      await add.click();
      await expect(alert.locator('.px-alert__title')).toHaveText(FIELDS_TITLE);
      await expect(alert.getByRole('link')).toHaveText(['Name: Another bag already has this name.']);
      await expect(copyFrom).toHaveValue(backpack.id);
      await expect(lines).toHaveCount(backpack.body.minimums.length - 1);
      await expect(line(2).getByLabel('Minimum')).toHaveValue('12');

      // Added: what the form held is what is stored, never the list it was copied from.
      await name.fill('Demo: Foot care bag');
      await add.click();
      await expect(said).toHaveText('Added: Demo: Foot care bag. It’s on the phones after their next sync.');
      const sent = backpack.body.minimums.slice(0, -1).map((m, i) => (i === 1 ? { ...m, min: 12 } : m));
      expect(await named<BagBody>('bag', 'Demo: Foot care bag')).toMatchObject({
        version: 1,
        body: { name: 'Demo: Foot care bag', minimums: sent },
      });
      expect((await named<BagBody>('bag', 'Demo: Outreach backpack')).body).toEqual(backpack.body);
      const names = await itemNames();
      const footCare = page.getByRole('region', { name: 'Demo: Foot care bag', exact: true });
      await expect(factOf(footCare, 'Minimums').getByRole('listitem')).toHaveText(sent.map(minimumOf(names)));
      await expect(
        footCare
          .getByRole('region', { name: 'History of Demo: Foot care bag' })
          .getByRole('row', { name: /Added, version 1/ }),
      ).toContainText('Demo: a bag for foot care');
      // The form is ready for the next one, from the template again; Copy from offers the new bag.
      await expect(name).toHaveValue('');
      await expect(copyFrom).toHaveValue('template');
      await expect(lines).toHaveCount(1);
      await expect(line(1).getByLabel('Minimum')).toHaveValue('15');
      await expect(copyFrom.getByRole('option', { name: 'Demo: Foot care bag' })).toHaveCount(1);
      await expect(reason).toHaveValue('');

      // Another added on the first try, from the template as it starts.
      await name.fill('Demo: Wound care bag');
      await reason.fill('Demo: a bag for wound care');
      await add.click();
      await expect(said).toHaveText('Added: Demo: Wound care bag. It’s on the phones after their next sync.');
      expect((await named<BagBody>('bag', 'Demo: Wound care bag')).body.minimums).toEqual(template);

      await expectNothingStored(page, 'Bag minimums after an add');
      expectOnlyIds(traffic.addresses);
    } finally {
      await settingsBack(before.body);
    }
  });

  test('editing a bag saves its name and minimums at its next version with its history, refuses a save that changes nothing, and stays stale until reloaded', async ({
    page,
  }) => {
    test.slow();
    const socks = await named<ItemBody>('item', 'Socks');
    const bandage = await named<ItemBody>('item', 'Bandage');
    const id = await made('bag', { name: 'Demo: Shelter bag', minimums: [{ itemId: socks.id, min: 5 }] });
    const bag = async () => (await listed<BagBody>('bag')).find((b) => b.id === id);
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const section = (name: string) => page.getByRole('region', { name, exact: true });
    await section('Demo: Shelter bag')
      .getByRole('button', { name: 'Edit Demo: Shelter bag', exact: true })
      .click();
    let form = section('Demo: Shelter bag').getByRole('form', { name: 'Edit Demo: Shelter bag' });
    const line = (n: number) => form.getByRole('group', { name: `Line ${n}`, exact: true });
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Demo: Shelter bag');
    await expect(line(1).getByLabel('Item')).toHaveValue(socks.id);
    await expect(line(1).getByLabel('Minimum')).toHaveValue('5');

    // Saved as it is: nothing changed.
    await form.getByLabel('Reason').fill('Demo: more for the shelter');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText('You haven’t changed anything.');

    // Renamed, a minimum raised and a line added: saved at version 2.
    await form.getByLabel('Name', { exact: true }).fill('Demo: Night shelter bag');
    await line(1).getByLabel('Minimum').fill('8');
    await form.getByRole('button', { name: 'Add an item' }).click();
    await line(2).getByLabel('Item').selectOption({ label: 'Bandage' });
    await line(2).getByLabel('Minimum').fill('3');
    await form.getByRole('button', { name: 'Save' }).click();
    form = section('Demo: Night shelter bag').getByRole('form', { name: 'Edit Demo: Night shelter bag' });
    await expect(form.getByRole('status')).toHaveText(
      'Saved: Demo: Night shelter bag. It’s on the phones after their next sync.',
    );
    expect(await bag()).toMatchObject({
      version: 2,
      body: {
        name: 'Demo: Night shelter bag',
        minimums: [
          { itemId: socks.id, min: 8 },
          { itemId: bandage.id, min: 3 },
        ],
      },
    });
    const saved = section('Demo: Night shelter bag');
    await expect(factOf(saved, 'Minimums').getByRole('listitem')).toHaveText([
      'Socks: at least 8',
      'Bandage: at least 3',
    ]);
    await expect(
      saved
        .getByRole('region', { name: 'History of Demo: Night shelter bag' })
        .getByRole('row', { name: /Edited, version 2/ }),
    ).toContainText('Demo: more for the shelter');

    // Another admin edits it meanwhile: this form, at version 2, is stale, and stays so.
    expect(
      await changedMeanwhile<BagBody>('bag', id, (b) => ({ ...b, minimums: [{ itemId: socks.id, min: 9 }] })),
    ).toBe(3);
    await line(1).getByLabel('Minimum').fill('10');
    await form.getByLabel('Reason').fill('Demo: winter is coming');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(STALE);
    await expect(line(1).getByLabel('Minimum')).toHaveValue('10');
    await expectAccessible(page, 'Edit a bag, stale', { inPlace: true });
    await expectReflow(page, 'Edit a bag, stale');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert')).toHaveText(STALE);
    expect(await bag()).toMatchObject({ version: 3, body: { minimums: [{ itemId: socks.id, min: 9 }] } });
    // Reloaded, the page shows their version.
    await page.reload();
    await expect(factOf(section('Demo: Night shelter bag'), 'Minimums')).toHaveText('Socks: at least 9');
  });

  test('Remove moves a bag to Removed, and Restore brings it back once no other has its name, each with its reason in its history', async ({
    page,
  }) => {
    test.slow();
    const socks = await named<ItemBody>('item', 'Socks');
    const body = { name: 'Demo: Spare bag', minimums: [{ itemId: socks.id, min: 2 }] };
    const id = await made('bag', body);
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(PAGE);
    await page.getByRole('button', { name: 'Remove Demo: Spare bag', exact: true }).click();
    const remove = page.getByRole('form', { name: 'Remove Demo: Spare bag' });
    await remove.getByLabel('Reason').fill('Demo: lent to another team');
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}\\?done=removed&preset=${id}$`));
    await expect(page.getByRole('heading', { name: 'Removed: Demo: Spare bag' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Demo: Spare bag', exact: true })).toHaveCount(0);
    const removed = page.getByRole('region', { name: /^Removed \(\d+\)$/ });
    await expect(removed).toContainText('Demo: Spare bag');
    // A removed bag is offered for no copy.
    await expect(
      page.getByRole('form', { name: 'Add a bag' }).getByLabel('Copy from').getByRole('option', {
        name: 'Demo: Spare bag',
      }),
    ).toHaveCount(0);
    await expectAccessible(page, 'Bag minimums after a remove');

    // Another bag has taken its name since: the restore is refused.
    const taker = await made('bag', body);
    await page.reload();
    await removed.getByRole('button', { name: 'Restore Demo: Spare bag', exact: true }).click();
    const restore = removed.getByRole('form', { name: 'Restore Demo: Spare bag' });
    await restore.getByLabel('Reason').fill('Demo: back from the other team');
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(restore.getByRole('alert')).toHaveText(
      'Another bag has this name now. Rename that one first.',
    );
    await expect(restore.getByLabel('Reason')).toHaveValue('Demo: back from the other team');
    await expectAccessible(page, 'Restore a bag, refused', { inPlace: true });
    await expectReflow(page, 'Restore a bag, refused');

    // Once that one is renamed, restored at the version it was removed at.
    await changedMeanwhile<BagBody>('bag', taker, (b) => ({ ...b, name: 'Demo: Spare bag, second' }));
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}\\?done=restored&preset=${id}$`));
    await expect(page.getByRole('heading', { name: 'Restored: Demo: Spare bag' })).toBeFocused();
    const history = page
      .getByRole('region', { name: 'Demo: Spare bag', exact: true })
      .getByRole('region', { name: 'History of Demo: Spare bag' });
    await expect(history.getByRole('row', { name: /Removed, version 1/ })).toContainText(
      'Demo: lent to another team',
    );
    await expect(history.getByRole('row', { name: /Restored, version 1/ })).toContainText(
      'Demo: back from the other team',
    );
    expect((await listed('bag')).find((b) => b.id === id)).toMatchObject({ state: 'active', version: 1 });

    await expectNothingStored(page, 'Bag minimums after a restore');
    expectOnlyIds(traffic.addresses);
  });

  test('a stale sign-in sends the switch through /reauth and back to the page, turning nothing', async ({
    page,
  }) => {
    const before = await settingsRow();
    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const on = before.body.bagMinimumsOn;
    const turn = page.getByRole('form', { name: on ? 'Turn bag minimums off' : 'Turn bag minimums on' });
    await turn.getByLabel('Reason').fill('Demo: an old sign-in');
    await turn.getByRole('button', { name: on ? 'Turn off' : 'Turn on' }).click();
    await expect(page).toHaveURL(/\/reauth\?next=%2Fteam%2Fpresets%2Fbag-minimums$/);
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bag minimums');
    expect(await settingsRow()).toMatchObject({ version: before.version, body: before.body });
  });

  test('a stale sign-in sends a bag being added through /reauth and back to the page, adding nothing', async ({
    page,
  }) => {
    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(PAGE);
    const form = page.getByRole('form', { name: 'Add a bag' });
    await form.getByLabel('Name', { exact: true }).fill('Demo: Never added bag');
    await form.getByLabel('Reason').fill('Demo: an old sign-in');
    await form.getByRole('button', { name: 'Add bag' }).click();
    await expect(page).toHaveURL(/\/reauth\?next=%2Fteam%2Fpresets%2Fbag-minimums$/);
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bag minimums');
    expect((await listed('bag')).some((b) => b.name === 'Demo: Never added bag')).toBe(false);
  });

  test('staff without the permission are refused Bag minimums at a typed address, logged once', async ({
    page,
  }) => {
    await signIn(page, 'clinician@example.com');
    const before = (await deniedOf('clinician@example.com')).length;
    await page.goto(PAGE);
    await expect(page).toHaveURL(/\/home\?denied=1$/);
    const after = await deniedOf('clinician@example.com');
    // The bags were asked, and refused: nothing else was.
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.details).toMatchObject({ permission: 'team.manage_presets' });
  });
});

// ------------------------------------------------------------------------------------------------
// Shared on every page (8.1): Sineobex's update, reviewed and taken
// ------------------------------------------------------------------------------------------------

/** A list row with the update on offer to it, as the admin list answers it (design 7). */
type Offered<B> = Row<B> & {
  customized: boolean;
  update: { platformVersion: number; body: B; changesFixed: string[] } | null;
};

async function offeredOf<B>(kind: string, id: string): Promise<Offered<B>> {
  return (await listed<B>(kind)).find((p) => p.id === id) as Offered<B>;
}

/** The e2e database as the API's own role (playwright.config.ts), for the one write no route makes. */
const API_DATABASE_URL =
  process.env.E2E_API_DATABASE_URL ??
  'postgres://sineobex_api_e2e:e2e-local-only@localhost:5432/sineobex_e2e';

/**
 * The installer's offer (design 5.2), for a copy of a platform preset: the platform ships version 1
 * of every entry, so no team is ever offered one in this database. The copy is marked as taken from
 * no platform version, so the version 1 it was installed from is on offer above it, and the list
 * answers its body, as taking it would write it, for review. Written as the API's role in the team's
 * scope, under the team lock, at a revision taken as takeRevision takes one, as 0023 asks of every
 * head written; with no event, as an offer writes none. A take gives the copy platform version 1
 * again, so nothing is left on offer, as the other cases of this file and every later spec expect;
 * a case that stops short has its offer taken back after it (noOfferLeft).
 */
function offerPlatformVersion(kind: string, id: string) {
  const sql = `
    begin;
    select set_config('app.team_id', :'team', true);
    select pg_advisory_xact_lock(hashtextextended('sineobex.audit:' || :'team'::uuid::text, 0));
    with taken as (
      update sineobex.team_preset_state set revision = revision + 1 where team_id = :'team'::uuid
      returning team_id, revision)
    select set_config('app.revision_' || replace(team_id::text, '-', ''), revision::text, true) from taken;
    update sineobex.team_presets
    set origin_version = null,
        revision = current_setting('app.revision_' || replace(:'team', '-', ''))::bigint
    where team_id = :'team'::uuid and id = :'id'::uuid and origin_key is not null
    returning 'offered ' || id;
    commit;`;
  const out = execFileSync(
    'psql',
    [
      API_DATABASE_URL,
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      `team=${TEAM}`,
      '-v',
      `id=${id}`,
    ],
    { input: sql, encoding: 'utf8' },
  );
  expect(out, 'the copy is offered its platform version').toContain(`offered ${id}`);
  OFFERED.push([kind, id]);
}

const OFFERED: [kind: string, id: string][] = [];

/**
 * Whatever a case left on offer, taken back as another admin would take it, so a case that stopped
 * short leaves nothing for the hub's and Flags' "nothing on offer" in the narrow run.
 */
async function noOfferLeft() {
  for (const [kind, id] of OFFERED.splice(0)) {
    const row = await offeredOf(kind, id);
    if (!row.update) continue;
    const res = await apiCall(
      await staffToken('admin@example.com'),
      'POST',
      `/v1/admin/presets/${kind}/${id}/take-update`,
      {
        baseVersion: row.version,
        platformVersion: row.update.platformVersion,
        asNew: false,
        reason: 'Demo: nothing left on offer',
      },
    );
    expect(res.status, `the update to ${row.name} taken back`).toBe(200);
  }
}

/** A row of the review: the field, then its value now and in the update, said "Changes" where they differ. */
async function expectReview(review: Locator, rows: [field: string, now: string, update: string][]) {
  const shown = review.getByRole('row');
  await expect(shown).toHaveCount(rows.length + 1);
  await expect(shown.first().getByRole('columnheader')).toHaveText([
    'Field',
    'Your copy now',
    'Sineobex’s new version',
  ]);
  for (const [i, [field, now, update]] of rows.entries()) {
    const row = shown.nth(i + 1);
    await expect(row.getByRole('rowheader')).toHaveText(now === update ? field : `${field} Changes`);
    await expect(row.getByRole('cell')).toHaveText([now, update]);
  }
}

test.describe('Sineobex’s update, on an item’s page', () => {
  test.afterEach(noOfferLeft);
  const LIST = '/team/presets/items';
  const ITEM_FIELDS = ['Name', 'Category', 'Counted in', 'Medical', 'Capture lot and expiry', 'Result'];

  test('an update on offer is badged on the hub and the list, reviewed field by field on its page, and taken with a reason once a stale take has shown what is on offer now', async ({
    page,
  }) => {
    test.slow();
    // A copy of a platform item the team edited, so Sineobex's version is only offered (5.2).
    const mepilex = await named<ItemBody>('item', 'Mepilex');
    await changedMeanwhile<ItemBody>('item', mepilex.id, (b) => ({
      ...b,
      name: 'Demo: Mepilex border',
      captureLot: true,
    }));
    offerPlatformVersion('item', mepilex.id);
    // What is on offer is the platform's version as the team installed it.
    expect(await offeredOf<ItemBody>('item', mepilex.id)).toMatchObject({
      version: 2,
      customized: true,
      updateOnOffer: true,
      update: { platformVersion: 1, body: mepilex.body, changesFixed: [] },
    });

    await signIn(page, 'admin@example.com');
    const csp = watchCsp(page);
    const traffic = watchTraffic(page);
    await portalNav(page).getByRole('link', { name: 'Presets', exact: true }).click();
    const cards = page.getByRole('main').getByRole('listitem');
    // Only the area that holds it is badged.
    await expect(cards.filter({ hasText: 'Update available' })).toHaveCount(1);
    const card = cards.filter({ has: page.getByRole('heading', { name: 'Items', exact: true }) });
    await expect(card.getByText('Update available', { exact: true })).toBeVisible();
    await card.getByRole('link', { name: 'Items', exact: true }).click();
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(1);
    const entry = page
      .getByRole('region', { name: 'Supplies', exact: true })
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'Demo: Mepilex border', exact: true }) });
    await expect(entry.getByText('Update available', { exact: true })).toBeVisible();
    await entry.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`${LIST}/${mepilex.id}$`));

    // Its page offers Sineobex's version, to review before it replaces the team's.
    const offer = (name: string) => page.getByRole('region', { name: `Update available for ${name}` });
    const take = (name: string) => page.getByRole('form', { name: `Take Sineobex’s update to ${name}` });
    await expect(offer('Demo: Mepilex border')).toContainText(
      'Sineobex updated this preset. Your edited copy hasn’t changed.',
    );
    await expect(offer('Demo: Mepilex border')).not.toContainText('Add it as a new one');
    await expect(take('Demo: Mepilex border').getByRole('button')).toHaveText([
      'Replace with the new version',
    ]);
    await expect(take('Demo: Mepilex border').getByLabel('Reason')).toHaveAccessibleDescription(
      'Don’t put patient names here.',
    );
    const review = (name: string) =>
      offer(name).getByRole('table', { name: `What taking the update changes in ${name}` });
    await expect(review('Demo: Mepilex border')).toBeHidden();
    await offer('Demo: Mepilex border').getByText('Review', { exact: true }).click();
    const values = (name: string, lot: string): [string, string, string][] =>
      ITEM_FIELDS.map((field, i) => [
        field,
        [name, 'Supplies', 'each', 'No', lot, 'None'][i]!,
        ['Mepilex', 'Supplies', 'each', 'No', 'No', 'None'][i]!,
      ]);
    await expectReview(review('Demo: Mepilex border'), values('Demo: Mepilex border', 'Yes'));
    await expectAccessible(page, 'An update on offer, reviewed', { inPlace: true });
    await expectReflow(page, 'An update on offer, reviewed');

    // Another admin edits the copy meanwhile: the take is refused stale, the page is read again, and
    // the review opens on what taking the update changes now, the reason kept.
    await changedMeanwhile<ItemBody>('item', mepilex.id, (b) => ({ ...b, name: 'Demo: Mepilex dressing' }));
    await take('Demo: Mepilex border').getByLabel('Reason').fill('Demo: back to Sineobex’s dressing');
    await take('Demo: Mepilex border').getByRole('button', { name: 'Replace with the new version' }).click();
    await expect(take('Demo: Mepilex dressing').getByRole('alert')).toHaveText(TAKE_STALE.copyChanged);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo: Mepilex dressing');
    await expect(review('Demo: Mepilex dressing')).toBeVisible();
    await expectReview(review('Demo: Mepilex dressing'), values('Demo: Mepilex dressing', 'Yes'));
    await expect(take('Demo: Mepilex dressing').getByLabel('Reason')).toHaveValue(
      'Demo: back to Sineobex’s dressing',
    );
    expect(await offeredOf<ItemBody>('item', mepilex.id)).toMatchObject({ version: 3, updateOnOffer: true });
    await expectAccessible(page, 'A take refused stale', { inPlace: true });
    await expectReflow(page, 'A take refused stale');

    // Taken, now that the copy reviewed is the copy held: Sineobex's version, back on the list.
    await take('Demo: Mepilex dressing')
      .getByRole('button', { name: 'Replace with the new version' })
      .click();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?done=updated&preset=${mepilex.id}$`));
    await expect(page.getByRole('heading', { name: 'Update taken: Mepilex' })).toBeFocused();
    await expect(page.getByRole('main')).toContainText(
      'Sineobex’s new version is in place, on the phones after their next sync.',
    );
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);
    expect(await offeredOf<ItemBody>('item', mepilex.id)).toMatchObject({
      name: 'Mepilex',
      version: 4,
      customized: false,
      updateOnOffer: false,
      update: null,
      body: mepilex.body,
    });
    expect((await historyOf('item', mepilex.id)).at(-1)).toMatchObject({
      act: 'update_taken',
      version: 4,
      source: 'platform',
      by: { displayName: 'Alex Rivera (demo)' },
      reason: 'Demo: back to Sineobex’s dressing',
    });
    await expectAccessible(page, 'Items after an update taken');

    // Its page offers nothing now, and its history says who took Sineobex's version, and why.
    await page
      .getByRole('region', { name: 'Supplies', exact: true })
      .getByRole('link', { name: 'Mepilex', exact: true })
      .click();
    await expect(page.getByRole('region', { name: /^Update available/ })).toHaveCount(0);
    const taken = page.getByRole('region', { name: 'History' }).getByRole('row', {
      name: /Sineobex’s update taken, version 4/,
    });
    await expect(taken.getByRole('cell')).toContainText([
      'Alex Rivera (demo)',
      'Sineobex’s',
      'Demo: back to Sineobex’s dressing',
    ]);
    await portalNav(page).getByRole('link', { name: 'Presets', exact: true }).click();
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);

    await expectNothingStored(page, 'An update taken');
    expectOnlyIds(traffic.addresses);
    expect(csp).toEqual([]);
  });

  test('a stale sign-in sends a take through /reauth and back, taking nothing; once another admin took the update, a take is refused and says nothing is on offer', async ({
    page,
  }) => {
    const aquacel = await named<ItemBody>('item', 'Aquacel');
    const version = await changedMeanwhile<ItemBody>('item', aquacel.id, (b) => ({
      ...b,
      name: 'Demo: Aquacel ribbon',
    }));
    offerPlatformVersion('item', aquacel.id);
    const here = `${LIST}/${aquacel.id}`;
    const take = (name: string) => page.getByRole('form', { name: `Take Sineobex’s update to ${name}` });

    await staleSignIn();
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(here);
    await take('Demo: Aquacel ribbon').getByLabel('Reason').fill('Demo: an old sign-in');
    await take('Demo: Aquacel ribbon').getByRole('button', { name: 'Replace with the new version' }).click();
    await expect(page).toHaveURL(`/reauth?next=${encodeURIComponent(here)}`);
    await page.getByLabel('6-digit code').fill(MFA_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`${here}$`));
    expect(await offeredOf<ItemBody>('item', aquacel.id)).toMatchObject({ version, updateOnOffer: true });

    // Another admin takes it meanwhile: this take is refused, and the page, read again, has nothing
    // on offer, which the form says beside the refusal.
    const other = await apiCall(
      await staffToken('admin@example.com'),
      'POST',
      `/v1/admin/presets/item/${aquacel.id}/take-update`,
      { baseVersion: version, platformVersion: 1, asNew: false, reason: 'Demo: another admin’s take' },
    );
    expect(other.status).toBe(200);
    await take('Demo: Aquacel ribbon').getByLabel('Reason').fill('Demo: Sineobex’s ribbon');
    await take('Demo: Aquacel ribbon').getByRole('button', { name: 'Replace with the new version' }).click();
    const gone = page.getByRole('region', { name: 'Sineobex’s update for Aquacel' });
    await expect(gone.getByRole('alert')).toHaveText(TAKE_STALE.noOffer);
    await expect(gone).toContainText('Nothing is on offer for this now.');
    await expect(gone.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aquacel');
    await expectAccessible(page, 'A take refused once the update has gone', { inPlace: true });
    expect(await offeredOf<ItemBody>('item', aquacel.id)).toMatchObject({
      version: version + 1,
      updateOnOffer: false,
      body: aquacel.body,
    });
    expect((await historyOf('item', aquacel.id)).filter((e) => e.act === 'update_taken')).toHaveLength(1);
    await expectNothingStored(page, 'A take refused once the update has gone');
    expectOnlyIds(traffic.addresses);
  });

  test('a take refused for its reason keeps the versions it was opened at, so another admin’s change meanwhile is refused stale, never taken unseen', async ({
    page,
  }) => {
    // Review A's D: the copy at version 2, offered Sineobex's version 1, its review open.
    const pad = await named<ItemBody>('item', 'Hydrocolloid');
    const shown = await changedMeanwhile<ItemBody>('item', pad.id, (b) => ({
      ...b,
      name: 'Demo: Hydrocolloid pad',
    }));
    offerPlatformVersion('item', pad.id);
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(`${LIST}/${pad.id}`);
    const offer = (name: string) => page.getByRole('region', { name: `Update available for ${name}` });
    const take = (name: string) => page.getByRole('form', { name: `Take Sineobex’s update to ${name}` });
    const sent = (name: string, field: string) => take(name).locator(`input[type="hidden"][name="${field}"]`);
    await offer('Demo: Hydrocolloid pad').locator('summary').click();
    await expect(sent('Demo: Hydrocolloid pad', 'baseVersion')).toHaveValue(String(shown));
    await expect(sent('Demo: Hydrocolloid pad', 'platformVersion')).toHaveValue('1');

    // Another admin edits the copy; the take, sent without a reason, is refused for the reason
    // alone, and the page is read again: the form still holds the versions the review was opened at.
    const theirs = await changedMeanwhile<ItemBody>('item', pad.id, (b) => ({
      ...b,
      name: 'Demo: Hydrocolloid sheet',
    }));
    await take('Demo: Hydrocolloid pad')
      .getByRole('button', { name: 'Replace with the new version' })
      .click();
    const form = take('Demo: Hydrocolloid sheet');
    await expect(form.getByRole('alert')).toContainText('Give a reason of 3 to 300 characters.');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo: Hydrocolloid sheet');
    await expect(sent('Demo: Hydrocolloid sheet', 'baseVersion')).toHaveValue(String(shown));
    await expect(sent('Demo: Hydrocolloid sheet', 'platformVersion')).toHaveValue('1');

    // With a reason, it is refused stale: the other admin's version is never replaced unseen.
    await form.getByLabel('Reason').fill('Demo: Sineobex’s dressing again');
    await form.getByRole('button', { name: 'Replace with the new version' }).click();
    await expect(form.getByRole('alert')).toHaveText(TAKE_STALE.copyChanged);
    expect(await offeredOf<ItemBody>('item', pad.id)).toMatchObject({
      name: 'Demo: Hydrocolloid sheet',
      version: theirs,
      updateOnOffer: true,
    });
    expect((await historyOf('item', pad.id)).filter((e) => e.act === 'update_taken')).toEqual([]);
    // Refused stale, the form follows the page, so the next take sends what the review shows now.
    await expect(sent('Demo: Hydrocolloid sheet', 'baseVersion')).toHaveValue(String(theirs));
    await expect(form.getByLabel('Reason')).toHaveValue('Demo: Sineobex’s dressing again');
    await form.getByRole('button', { name: 'Replace with the new version' }).click();
    await expect(page).toHaveURL(new RegExp(`${LIST}\\?done=updated&preset=${pad.id}$`));
    expect((await historyOf('item', pad.id)).map((e) => [e.act, e.version])).toEqual([
      ['installed', 1],
      ['updated', shown],
      ['updated', theirs],
      ['update_taken', theirs + 1],
    ]);
    await expectNothingStored(page, 'A take refused for its reason, then stale, then taken');
    expectOnlyIds(traffic.addresses);
  });
});

test.describe('Sineobex’s update, on a flag the team ranked', () => {
  test.afterEach(noOfferLeft);
  test('the review shows the place in its list that taking the update gives back, and the flag takes that place', async ({
    page,
  }) => {
    test.slow();
    // The team moves a platform condition to the end of its list, so its rank is the team's own.
    const before = await tierOf('secondary');
    const flag = before.find((f) => f.name === 'Dehydration risk')!;
    const order = [...before.filter((f) => f.id !== flag.id), flag];
    const moved = await apiCall(
      await staffToken('admin@example.com'),
      'POST',
      '/v1/admin/preset-order/flag',
      {
        tier: 'secondary',
        flags: order.map((f) => ({ id: f.id, baseVersion: f.version })),
        reason: 'Demo: little dehydration this month',
      },
    );
    expect(moved.status).toBe(200);
    const ranked = await offeredOf<FlagBody>('flag', flag.id);
    offerPlatformVersion('flag', flag.id);
    const { update } = await offeredOf<FlagBody>('flag', flag.id);
    expect(update).toMatchObject({ platformVersion: 1, changesFixed: [] });
    expect(update!.body.rank).not.toBe(ranked.body.rank);

    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto('/team/presets/flags');
    const last = page.getByRole('region', { name: 'Conditions', exact: true }).getByRole('listitem').last();
    await expect(last.getByRole('link')).toHaveText(pillOf(ranked));
    await expect(last.getByText('Update available', { exact: true })).toBeVisible();
    await last.getByRole('link').click();
    await expect(page).toHaveTitle('Flag · Sineobex');

    const offer = page.getByRole('region', { name: `Update available for ${flag.name}` });
    await offer.getByText('Review', { exact: true }).click();
    const said = (criteria: string) => criteria || 'None';
    await expectReview(offer.getByRole('table', { name: `What taking the update changes in ${flag.name}` }), [
      ['Name', ranked.name, update!.body.name],
      ['List', 'Conditions', 'Conditions'],
      ['Criteria', said(ranked.body.criteria), said(update!.body.criteria)],
      ['Colour', COLOUR_NAMES[ranked.body.color]!, COLOUR_NAMES[update!.body.color]!],
      ['Place in its list (lowest first)', String(ranked.body.rank), String(update!.body.rank)],
      ['Sensitive', 'No', 'No'],
    ]);
    await expectAccessible(page, 'A flag’s update, reviewed', { inPlace: true });
    await expectReflow(page, 'A flag’s update, reviewed');

    const take = page.getByRole('form', { name: `Take Sineobex’s update to ${flag.name}` });
    await take.getByLabel('Reason').fill('Demo: Sineobex’s order again');
    await take.getByRole('button', { name: 'Replace with the new version' }).click();
    await expect(page).toHaveURL(new RegExp(`/team/presets/flags\\?done=updated&preset=${flag.id}$`));
    await expect(page.getByRole('heading', { name: `Update taken: ${flag.name}` })).toBeFocused();
    expect(await offeredOf<FlagBody>('flag', flag.id)).toMatchObject({
      customized: false,
      updateOnOffer: false,
      update: null,
      body: update!.body,
    });
    // It is where the platform's rank puts it; a flag the team ranked the same is ordered by name.
    const after = await tierOf('secondary');
    await expect(
      page.getByRole('region', { name: 'Conditions', exact: true }).getByRole('listitem').getByRole('link'),
    ).toHaveText(after.map(pillOf));
    expect(after.at(-1)!.id).not.toBe(flag.id);
    await expectNothingStored(page, 'A flag’s update taken');
    expectOnlyIds(traffic.addresses);
  });
});

test.describe('Sineobex’s update, to the team’s settings', () => {
  test.afterEach(noOfferLeft);

  test('an update to the settings badges both cards that show them, is reviewed on Condition supplies, and taken there puts Sineobex’s settings back', async ({
    page,
  }) => {
    test.slow();
    const settings = await settingsRow();
    // The team's own window, so Sineobex's version is only offered.
    await changedMeanwhile<SettingsBody>('settings', settings.id, (b) => ({ ...b, problemCheckDays: 60 }));
    offerPlatformVersion('settings', settings.id);
    const offered = await offeredOf<SettingsBody>('settings', settings.id);
    expect(offered.update).toMatchObject({ platformVersion: 1, changesFixed: [] });
    const update = offered.update!.body;

    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await portalNav(page).getByRole('link', { name: 'Presets', exact: true }).click();
    const cards = page.getByRole('main').getByRole('listitem');
    const card = (title: string) =>
      cards.filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(cards.filter({ hasText: 'Update available' })).toHaveCount(2);
    for (const title of ['Condition supplies', 'Bag minimums'])
      await expect(card(title).getByText('Update available', { exact: true })).toBeVisible();
    await card('Condition supplies').getByRole('link', { name: 'Condition supplies', exact: true }).click();

    const offer = page.getByRole('region', { name: `Update available for ${offered.name}` });
    await expect(offer).toContainText('Sineobex updated this preset. Your edited copy hasn’t changed.');
    await offer.getByText('Review', { exact: true }).click();
    const onOff = (on: boolean) => (on ? 'On' : 'Off');
    // Bag minimums' cases put the template back empty, as the platform's is.
    expect([offered.body.newBagMinimums, update.newBagMinimums]).toEqual([[], []]);
    await expectReview(
      offer.getByRole('table', { name: `What taking the update changes in ${offered.name}` }),
      [
        ['Bag minimums', onOff(offered.body.bagMinimumsOn), onOff(update.bagMinimumsOn)],
        ['Template for new bags', 'None', 'None'],
        ['Check problems not updated in', '60 days', `${update.problemCheckDays} days`],
      ],
    );
    await expectAccessible(page, 'An update to the settings, reviewed', { inPlace: true });
    await expectReflow(page, 'An update to the settings, reviewed');

    const take = page.getByRole('form', { name: `Take Sineobex’s update to ${offered.name}` });
    await take.getByLabel('Reason').fill('Demo: Sineobex’s window again');
    await take.getByRole('button', { name: 'Replace with the new version' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/team/presets/condition-supplies\\?done=updated&preset=${settings.id}$`),
    );
    await expect(page.getByRole('heading', { name: `Update taken: ${offered.name}` })).toBeFocused();
    await expect(page.getByLabel('Check problems not updated in')).toHaveValue(
      String(update.problemCheckDays),
    );
    expect(await offeredOf<SettingsBody>('settings', settings.id)).toMatchObject({
      customized: false,
      updateOnOffer: false,
      update: null,
      body: update,
    });
    // Bag minimums, the other page that shows the settings, offers nothing either.
    await portalNav(page).getByRole('link', { name: 'Presets', exact: true }).click();
    await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);
    await card('Bag minimums').getByRole('link', { name: 'Bag minimums', exact: true }).click();
    await expect(page.getByRole('region', { name: /^Update available/ })).toHaveCount(0);
    await expectNothingStored(page, 'An update to the settings taken');
    expectOnlyIds(traffic.addresses);
  });
});

test.describe('Sineobex’s update, to two categories nobody edited', () => {
  test.afterEach(noOfferLeft);
  test('each offer says Sineobex updated the category, and says nothing of an edited copy, since nobody edited it', async ({
    page,
  }) => {
    const PAGE = '/team/presets/categories';
    const offered = [
      await named<CategoryBody>('order_category', 'OTC'),
      await named<CategoryBody>('order_category', 'Rx'),
    ];
    for (const row of offered) {
      offerPlatformVersion('order_category', row.id);
      expect(await offeredOf<CategoryBody>('order_category', row.id)).toMatchObject({
        customized: false,
        updateOnOffer: true,
        update: { platformVersion: 1, changesFixed: [] },
      });
    }
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    await page.goto(PAGE);
    for (const { name } of offered) {
      const offer = page.getByRole('region', { name: `Update available for ${name}` });
      await expect(offer.locator('p', { hasText: /^Sineobex updated/ })).toHaveText(
        'Sineobex updated this preset.',
      );
      await expect(offer).not.toContainText('Your edited copy');
    }
    await expectAccessible(page, 'Categories, two offered an update');
    await expectReflow(page, 'Categories, two offered an update');
    await expectNothingStored(page, 'Categories, two offered an update');
    expectOnlyIds(traffic.addresses);
  });
});

test.describe('an item the template for new bags holds', () => {
  test('its page says the template uses it, and Remove is refused while the template holds it', async ({
    page,
  }) => {
    const settings = await settingsRow();
    const { id: categoryId } = await named<CategoryBody>('order_category', 'Supplies');
    const powder = await made('item', {
      name: 'Demo: Foot powder',
      categoryId,
      unit: 'each',
      medical: false,
      captureLot: false,
      result: null,
    });
    await changedMeanwhile<SettingsBody>('settings', settings.id, (b) => ({
      ...b,
      newBagMinimums: [{ itemId: powder, min: 2 }],
    }));
    try {
      await signIn(page, 'admin@example.com');
      await page.goto(`/team/presets/items/${powder}`);
      await expect(page.getByRole('main').locator('.px-lede')).toHaveText(
        'In Supplies, counted in each. Used by the template for new bags.',
      );
      await page.getByRole('button', { name: 'Remove Demo: Foot powder', exact: true }).click();
      const remove = page.getByRole('form', { name: 'Remove Demo: Foot powder' });
      await remove.getByLabel('Reason').fill('Demo: nobody asks for it');
      await remove.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(remove.getByRole('alert')).toHaveText(
        'Still used by the template for new bags. Take it out of that first.',
      );
      await expectAccessible(page, 'Remove refused, the template holds it', { inPlace: true });
      expect((await listed('item')).find((i) => i.id === powder)).toMatchObject({ state: 'active' });
    } finally {
      await settingsBack(settings.body);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// Shared on every page (8.1): Remove, Restore and a save, after another admin acted meanwhile
// ------------------------------------------------------------------------------------------------

// A refused act reads the page again, as a done one does. Where another admin's act changed what
// the page draws for the preset (removed or restored it), the page draws it as it is now, and the
// form that was refused, with its sentence and what was typed, goes with the preset's old state.
/** An item of the team's own among its supplies, as another admin would add it; its ID. */
async function madeSupply(name: string): Promise<string> {
  const { id: categoryId } = await named<CategoryBody>('order_category', 'Supplies');
  return made('item', { name, categoryId, unit: 'each', medical: false, captureLot: false, result: null });
}

/** A Non-Medical bundle of one item, as another admin would add it; its ID. */
async function madeBundle(name: string, itemId: string): Promise<string> {
  return made('bundle', { name, medical: false, prompt: '', lines: [{ itemId, qty: 1, core: true }] });
}

test.describe('acts after another admin acted meanwhile', () => {
  test('Remove is refused stale after another admin changed the bundle meanwhile, and after another admin removed it the page shows it removed; neither removes it again', async ({
    page,
  }) => {
    const splint = await madeSupply('Demo: Finger splint');
    const id = await madeBundle('Demo: Splinting', splint);
    const here = `/team/presets/bundles/${id}`;
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    const remove = page.getByRole('form', { name: 'Remove Demo: Splinting' });

    // Changed meanwhile: the version the form holds is stale.
    await page.goto(here);
    await page.getByRole('button', { name: 'Remove Demo: Splinting', exact: true }).click();
    await remove.getByLabel('Reason').fill('Demo: we stopped splinting');
    await changedMeanwhile<BundleBody>('bundle', id, (b) => ({
      ...b,
      prompt: 'Demo: check the finger first.',
    }));
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(remove.getByRole('alert')).toHaveText(STALE);
    await expect(remove.getByLabel('Reason')).toHaveValue('Demo: we stopped splinting');
    await expectAccessible(page, 'Remove refused stale', { inPlace: true });
    expect((await listed('bundle')).find((b) => b.id === id)).toMatchObject({ state: 'active', version: 2 });

    // Read again, then removed meanwhile: refused, the page shows it removed, with Restore.
    await page.goto(here);
    await page.getByRole('button', { name: 'Remove Demo: Splinting', exact: true }).click();
    await remove.getByLabel('Reason').fill('Demo: we stopped splinting');
    await actedMeanwhile('bundle', id, 'archive');
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    const removed = page.getByRole('region', { name: 'Removed', exact: true });
    await expect(removed).toContainText(
      'This bundle isn’t offered for new work. Restore it to offer it again.',
    );
    await expect(remove).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${here}$`));
    await expect(
      page.getByRole('region', { name: 'History' }).getByRole('row', { name: /Removed, version 2/ }),
    ).toContainText('Demo: another admin’s act');
    expect((await historyOf('bundle', id)).filter((e) => e.act === 'archived')).toHaveLength(1);
    await expectAccessible(page, 'A bundle removed meanwhile');
    await expectNothingStored(page, 'Remove after another admin acted');
    expectOnlyIds(traffic.addresses);
  });

  test('Restore after another admin restored the bundle meanwhile shows it back on the list, and Restore of a bundle whose item was removed since is refused with its sentence', async ({
    page,
  }) => {
    const sling = await madeSupply('Demo: Arm sling');
    const id = await madeBundle('Demo: Sling care', sling);
    await actedMeanwhile('bundle', id, 'archive');
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);
    const removed = page.getByRole('region', { name: /^Removed \(\d+\)$/ });
    const restore = page.getByRole('form', { name: 'Restore Demo: Sling care' });

    // Restored meanwhile: the page's Removed list was read before it.
    await page.goto('/team/presets/bundles');
    await removed.getByRole('button', { name: 'Restore Demo: Sling care', exact: true }).click();
    await restore.getByLabel('Reason').fill('Demo: slings are back');
    await actedMeanwhile('bundle', id, 'restore');
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Your team’s bundles' })
        .getByRole('link', { name: 'Demo: Sling care', exact: true }),
    ).toBeVisible();
    await expect(restore).toHaveCount(0);
    await expect(removed.getByText('Demo: Sling care', { exact: true })).toHaveCount(0);
    expect((await historyOf('bundle', id)).filter((e) => e.act === 'restored')).toMatchObject([
      { reason: 'Demo: another admin’s act' },
    ]);

    // Removed again, and its item removed since: it can't come back naming what was removed.
    await actedMeanwhile('bundle', id, 'archive');
    await actedMeanwhile('item', sling, 'archive');
    await page.goto('/team/presets/bundles');
    await removed.getByRole('button', { name: 'Restore Demo: Sling care', exact: true }).click();
    await restore.getByLabel('Reason').fill('Demo: slings are back');
    await restore.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(restore.getByRole('alert')).toHaveText(
      'It names something that was removed since. Restore that first.',
    );
    await expect(restore.getByLabel('Reason')).toHaveValue('Demo: slings are back');
    await expectAccessible(page, 'Restore refused, its item removed', { inPlace: true });
    await expectReflow(page, 'Restore refused, its item removed');
    expect((await listed('bundle')).find((b) => b.id === id)).toMatchObject({ state: 'archived' });
    await expectNothingStored(page, 'Restore after another admin acted');
    expectOnlyIds(traffic.addresses);
  });

  test('a bundle saved naming an item removed meanwhile is refused with its sentence on the line, keeping what was typed; an item saved after another admin removed it shows it removed, saving nothing', async ({
    page,
  }) => {
    const wrap = await madeSupply('Demo: Crepe wrap');
    const pad = await madeSupply('Demo: Heel pad');
    await signIn(page, 'admin@example.com');
    const traffic = watchTraffic(page);

    // A bundle whose line names an item removed while the form was open: said on the line.
    await page.goto('/team/presets/bundles');
    const form = page.getByRole('form', { name: 'Add a bundle' });
    await form.getByLabel('Name', { exact: true }).fill('Demo: Sprain wrap');
    await form.getByRole('radio', { name: 'Non-Medical' }).check();
    await form.getByRole('button', { name: 'Add an item' }).click();
    const line = form.getByRole('group', { name: 'Line 1', exact: true });
    await line.getByLabel('Item').selectOption({ label: 'Demo: Crepe wrap' });
    await form.getByLabel('Reason').fill('Demo: what we give for a sprain');
    await actedMeanwhile('item', wrap, 'archive');
    await form.getByRole('button', { name: 'Add bundle' }).click();
    const alert = form.getByRole('alert');
    await expect(alert.locator('.px-alert__title')).toHaveText(
      'It names something that was removed. Choose another, or restore that one first.',
    );
    await expect(alert.getByRole('link')).toHaveText([
      'Item on line 1: This was removed. Choose another, or restore it first.',
    ]);
    // The line keeps the item it named, now marked as removed.
    await expect(line.getByLabel('Item').locator('option:checked')).toHaveText('Demo: Crepe wrap (removed)');
    await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Demo: Sprain wrap');
    await expectAccessible(page, 'Add a bundle, its item removed meanwhile', { inPlace: true });
    await expectReflow(page, 'Add a bundle, its item removed meanwhile');
    expect((await listed('bundle')).some((b) => b.name === 'Demo: Sprain wrap')).toBe(false);

    // An item's edit, sent after another admin removed it: refused, and its page shows it removed.
    await page.goto(`/team/presets/items/${pad}`);
    const edit = page.getByRole('form', { name: 'Edit Demo: Heel pad' });
    await edit.getByLabel('Name', { exact: true }).fill('Demo: Heel cushion');
    await edit.getByLabel('Reason').fill('Demo: what the box says');
    await actedMeanwhile('item', pad, 'archive');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('region', { name: 'Removed', exact: true })).toContainText(
      'This item isn’t offered for new work. Restore it to offer it again.',
    );
    await expect(edit).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo: Heel pad');
    expect((await listed('item')).find((i) => i.id === pad)).toMatchObject({
      name: 'Demo: Heel pad',
      state: 'archived',
      version: 1,
    });
    await expectNothingStored(page, 'A save after another admin acted');
    expectOnlyIds(traffic.addresses);
  });
});

test.describe('Remove and Restore with a stale sign-in', () => {
  test('a stale sign-in sends Remove and Restore through /reauth and back to the page, changing nothing', async ({
    page,
  }) => {
    const id = await madeBundle('Demo: Toe care', await madeSupply('Demo: Toe spacer'));
    const here = `/team/presets/bundles/${id}`;
    const throughReauth = async () => {
      await expect(page).toHaveURL(`/reauth?next=${encodeURIComponent(here)}`);
      await page.getByLabel('6-digit code').fill(MFA_CODE);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page).toHaveURL(new RegExp(`${here}$`));
    };

    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(here);
    await page.getByRole('button', { name: 'Remove Demo: Toe care', exact: true }).click();
    const remove = page.getByRole('form', { name: 'Remove Demo: Toe care' });
    await remove.getByLabel('Reason').fill('Demo: an old sign-in');
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await throughReauth();
    expect((await listed('bundle')).find((b) => b.id === id)).toMatchObject({ state: 'active', version: 1 });

    // Removed by another admin: its page offers Restore, which a stale sign-in sends the same way.
    await actedMeanwhile('bundle', id, 'archive');
    await staleSignIn();
    await signIn(page, 'admin@example.com');
    await page.goto(here);
    const gone = page.getByRole('region', { name: 'Removed', exact: true });
    await gone.getByLabel('Reason').fill('Demo: an old sign-in');
    await gone.getByRole('button', { name: 'Restore', exact: true }).click();
    await throughReauth();
    expect((await listed('bundle')).find((b) => b.id === id)).toMatchObject({ state: 'archived' });
    expect((await historyOf('bundle', id)).map((e) => e.act)).toEqual(['created', 'archived']);
  });
});
