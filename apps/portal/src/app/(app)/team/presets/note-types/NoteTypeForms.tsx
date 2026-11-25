import {
  addNoteTypeAction,
  removeNoteTypeAction,
  restoreNoteTypeAction,
} from '@/app/actions/presets-note-types';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { BaseVersion } from '@/components/presets/BaseVersion';
import { ChoiceGroup } from '@/components/presets/ChoiceGroup';
import { Disclosure } from '@/components/presets/Disclosure';
import { FreeText } from '@/components/presets/FreeText';
import { ReasonBox } from '@/components/presets/ReasonBox';
import type { NoteTypeGroup, NoteTypeRow } from '@/lib/presets';
import { NOTE_TYPE_SENTENCES } from '@/lib/refusals';
import { FieldSuppliesLink } from './FieldSuppliesLink';
import { CopyOfField, KindsField } from './KindsField';
import { GROUPS } from './words';

type Named = Pick<NoteTypeRow, 'key' | 'title' | 'version'>;

/**
 * Remove, with a reason (design 5.1, 5.4, 8.1): the note type is archived at the version shown,
 * never deleted, and joins the Removed list. Behind a button that shows the form. The API refuses
 * the Red flags note, and one a field supply mapping still names, each with its sentence, and the
 * latter with the way to Field supplies: the page offers Remove on every one and asks nothing first
 * (D114).
 */
export function RemoveNoteType({ noteType }: { noteType: Named }) {
  return (
    <Disclosure id={`remove-${noteType.key}-form`} label="Remove" name={noteType.title}>
      <ActionForm
        id={`remove-${noteType.key}`}
        action={removeNoteTypeAction}
        label={`Remove ${noteType.title}`}
      >
        <FieldSuppliesLink />
        <input type="hidden" name="key" value={noteType.key} />
        <BaseVersion version={noteType.version} />
        <p>It won’t be offered for new notes. Notes already started on it can still be finished.</p>
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton variant="danger">Remove</SubmitButton>
        </div>
      </ActionForm>
    </Disclosure>
  );
}

/** Restore, with a reason: the note type comes back at the version it was removed at. */
export function RestoreNoteType({ noteType }: { noteType: Pick<NoteTypeRow, 'key' | 'title'> }) {
  return (
    <Disclosure id={`restore-${noteType.key}-form`} label="Restore" name={noteType.title}>
      <ActionForm
        id={`restore-${noteType.key}`}
        action={restoreNoteTypeAction}
        label={`Restore ${noteType.title}`}
      >
        <input type="hidden" name="key" value={noteType.key} />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton variant="secondary">Restore</SubmitButton>
        </div>
      </ActionForm>
    </Disclosure>
  );
}

const GROUP_CHOICES = (Object.keys(GROUPS) as NoteTypeGroup[]).map((value) => ({
  value,
  label: GROUPS[value],
}));

/**
 * Add a note type (design 5.4, 8.1; PRD main 952): a copy of one the team holds, a removed one too,
 * with its sections, kinds, timeline group and who may read it; or a blank one, with Medical,
 * Non-Medical or both and a timeline group, which starts with one section, Notes, holding one text
 * field (BM-82). Every note type is offered to copy: the API refuses the quick encounter and the Red
 * flags note, with a sentence beside Copy of (D114).
 */
export function AddNoteType({ rows }: { rows: readonly Pick<NoteTypeRow, 'key' | 'title' | 'state'>[] }) {
  const copies = [
    { value: '', label: 'None: start a blank one' },
    ...rows.map((r) => ({ value: r.key, label: r.state === 'archived' ? `${r.title} (removed)` : r.title })),
  ];
  return (
    <section aria-labelledby="add-note-type" className="px-panel">
      <h2 id="add-note-type" className="px-h2">
        Add a note type
      </h2>
      <ActionForm id="new-note-type" action={addNoteTypeAction} label="Add a note type">
        <FreeText
          name="title"
          label="Title"
          hint="What staff choose when they add a note, such as Night outreach."
        />
        <CopyOfField
          hint="A copy starts with its sections, and is for the same visits and readers. A blank one starts with one section, Notes."
          options={copies}
        />
        <KindsField hint={NOTE_TYPE_SENTENCES.kindsFixed} />
        <ChoiceGroup
          name="group"
          legend="Timeline group (for a blank one)"
          hint="Where the timeline files its notes. A copy is filed where the note type it copies is."
          options={GROUP_CHOICES}
        />
        <ReasonBox />
        <div className="px-actions">
          <SubmitButton>Add note type</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
