'use client';

import Link from 'next/link';
import { useState } from 'react';
import styles from '@/components/presets/presets.module.css';
import type { ItemGroup } from './items';

/** A name as the search compares it: in any case, with or without its accents. */
const folded = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');

/** The groups with only the items whose names hold what was typed; the groups left empty go. */
export function searched(groups: readonly ItemGroup[], typed: string): ItemGroup[] {
  const wanted = folded(typed.trim());
  if (wanted === '') return [...groups];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => folded(i.name).includes(wanted)) }))
    .filter((g) => g.items.length > 0);
}

/**
 * The team's items by category, each opening its own page, with a search box that narrows the list
 * by name as the person types (phase 5 design 8.1). The search runs in the page alone: it is in no
 * form, so nothing typed reaches a server, an address or the browser's storage, and the count of
 * what it found is read out as it changes.
 */
export function ItemList({ groups }: { groups: readonly ItemGroup[] }) {
  const [typed, setTyped] = useState('');
  const shown = searched(groups, typed);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const found = shown.reduce((n, g) => n + g.items.length, 0);
  const searching = typed.trim() !== '';
  return (
    <>
      <div role="search" aria-label="Items" className="px-panel">
        <div className="px-field">
          <label htmlFor="item-search">Search items</label>
          <p id="item-search-hint" className="sx-help">
            Type part of a name. What you type stays on this page.
          </p>
          <div className="sx-input">
            <input
              id="item-search"
              type="search"
              autoComplete="off"
              spellCheck={false}
              size={10}
              value={typed}
              onChange={(e) => setTyped(e.currentTarget.value)}
              aria-describedby="item-search-hint item-search-found"
            />
          </div>
        </div>
        <p id="item-search-found" role="status" className="sx-help">
          {searching ? `${found} of ${total} ${total === 1 ? 'item' : 'items'} found.` : ''}
        </p>
      </div>
      {searching && found === 0 && <p className="px-panel">No item’s name holds that.</p>}
      {shown.map((g) => (
        <section key={g.id} aria-labelledby={`items-in-${g.id}`} className="px-panel">
          <h2 id={`items-in-${g.id}`} className="px-h2">
            {g.name}
          </h2>
          <ul className={styles.entries}>
            {g.items.map((i) => (
              <li key={i.id}>
                <span className={styles.entryName}>
                  <Link href={`/team/presets/items/${i.id}`}>{i.name}</Link>
                  {i.updateAvailable && <span className="sx-pill sx-pill--info">Update available</span>}
                </span>
                <span className="sx-help">{i.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
