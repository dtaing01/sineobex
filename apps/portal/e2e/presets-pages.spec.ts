import { expect, test } from '@playwright/test';
import {
  apiCall,
  expectAccessible,
  expectNothingStored,
  expectReflow,
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

/** Team setup's addresses: a page of it, a preset's, and the notice of an act, by ID only. */
function expectOnlyIds(addresses: string[]) {
  for (const address of addresses)
    expect(address).toMatch(
      /\/team\/presets(\/[a-z-]+(\/[0-9a-f-]{36})?)?(\?done=[a-z_]+&preset=[0-9a-f-]{36})?$|\/(home|sign-in.*|reauth.*)$/,
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
    const admin = await staffToken('admin@example.com');
    const members = (await (await apiCall(admin, 'GET', '/v1/team/members')).json()) as {
      userId: string;
      email: string;
    }[];
    const clinician = members.find((m) => m.email === 'clinician@example.com')!.userId;
    const denied = async () => {
      const res = await apiCall(admin, 'POST', '/v1/team/audit/search', {
        actorUserId: clinician,
        actionPrefix: 'access.denied',
        limit: 100,
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { entries: { details: Record<string, unknown> }[] }).entries;
    };

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
