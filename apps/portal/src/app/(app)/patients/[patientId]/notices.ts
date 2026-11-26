/**
 * What a patient's page says when an act sends the browser back to it: a correction (`?corrected=`),
 * a decided review (`?decided=`) and a flag change (`?flag=`). Each names one of these, nothing else.
 */

const CORRECTED: Record<string, string> = {
  legalName: 'Legal name corrected. The old value, the new one and your reason are in the history.',
  birth: 'Date of birth corrected. The old value, the new one and your reason are in the history.',
  declined: 'The declined request is recorded with your reason. The chart is unchanged.',
};

const DECIDED: Record<string, string> = {
  current: 'Decided. The chart keeps its value, and the other stays in its history.',
  alternate: 'Decided. The chart now shows the value you chose; the one it replaced stays in its history.',
};

/** What the Flags panel says when the page is loaded again after its act (`?flag=`). */
const FLAG_DONE: Record<string, string> = {
  saved: 'Flag saved. The history below shows the change.',
  // One sentence for a set marked and a clear marked alike (a clear marked can bring its flag back):
  // the header shows the patient's flags as they are now.
  marked: 'Marked entered in error. The flags at the top of the page show the patient’s flags without it.',
};

/**
 * A notice the address names, of the page's own: a name every object inherits, such as constructor,
 * names none, where it would hand React a function.
 */
const noticeOf = (notices: Readonly<Record<string, string>>, named: string | string[] | undefined) =>
  typeof named === 'string' && Object.hasOwn(notices, named) ? notices[named] : undefined;

/** The notices the page's address names. */
export function pageNotices(query: Record<string, string | string[] | undefined>): {
  corrected: string | undefined;
  decided: string | undefined;
  flag: string | undefined;
} {
  return {
    corrected: noticeOf(CORRECTED, query.corrected),
    decided: noticeOf(DECIDED, query.decided),
    flag: noticeOf(FLAG_DONE, query.flag),
  };
}
