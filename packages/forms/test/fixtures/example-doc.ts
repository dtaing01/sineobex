import { readFileSync } from 'node:fs';

// The recipe's worked example. The fixtures under fixtures/example are the same example as files;
// the tests hold the two together, so the document cannot say one thing while the checks do another.
const DOC = new URL('../../../../docs/plan/patterns/form-definition-example.md', import.meta.url);

/** The fenced blocks of the worked example, by the number of the section (`## 4. ...`) they are in. */
export function exampleBlocks(): Record<number, string[]> {
  const blocks: Record<number, string[]> = {};
  let section = 0;
  let open: string[] | null = null;
  for (const line of readFileSync(DOC, 'utf8').split('\n')) {
    const heading = /^## (\d+)\. /.exec(line);
    if (open === null && heading) section = Number(heading[1]);
    else if (line.startsWith('```')) {
      if (open === null) open = [];
      else {
        (blocks[section] ??= []).push(open.map((l) => `${l}\n`).join(''));
        open = null;
      }
    } else open?.push(line);
  }
  return blocks;
}
