/**
 * A number for each answer a form has had (its ActionState, which useActionState hands back
 * unchanged until the action answers again), so a part that holds what the person did in state of
 * its own, such as a bundle's lines, starts afresh at each answer: from what a refused form sent,
 * or, once the act is done, from what is stored. Without it an add form would keep the lines of
 * the preset it just added.
 */
const answers = new WeakMap<object, number>();
let answered = 0;

export function answerKey(state: object): number {
  let key = answers.get(state);
  if (key === undefined) {
    key = answered++;
    answers.set(state, key);
  }
  return key;
}
