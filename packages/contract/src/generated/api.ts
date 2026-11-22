// GENERATED FILE. Do not edit by hand. Regenerate with `pnpm contract:generate`.
export interface paths {
    "/v1/admin/preset-order/flag": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Put a tier’s active flags in the order sent, with a reason (recent sign-in) */
        post: operations["reorderFlags"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/presets/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every preset of a kind, archived ones too, with what names each and any update on offer */
        get: operations["listPresets"];
        put?: never;
        /** Add a preset of the team’s own, with a reason (recent sign-in) */
        post: operations["createPreset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/presets/{kind}/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Give a preset its next version, with a reason (recent sign-in); what is fixed at creation stays */
        put: operations["editPreset"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/presets/{kind}/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Archive a preset no active preset names, with a reason (recent sign-in); nothing is deleted */
        post: operations["archivePreset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/presets/{kind}/{id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every act on a preset, oldest first, with who, when and why, and the body of its version */
        get: operations["getPresetHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/presets/{kind}/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restore an archived preset at the version it is at, with a reason (recent sign-in) */
        post: operations["restorePreset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/presets/{kind}/{id}/take-update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Take the platform’s newer version of a preset, in place or as a new preset, with a reason (recent sign-in) */
        post: operations["takePresetUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Register this phone’s key for the current team */
        post: operations["registerDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/devices/{deviceId}/quarantine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Hand over unsynced changes after the user lost access; a Program Admin reviews them
         * @description Signed with the device key instead of a sign-in, so it works after the user was removed. The signature covers the canonical JSON of `payload`.
         */
        post: operations["uploadQuarantine"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/devices/{deviceId}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Whether this phone must wipe, and whether its user still has access
         * @description Signed with the device key instead of a sign-in, so it works after the user was removed. The signature covers the canonical JSON of `payload`.
         */
        post: operations["deviceStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/devices/{deviceId}/wiped": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Report that this phone deleted its data and key for the team
         * @description Signed with the device key instead of a sign-in, so it works after the user was removed. The signature covers the canonical JSON of `payload`.
         */
        post: operations["confirmWiped"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/encounters/{encounterId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A visit as the reader may see it: its notes laid out for reading, and what hangs off them
         * @description Built on the sync read’s rules (lifecycle 5.1, 6.4): what the reader may not see is absent, never blanked. Every record returned is logged.
         */
        get: operations["getEncounter"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/encounters/{encounterId}/attest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Attest the visit’s signed notes that wait for attestation, all or nothing
         * @description Lifecycle 5.4. The same body as a co-sign: every note of the visit that waits for attestation and that the caller may act on, each with the contentHash of the visit read. Each attestation names the note’s current signature. A refusal names its notes in error.details.noteIds: 403 is_author, is_signer, cannot_attest or cannot_see_all (logged); 409 not_waiting or content_changed. A refusal about the caller is logged even when a 409 is answered.
         */
        post: operations["attestEncounter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/encounters/{encounterId}/cosign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Co-sign the visit’s notes that wait for a co-signer, all or nothing
         * @description Lifecycle 5.3. The list holds every Medical note of the visit that waits for a co-signer and that the caller may act on, each with the contentHash of the visit read. A refusal names its notes in error.details.noteIds: 403 is_author, cannot_sign or cannot_see_all (logged); 409 not_waiting or content_changed, and the screen loads the visit again. A refusal about the caller is logged even when a 409 is answered.
         */
        post: operations["cosignEncounter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/encounters/{encounterId}/ems-handoff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The visit’s EMS handoff as a PDF, stamped with who exported it and when
         * @description Lifecycle 5.7. Needs patients.view and a recent sign-in (else 403 reauth_required), and the reader must be able to read the visit’s Red flags note (else 403 cannot_see_red_flags, logged). Its header names the patient by preferred name, with their age in years and their allergies as the reader’s chart shows them, never the legal name or the birth date. Built from the forms part’s handoffLines over what the reader may see, with no treatment record, sensitive exam or sensitive diagnosis for any reader; each note that holds something is in it, drafts too, marked with its state. 404 no_handoff when EMS was not activated. Never cached; the file name holds no patient details. Logged as ems_handoff.exported.
         */
        get: operations["getEmsHandoff"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/forms/note-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The team’s note types, each at its newest version
         * @description Any member of the team. Installs the platform’s presets the team does not hold yet first, and audits that install when it writes; the list itself holds no patient data and is not audited.
         */
        get: operations["listNoteTypes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/forms/note-types/{key}/{version}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One version of a note type, resolved. It never changes, so it may be kept
         * @description Any member of the team. Holds no patient data and is not audited.
         */
        get: operations["getNoteTypeDefinition"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness, database reachability and whether this is a demo deployment */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The signed-in person, their teams, and what they still need to do before using one */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/acknowledgements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Accept the Terms of Use or the confidentiality acknowledgement */
        post: operations["acceptAcknowledgement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/counts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The numbers Home shows: notes to finish, the queues, the team’s incomplete notes
         * @description Lifecycle 5.6, 9.9. Any member may ask. Each number is the length of the list it stands for, and a number for a list the caller may not open is absent. Names no patient, so it logs none.
         */
        get: operations["getHomeCounts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/notes-to-finish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The drafts the caller acts as the author of, with whether each is overdue
         * @description Lifecycle 3.9, 5.6. Needs encounters.chart. The server’s drafts only; the phone merges the ones it holds. Overdue is worked out when read: more than 24 hours since the visit started, or since the server received it when its start was not verified. An empty draft is not listed. Logged with the patients shown.
         */
        get: operations["getNotesToFinish"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notes/{noteId}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Put another clinician in the place of a note’s author who has left the team
         * @description Lifecycle 3.8, 5.5. Needs team.manage_users and a recent sign-in. 409 author_active while whoever acts as the author is an active member; 422 assignee_not_member, assignee_cannot_chart, credential_too_low (below the rank the note was signed under, or for an unsigned note its author’s last credential) or cannot_see_all (the note holds an answer the assignee’s role cannot see). The reason is stored, not logged.
         */
        post: operations["assignNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notes/{noteId}/assignees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Who may be put in the place of a note’s author who has left the team
         * @description Lifecycle 3.8, 5.5, 9.12. Needs team.manage_users; a read, so no recent sign-in (the assignment asks for one). Every active member the assign route would take, by its own rule (mayAssign), so a picker lists exactly them. 409 author_active while whoever acts as the author is an active member; 404 for a note the team does not have or the caller may not read. Logged as note.assignees_viewed on the note.
         */
        get: operations["getNoteAssignees"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/owner/teams": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every team, with its Program Admins (platform owners only) */
        get: operations["ownerListTeams"];
        put?: never;
        /** Create a team. A community health worker preset role is added to it. */
        post: operations["ownerCreateTeam"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/owner/teams/{teamId}/members/{membershipId}/remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove anyone from a team, including a Program Admin */
        post: operations["ownerRemoveMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/owner/teams/{teamId}/program-admins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Appoint a team's Program Admin */
        post: operations["ownerAppointProgramAdmin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/owner/teams/{teamId}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Suspend or reinstate a team. A suspended team cannot reach any data. */
        post: operations["ownerSetTeamStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/patients/{patientId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A patient’s chart, as the role may see it. A merged ID answers the kept chart. */
        get: operations["getPatient"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/patients/{patientId}/corrections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Correct a legal name or birth date with a reason, or record a declined amendment request */
        post: operations["correctIdentity"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/patients/{patientId}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every recorded value of the chart’s fields, old and new, with who and how */
        get: operations["getPatientHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/patients/{patientId}/id-link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The patient’s Street Medicine ID cards: active links with their URLs, and history */
        get: operations["getIdLinks"];
        put?: never;
        /** Make a new card. Every active card of the patient stops working. */
        post: operations["issueIdLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/patients/{patientId}/timeline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The patient’s earlier visits, 50 at a time, after the last one shown
         * @description The chart carries the first 50 (lifecycle 5.2). A merged ID answers its group. Each visit lists the notes the reader may see, by type and state only.
         */
        get: operations["getPatientTimeline"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/patients/charts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Charts for the phone’s 24-hour cache, with every redirect that touches them. Gzipped. */
        post: operations["fetchCharts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/patients/index": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * The team search index for a phone, a page at a time. Field roles only. Gzipped.
         * @description Needs patients.view and one of patients.edit, encounters.chart, checkins.create; otherwise 403 index_not_permitted, and the phone deletes any index it holds. `have` equal to the current version answers `unchanged`. No legal name, no token, no clinical content.
         */
        post: operations["downloadTeamIndex"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/patients/match": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Patients who may be the person being registered, before the chart is created */
        post: operations["matchPatients"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/patients/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Find patients by name, street name, description or birth date. Logged with the patients shown.
         * @description A name, or a full birth date; a year needs a name with it. Not paged: past 50 the screen asks for more letters or a birth year. The search text is never logged.
         */
        post: operations["searchPatients"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every permission a role can hold, with a plain description */
        get: operations["listPermissions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The team’s presets changed since a revision, for the phone’s copy (any member) */
        get: operations["pullPresets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/problems/{problemId}/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Merge this entry into another; both histories and notes stay */
        post: operations["mergeProblems"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/problems/{problemId}/reverse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a Resolved problem back to Ongoing, with a reason; then offers entries to merge into it */
        post: operations["reverseResolvedProblem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sync/push": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send change entries; get a receipt for each (accepted with hash, rejected with reason, or conflict)
         * @description Each change commits in its own transaction with its audit entry. A change ID the server already has gets its stored receipt again, so retries never apply twice. Changes without a result were not processed.
         */
        post: operations["syncPush"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sync/records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * The server’s copy of records, with each field’s version, for records a phone holds open
         * @description Each kind of record needs its read permission: encounters, notes and what hangs off a note (sign-offs, addenda, corrections) encounters.chart; patient records and referrals patients.view; problems and their notes patients.view with encounters.chart or billing.view_codes. What the reader may not see is reported missing, like a record the team doesn’t have: a sensitive problem the role can’t see, a note they may not read with its sign-offs, addenda and corrections, and a correction to an answer hidden from them. A note they may read lists only the answers they may see, each with its version; a hidden one leaves no key.
         */
        post: operations["fetchRecords"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/attestation-queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The team’s visits with notes that wait for attestation, oldest first
         * @description Lifecycle 5.4. Needs encounters.chart and a credential that attests; else 403 cannot_attest, logged. One row per visit with its waiting notes, each with canAct false when the caller may not act on it (an answer they may not see, or their own note). A note the caller may not read is absent. Logged with the patients shown.
         */
        get: operations["getAttestationQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/audit/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Search the audit log by person, patient, action and time. The search itself is logged. */
        post: operations["searchAudit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/audit/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Recompute every hash in the team's audit chain */
        post: operations["verifyAuditChain"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/cosign-queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The team’s visits with notes that wait for a co-signature, oldest first
         * @description Lifecycle 5.4. Needs encounters.chart and a credential that signs; else 403 cannot_sign, logged. One row per visit with its waiting notes, each with canAct false when the caller may not act on it (an answer they may not see, or their own note). A note the caller may not read is absent. Logged with the patients shown.
         */
        get: operations["getCosignQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every phone on the team, with sync status, clock flag and unsynced counts */
        get: operations["listDevices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/devices/{deviceId}/wipe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remotely wipe a lost or stolen phone; its unsynced data is lost */
        post: operations["wipeDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/duplicates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Pairs of charts that may be the same person, oldest flagged first */
        get: operations["listDuplicates"];
        put?: never;
        /** Report two charts that are the same person, for a reviewer to decide */
        post: operations["flagDuplicate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/duplicates/{pairId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Both charts of a pair side by side, with what matched and earlier decisions */
        get: operations["getDuplicatePair"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/duplicates/{pairId}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Merge, keep separate or not sure, with a comment
         * @description Carries the versions the reviewer saw: 409 pair_changed {versions} when either chart changed or was merged since; 409 already_decided for a decided pair, unless not sure.
         */
        post: operations["decideDuplicate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/field-reviews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Fields where two values were recorded, that the signed-in person may decide */
        get: operations["listFieldReviews"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/field-reviews/{reviewId}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Keep the chart’s value or an alternate. Legal name and birth date need an admin and a comment. */
        post: operations["decideFieldReview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/incomplete-notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Every draft of the team, with its author, whether they are still a member, and whether it is overdue
         * @description Lifecycle 3.9, 5.6. Needs team.manage_users. `author` (a user ID) keeps the drafts that person acts as the author of. A note the caller may not read and an empty draft are not listed. Logged with the patients shown.
         */
        get: operations["getIncompleteNotes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Everyone on the team, active and removed */
        get: operations["listMembers"];
        put?: never;
        /** Invite a person with a role and credential (Program Admins can only be appointed by owners) */
        post: operations["inviteMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/members/{membershipId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getMember"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/members/{membershipId}/credential": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Change a credential. Moving up takes effect only with the new credential's fields filled in. */
        put: operations["changeMemberCredential"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/members/{membershipId}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every role, credential and status change for one membership, with reasons */
        get: operations["getMemberHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/members/{membershipId}/remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove a person. Their sessions stop working at once; their phone's data is handled at next contact. */
        post: operations["removeMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/members/{membershipId}/role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Change a role, with a reason that is logged */
        put: operations["changeMemberRole"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/merges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recent merges, newest first */
        get: operations["listMerges"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/merges/{mergeId}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Undo a merge, with a comment. Each chart gets its own ID cards back. */
        post: operations["undoMerge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/notices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Things the signed-in person should look at, without patient details */
        get: operations["listNotices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/notices/{noticeId}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["markNoticeRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/problem-reversals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Problems staff marked Resolved by mistake, waiting for an admin */
        get: operations["listProblemReversals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/problem-reversals/{problemId}/decline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Decline a request with a reason; the entry stays a separate problem */
        post: operations["declineProblemReversal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/quarantine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Changes from phones whose user lost access, waiting for review, a page at a time */
        get: operations["listQuarantine"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/quarantine/{itemId}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Accept a quarantined change onto the chart, or reject it with a reason */
        post: operations["decideQuarantine"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Standard roles and this team's custom roles */
        get: operations["listRoles"];
        put?: never;
        /** Create a custom role from existing permissions */
        post: operations["createRole"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/roles/{roleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Change a custom role. Standard roles cannot be changed. */
        put: operations["updateRole"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/team/roles/{roleId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Archive a custom role nobody holds */
        post: operations["archiveRole"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/time": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Server time, used by the phone to measure its clock offset (module 9) */
        get: operations["getServerTime"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Acknowledgement: {
            /** @enum {string} */
            kind: "terms_of_use" | "confidentiality";
            version: string;
        };
        AddendumView: {
            author: components["schemas"]["UserRef"];
            clockVerified: boolean;
            credential: components["schemas"]["Credential"];
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            noteId: string | null;
            text: string;
            /** Format: date-time */
            writtenAt: string;
        };
        /** @enum {string} */
        AllergyCategory: "drug" | "food" | "environment" | "other" | "unknown";
        /** @enum {string} */
        AllergyScreen: "not_asked" | "none_known";
        /** @enum {string} */
        AllergySeverity: "mild" | "moderate" | "severe" | "unknown";
        AllergySummary: {
            count: number;
            screen: components["schemas"]["AllergyScreen"];
            severe: boolean;
        };
        AppointAdmin: {
            credential?: components["schemas"]["Credential"];
            credentialFields?: components["schemas"]["CredentialFields"];
            displayName: string;
            /** Format: email */
            email: string;
        };
        ArchivePreset: {
            /** @description The version you opened: any other is refused as stale, with the current one */
            baseVersion: number;
            /** @description Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log. */
            reason: string;
        };
        AssignInput: {
            /** @description Why, in a few words. Logged. */
            reason: string;
            /**
             * Format: uuid
             * @description The clinician who will act as the note’s author
             */
            toUserId: string;
        };
        AttestationView: {
            attending: components["schemas"]["UserRef"];
            /** Format: date-time */
            attestedAt: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            signoffId: string;
            statementVersion: string;
        };
        AuditEntry: {
            action: string;
            actor: {
                displayName: string | null;
                role: string | null;
                /** Format: uuid */
                userId: string | null;
            };
            details: {
                [key: string]: unknown;
            };
            /** Format: uuid */
            deviceId: string | null;
            /** Format: date-time */
            deviceTime: string | null;
            entity: string | null;
            entityId: string | null;
            id: string;
            ip: string | null;
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            patientId: string | null;
            seq: string;
        };
        AuditPage: {
            entries: components["schemas"]["AuditEntry"][];
            nextBeforeId: string | null;
        };
        AuditSearch: {
            actionPrefix?: string;
            /** Format: uuid */
            actorUserId?: string;
            beforeId?: string;
            /** Format: date-time */
            from?: string;
            /** @default 50 */
            limit: number;
            /** Format: uuid */
            patientId?: string;
            /** Format: date-time */
            to?: string;
        };
        BirthInput: {
            /**
             * Format: date
             * @description With precision day
             */
            date?: string;
            precision: components["schemas"]["BirthPrecision"];
            /** @description With year or estimated */
            year?: number;
        };
        /** @enum {string} */
        BirthPrecision: "day" | "year" | "estimated";
        BirthQuery: {
            day?: number;
            month?: number;
            year: number;
        };
        BirthView: {
            /**
             * Format: date
             * @description A calendar date, YYYY-MM-DD
             */
            date?: string;
            precision: components["schemas"]["BirthPrecision"];
            year?: number;
        };
        ChainCheck: {
            checked: number;
            firstBadSeq: number | null;
            ok: boolean;
            problem: string | null;
        };
        ChangeCredential: {
            credential: components["schemas"]["Credential"];
            credentialFields?: components["schemas"]["CredentialFields"];
            /** @description Why, in a few words. Logged. */
            reason: string;
        };
        /** @enum {string} */
        ChangeEntity: "encounter" | "encounter_note" | "audit" | "patient" | "patient_alias" | "patient_allergy" | "patient_consent" | "problem" | "problem_note" | "id_link" | "note_signoff" | "note_addendum" | "note_correction" | "referral";
        ChangeRole: {
            /** @description Why, in a few words. Logged. */
            reason: string;
            /** Format: uuid */
            roleId: string;
        };
        ChartBundle: {
            charts: components["schemas"]["PatientChart"][];
            missing: string[];
            /** @description Every live redirect into or out of the requested IDs and the returned groups */
            redirects: components["schemas"]["PatientRedirect"][];
        };
        ConsentView: {
            /** @enum {string} */
            decision: "given" | "unable" | "acknowledged" | "declined" | "not_offered";
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "care_and_record" | "privacy_notice";
            /** @enum {string} */
            method: "verbal" | "written" | "not_applicable";
            /** Format: date-time */
            recordedAt: string;
            recordedBy: components["schemas"]["UserRef"];
        };
        /** @description The values are in the read model, under the answers */
        CorrectionView: {
            clockVerified: boolean;
            /** Format: date-time */
            correctedAt: string;
            corrector: components["schemas"]["UserRef"];
            credential: components["schemas"]["Credential"];
            fields: string[];
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            outcome: "corrected" | "declined" | "no_change" | "draft_edit" | "not_author";
            reason: string;
            requestedByPatient: boolean;
        };
        CreatePreset: {
            /** @description The preset in its kind’s shape (@sineobex/presets), checked against that shape and the team’s other presets */
            body: unknown;
            /** @description Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log. */
            reason: string;
        };
        CreatePresetResult: {
            /** Format: uuid */
            id: string;
            /** @description The team’s revision this write took: a phone’s next pull gets the change */
            revision: number;
            /** @enum {number} */
            version: 1;
        };
        CreateTeam: {
            name: string;
        };
        /** @enum {string} */
        Credential: "attending" | "resident" | "np" | "pa" | "student" | "chw" | "none";
        CredentialFields: {
            licenseNumber?: string;
            licenseState?: string;
            npi?: string;
            program?: string;
            school?: string;
            supervisingAttending?: string;
            supervisingPhysician?: string;
        };
        DecideDuplicate: {
            /** @description Why, in a few words. Logged. */
            comment: string;
            /** @enum {string} */
            decision: "merge" | "keep_separate" | "not_sure";
            /** @description Not sure only: shown to field staff on both charts */
            fieldNote?: string;
            /**
             * Format: uuid
             * @description Merge only: the chart that is kept
             */
            survivorId?: string;
            /** @description The versions the reviewer saw */
            versions: {
                a: number;
                b: number;
            };
        };
        DecideFieldReview: {
            baseVersion: number;
            /** @description Required for legal name and birth */
            comment?: string;
            /** @description The alternate kept */
            historyId?: string;
            /** @enum {string} */
            keep: "current" | "alternate";
        };
        DecideQuarantine: {
            /** @enum {string} */
            decision: "accept" | "reject";
            /** @description Why, in a few words. Logged. */
            reason: string;
        };
        DeclineReversal: {
            /** @description Why, in a few words. Logged. */
            reason: string;
        };
        Device: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            registeredAt: string;
            status: components["schemas"]["DeviceStatus"];
        };
        /** @enum {string} */
        DeviceStatus: "active" | "wipe_requested" | "wiped";
        DeviceStatusResult: {
            /**
             * @description removed: the user lost access to the team; upload unsynced work to quarantine, then wipe
             * @enum {string}
             */
            access: "active" | "removed";
            /** Format: date-time */
            serverTime: string;
            status: components["schemas"]["DeviceStatus"];
        };
        DuplicateDecisionResult: {
            merge: components["schemas"]["MergeView"] | null;
            pair: components["schemas"]["DuplicatePairSummary"];
        };
        DuplicateDecisionView: {
            comment: string;
            /** Format: date-time */
            decidedAt: string;
            decidedBy: components["schemas"]["UserRef"];
            /** @enum {string} */
            decision: "merge" | "keep_separate" | "not_sure" | "undo_merge" | "flagged_by_staff";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            mergeId: string | null;
            /** Format: uuid */
            survivorId: string | null;
        };
        DuplicateHint: {
            /** @description The reviewer’s Not sure note, shown to field staff */
            note: string | null;
            status: components["schemas"]["DuplicateHintStatus"];
        };
        /** @enum {string} */
        DuplicateHintStatus: "open" | "not_sure";
        DuplicatePage: {
            /**
             * Format: uuid
             * @description Pass as afterId for the next page; null on the last
             */
            nextAfterId: string | null;
            pairs: components["schemas"]["DuplicatePairSummary"][];
        };
        DuplicatePairDetail: {
            a: components["schemas"]["PairSide"];
            b: components["schemas"]["PairSide"];
            compared: {
                field: string;
                same: boolean;
            }[];
            decisions: components["schemas"]["DuplicateDecisionView"][];
            pair: components["schemas"]["DuplicatePairSummary"];
        };
        DuplicatePairSummary: {
            a: components["schemas"]["PairPatient"];
            b: components["schemas"]["PairPatient"];
            band: components["schemas"]["MatchBand"];
            /** @description The creator saw this match at intake and said "Not them" */
            creatorDismissed: boolean;
            /** Format: date-time */
            decidedAt: string | null;
            /** Format: date-time */
            firstFlaggedAt: string;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            lastFlaggedAt: string;
            note: string | null;
            reasons: components["schemas"]["MatchReason"][];
            score: number;
            sources: components["schemas"]["DuplicateSource"][];
            status: components["schemas"]["DuplicateStatus"];
        };
        /** @enum {string} */
        DuplicateSource: "sync" | "edit" | "merge_rematch" | "correction" | "staff_report";
        /** @enum {string} */
        DuplicateStatus: "open" | "not_sure" | "keep_separate" | "merged" | "superseded";
        EditPreset: {
            /** @description The version you opened: any other is refused as stale, with the current one */
            baseVersion: number;
            /** @description The preset in its kind’s shape (@sineobex/presets), checked against that shape and the team’s other presets */
            body: unknown;
            /** @description Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log. */
            reason: string;
        };
        EditPresetResult: {
            /** @description The team’s revision this write took: a phone’s next pull gets the change */
            revision: number;
            version: number;
        };
        /** @enum {string} */
        EncounterKind: "medical" | "non_medical";
        ErrorResponse: {
            error: {
                code: string;
                details?: {
                    [key: string]: unknown;
                };
                message: string;
            };
        };
        FetchCharts: {
            patientIds: string[];
            /** @enum {string} */
            reason: "opened" | "refresh";
        };
        FetchRecords: {
            records: components["schemas"]["RecordRef"][];
        };
        FetchRecordsResult: {
            missing: components["schemas"]["RecordRef"][];
            records: components["schemas"]["RecordSnapshot"][];
        };
        FieldHistoryEntry: {
            approvedBy: components["schemas"]["UserRef"] | null;
            changedBy: components["schemas"]["UserRef"];
            /** Format: uuid */
            correctionId: string | null;
            /** Format: date-time */
            deviceTime: string | null;
            entity: string;
            field: string;
            /** @description A field history entry */
            id: string;
            kind: components["schemas"]["HistoryKind"];
            previousValue?: unknown;
            /** Format: date-time */
            recordedAt: string;
            /** Format: uuid */
            recordId: string;
            /** Format: uuid */
            reviewId: string | null;
            value?: unknown;
            version: number;
        };
        FieldHistoryPage: {
            entries: components["schemas"]["FieldHistoryEntry"][];
            /** @description A field history entry */
            nextAfterId: string | null;
        };
        FieldReviewPage: {
            /**
             * Format: uuid
             * @description Pass as afterId for the next page; null on the last
             */
            nextAfterId: string | null;
            reviews: components["schemas"]["FieldReviewView"][];
        };
        FieldReviewView: {
            alternates: {
                by: components["schemas"]["UserRef"];
                /** Format: date-time */
                deviceTime: string | null;
                /** @description A field history entry */
                historyId: string;
                value?: unknown;
            }[];
            current: components["schemas"]["FieldState"];
            /** @description Who recorded the chart’s value; null when nobody did. In the team list and a decision’s answer */
            currentBy?: components["schemas"]["UserRef"] | null;
            field: string;
            /** Format: uuid */
            id: string;
            needs: components["schemas"]["ReviewNeeds"];
            /** Format: date-time */
            openedAt: string;
            patient?: components["schemas"]["PatientSummary"];
            /** Format: uuid */
            patientId: string;
            /** @enum {string} */
            status: "open" | "decided" | "obsolete";
        };
        /** @description On conflict, or when the value was kept but not applied: the value the server holds */
        FieldState: {
            /** Format: date-time */
            changedAt: string | null;
            /** Format: uuid */
            changedBy: string | null;
            value?: unknown;
            version: number;
        };
        FlagDuplicate: {
            /** @description Why, in a few words. Logged. */
            comment: string;
            /** Format: uuid */
            patientA: string;
            /** Format: uuid */
            patientB: string;
        };
        Health: {
            demo: boolean;
            /** @enum {string} */
            environment: "local" | "test" | "preview" | "pilot" | "production";
            release: string;
            /** @enum {string} */
            status: "ok";
        };
        /** @enum {string} */
        HistoryKind: "created" | "set" | "filled_blank" | "replaced_after_review" | "kept_both" | "confirmed" | "redirected" | "corrected" | "review_decided" | "merge_fill" | "merge_undone" | "cleared_by_allergy" | "entered_in_error";
        HomeCounts: {
            /** @description Visits in the attestation queue (GET /v1/team/attestation-queue); encounters.chart and a credential that attests */
            attestationWaiting?: number;
            /** @description Visits in the co-sign queue (GET /v1/team/cosign-queue); encounters.chart and a credential that signs */
            cosignWaiting?: number;
            /** @description How many of those are overdue (lifecycle 3.9) */
            notesOverdue?: number;
            /** @description The drafts the caller acts as the author of (GET /v1/me/notes-to-finish); encounters.chart */
            notesToFinish?: number;
            /** @description The team’s drafts (GET /v1/team/incomplete-notes); team.manage_users */
            teamIncomplete?: number;
            /** @description How many of the team’s drafts are overdue, as that list says each is; team.manage_users */
            teamOverdue?: number;
        };
        IdentityCorrection: {
            baseVersion: number;
            /** @enum {string} */
            field: "legalName" | "birth";
            /**
             * @description declined: an amendment request refused with a reason; the chart is unchanged
             * @enum {string}
             */
            outcome: "corrected" | "declined";
            /** @description Why, in a few words. Logged. */
            reason: string;
            /** @description A HIPAA §164.526 amendment request */
            requestedByPatient: boolean;
            value: components["schemas"]["LegalNameInput"] | components["schemas"]["BirthInput"];
        };
        /** @enum {string} */
        IdLinkReason: "first_card" | "lost" | "damaged" | "stolen" | "patient_request" | "other";
        IdLinkState: {
            active: components["schemas"]["IdLinkView"][];
            history: components["schemas"]["IdLinkView"][];
        };
        /** @enum {string} */
        IdLinkStatus: "active" | "retired";
        IdLinkSummary: {
            /** Format: date-time */
            effectiveAt: string;
            /** Format: uuid */
            id: string;
            /**
             * Format: uuid
             * @description The patient record the link was issued on
             */
            issuedOn: string;
            madeOffline: boolean;
            status: components["schemas"]["IdLinkStatus"];
            /** @description patients.edit only */
            url?: string;
        };
        IdLinkView: {
            /** Format: date-time */
            effectiveAt: string;
            /** Format: uuid */
            id: string;
            issuedBy: components["schemas"]["UserRef"];
            /** Format: uuid */
            issuedOn: string;
            madeOffline: boolean;
            reason: components["schemas"]["IdLinkReason"];
            /** Format: uuid */
            replacedBy: string | null;
            /** Format: date-time */
            restoredAt: string | null;
            /** Format: date-time */
            retiredAt: string | null;
            /** @enum {string|null} */
            retiredReason: "regenerated" | "superseded_by_newer" | null;
            status: components["schemas"]["IdLinkStatus"];
            /** @description First 12 hex characters of the token’s SHA-256 */
            tokenRef: string;
            /** @description Active links only, for patients.edit */
            url?: string;
        };
        IncompleteNote: components["schemas"]["NoteToFinish"] & {
            author: components["schemas"]["UserRef"] & unknown;
            /** @description The author is still an active member of the team */
            authorActive: boolean;
            /**
             * @description The patient’s preferred name, from the chart they were merged into when they were, as a queue row shows it; null for a visit with no patient, and without patients.view
             * @default null
             */
            preferredName: string | null;
            /**
             * @description The note type’s title, so no page reads the note types list to word it; empty only in a copy cached before it was sent
             * @default
             */
            title: string;
        };
        IncompleteNotes: {
            notes: components["schemas"]["IncompleteNote"][];
        };
        IndexDuplicateHint: {
            status: components["schemas"]["DuplicateHintStatus"];
        };
        IndexEntry: {
            aliases: {
                alias: string;
                /**
                 * Format: uuid
                 * @description The street name’s record, which a phone may remove offline; null for a merged name
                 */
                id: string | null;
                /**
                 * @description merged_name: the preferred name of a record merged into this one. Not a street name record
                 * @enum {string}
                 */
                kind: "alias" | "merged_name";
            }[];
            allergies: {
                category: components["schemas"]["AllergyCategory"];
                /** Format: uuid */
                id: string;
                severity: components["schemas"]["AllergySeverity"];
                substance: string;
            }[];
            allergyScreen: components["schemas"]["AllergyScreen"];
            birth: components["schemas"]["BirthView"] | null;
            duplicate: components["schemas"]["IndexDuplicateHint"] | null;
            idLinks: {
                /** Format: date-time */
                effectiveAt: string;
                /** Format: uuid */
                id: string;
            }[];
            /**
             * Format: date
             * @description A calendar date, YYYY-MM-DD
             */
            lastSeenOn: string | null;
            /** Format: uuid */
            patientId: string;
            preferredName: string | null;
            /** @description Fields with an open review */
            reviews: string[];
            usualArea: string | null;
            versions: {
                allergyScreen: number;
                preferredName: number;
                usualArea: number;
                visualDescriptor: number;
            };
            visualDescriptor: string | null;
        };
        InviteMember: {
            credential?: components["schemas"]["Credential"];
            credentialFields?: components["schemas"]["CredentialFields"];
            displayName: string;
            /** Format: email */
            email: string;
            /** Format: uuid */
            roleId: string;
        };
        IssueIdLink: {
            /**
             * Format: uuid
             * @description Made by the client, so a retry issues nothing twice
             */
            linkId: string;
            reason: components["schemas"]["IdLinkReason"];
            /**
             * Format: uuid
             * @description The newest active link the issuer saw; null for a first card
             */
            replacesLinkId: string | null;
        };
        LegalNameInput: {
            family: string | null;
            given: string | null;
        };
        LegalNameView: {
            family: string | null;
            given: string | null;
        };
        /** @enum {string} */
        MatchBand: "likely" | "possible" | "weak";
        /** @enum {string} */
        MatchReason: "name" | "alias" | "legal_name" | "descriptor" | "typo" | "nickname" | "sounds_like" | "initial" | "dob_exact" | "dob_swapped" | "dob_month_year" | "dob_year_slip" | "dob_year" | "dob_estimate";
        Me: {
            /** @description Where Street Medicine ID cards point: the link is `{idLinkBaseUrl}/c#<token>`. Cached on the phone, so a card made offline carries the same URL the portal shows. */
            idLinkBaseUrl: string;
            isOwner: boolean;
            mfa: {
                required: boolean;
                satisfied: boolean;
            };
            pendingAcknowledgements: components["schemas"]["Acknowledgement"][];
            teams: components["schemas"]["MyTeam"][];
            user: {
                displayName: string;
                email: string;
                /** Format: uuid */
                id: string;
            };
        };
        Member: {
            credential: components["schemas"]["Credential"];
            credentialFields: components["schemas"]["CredentialFields"];
            displayName: string;
            email: string;
            /** Format: date-time */
            invitedAt: string;
            /** Format: uuid */
            membershipId: string;
            /** Format: date-time */
            removedAt: string | null;
            role: components["schemas"]["RoleSummary"];
            /** @enum {string} */
            status: "active" | "removed";
            /** Format: uuid */
            userId: string;
        };
        MembershipChange: {
            /** Format: date-time */
            changedAt: string;
            changedBy: {
                displayName: string;
                /** Format: uuid */
                userId: string;
            };
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "invited" | "role" | "credential" | "removed" | "restored";
            newValue?: unknown;
            oldValue?: unknown;
            reason: string | null;
        };
        MergePage: {
            merges: components["schemas"]["MergeView"][];
            /**
             * Format: uuid
             * @description Pass as afterId for the next page; null on the last
             */
            nextAfterId: string | null;
        };
        MergeProblems: {
            /** @description Why, in a few words. Logged. */
            comment: string;
            /** Format: uuid */
            intoProblemId: string;
        };
        MergeView: {
            comment: string;
            /** Format: uuid */
            id: string;
            merged: components["schemas"]["PairPatient"];
            /** Format: date-time */
            mergedAt: string;
            mergedBy: components["schemas"]["UserRef"];
            /** Format: uuid */
            pairId: string;
            survivor: components["schemas"]["PairPatient"];
            /** @description For a caller with patients.correct_identity, when nothing was merged on top */
            undoable: boolean;
            undone: {
                /** Format: date-time */
                at: string;
                by: components["schemas"]["UserRef"];
                comment: string;
            } | null;
        };
        MyTeam: {
            credential: components["schemas"]["Credential"];
            permissions: components["schemas"]["Permission"][];
            roleKey: string;
            roleName: string;
            /** Format: uuid */
            teamId: string;
            teamName: string;
            /** @enum {string} */
            teamStatus: "active" | "suspended";
        };
        /** @description Every note of the visit that waits for this act and that the caller may act on, each with the hash of what they read */
        NoteActInput: {
            notes: {
                /** @description The note’s contentHash from the visit read: what the person read (lifecycle 4.5) */
                contentHash: string;
                /** Format: uuid */
                noteId: string;
            }[];
            statementVersion: string;
        };
        NoteActResult: {
            notes: {
                attestation: components["schemas"]["NoteAttestation"];
                /** Format: uuid */
                noteId: string;
                status: components["schemas"]["NoteStatus"];
            }[];
        };
        NoteAssigned: {
            /** Format: uuid */
            assignmentId: string;
            /**
             * Format: uuid
             * @description Who acted as the author until now
             */
            fromUserId: string;
            /** Format: uuid */
            noteId: string;
            /** Format: uuid */
            toUserId: string;
        };
        NoteAssignee: {
            credential: components["schemas"]["Credential"];
            displayName: string;
            /** Format: uuid */
            userId: string;
        };
        /** @description Every active member the assign route would take for this note, by name */
        NoteAssignees: {
            assignees: components["schemas"]["NoteAssignee"][];
        };
        /** @enum {string} */
        NoteAttestation: "not_needed" | "waiting" | "attested";
        /**
         * @description Why a note that waits for a co-signature or an attestation waits for someone other than the reader: they wrote it, act as its author (assigned to them), completed it, made its current signature, or cannot see every answer that counts. Given whenever the act’s first refusal of the reader is about the note, whatever their credential. Absent when the note waits for nothing, the reader may act, the first refusal is about their credential, or their role does not chart
         * @enum {string}
         */
        NoteHeldBecause: "wrote" | "acts_as_author" | "completed" | "signed" | "cannot_see_all";
        /** @enum {string} */
        NoteStatus: "draft" | "completed" | "signed";
        NotesToFinish: {
            notes: components["schemas"]["NoteToFinish"][];
        };
        NoteToFinish: {
            /** Format: uuid */
            encounterId: string;
            /** Format: uuid */
            noteId: string;
            noteTypeKey: string;
            /** @description More than 24 hours since the visit started, or since the server received it when its start was not verified */
            overdue: boolean;
            /** Format: uuid */
            patientId: string | null;
            /** Format: date-time */
            startedAt: string;
        };
        NoteTypeDefinition: {
            /** @description The resolved definition, in the format of @sineobex/forms */
            definition: {
                [key: string]: unknown;
            };
            hash: string;
            /**
             * @description A note type’s key, as migration 0017 allows it
             * @example wound_care
             */
            key: string;
            version: number;
        };
        NoteTypeEntry: {
            /**
             * @description Added by itself with the first Medical note of an encounter
             * @enum {string|null}
             */
            auto: "medical" | null;
            /** @description SHA-256 of the definition’s canonical JSON */
            hash: string;
            /**
             * @description A note type’s key, as migration 0017 allows it
             * @example wound_care
             */
            key: string;
            /** @description Which encounters offer it */
            kinds: ("medical" | "non_medical")[];
            /** @description The Quick encounter */
            quick: boolean;
            /**
             * @description `sensitive` needs patients.view_sensitive to read
             * @enum {string}
             */
            sensitivity: "none" | "sensitive";
            title: string;
            /** @description The newest version the team holds */
            version: number;
        };
        NoteTypeList: {
            noteTypes: components["schemas"]["NoteTypeEntry"][];
        };
        Notice: {
            /** Format: date-time */
            createdAt: string;
            entity: string | null;
            /** Format: uuid */
            id: string;
            kind: string;
            /**
             * Format: uuid
             * @description The note a `signoff_not_applied` or `correction_not_applied` notice is about: its record is the held sign-off or correction, which no sync read gives, so a phone that never held it opens the note by this. Null for every other notice
             */
            noteId: string | null;
            /** Format: date-time */
            readAt: string | null;
            /** Format: uuid */
            recordId: string | null;
        };
        Ok: {
            /** @enum {boolean} */
            ok: true;
        };
        OwnerTeam: {
            activeMembers: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            name: string;
            programAdmins: {
                displayName: string;
                email: string;
                /** Format: uuid */
                membershipId: string;
            }[];
            /** @enum {string} */
            status: "active" | "suspended";
        };
        PairPatient: {
            /** Format: uuid */
            patientId: string;
            summary: components["schemas"]["PatientSummary"];
        };
        PairSide: {
            chart: components["schemas"]["PatientChart"];
            createdBy: components["schemas"]["UserRef"];
            /** @enum {string} */
            createdHow: "phone_offline" | "phone" | "unknown";
            /**
             * Format: uuid
             * @description Phase 8; always null in phase 3
             */
            photoId: string | null;
            /** @description Dates and kinds only */
            recentEncounters: {
                /** Format: uuid */
                id: string;
                kind: string;
                /** Format: date-time */
                startedAt: string;
            }[];
            /** @description Send back in DecideDuplicate.versions */
            version: number;
        };
        PatientChart: {
            aliases: components["schemas"]["RecordSnapshot"][];
            allergies: components["schemas"]["RecordSnapshot"][];
            /** Format: uuid */
            canonicalId: string;
            consents: components["schemas"]["ConsentView"][];
            duplicate: components["schemas"]["DuplicateHint"] | null;
            /** @description Active links of the group: usually one; one per merged record that had a card until the next new card */
            idLinks: components["schemas"]["IdLinkSummary"][];
            mergedFrom: {
                /** Format: date-time */
                mergedAt: string;
                /** Format: uuid */
                mergeId: string;
                /** Format: uuid */
                patientId: string;
            }[];
            patient: components["schemas"]["RecordSnapshot"];
            problemHistory?: components["schemas"]["ProblemStatusEvent"][];
            problemNotes?: components["schemas"]["ProblemNoteView"][];
            problems?: components["schemas"]["RecordSnapshot"][];
            /** @description Which projection made this copy */
            projection: string;
            /** @description The last three visits in full, read offline from the cache: on the phone’s cached chart (POST /v1/patients/charts) only */
            recentVisits?: components["schemas"]["VisitRead"][];
            /**
             * Format: uuid
             * @description The merged ID that was asked for
             */
            redirectedFrom?: string;
            reviews: components["schemas"]["FieldReviewView"][];
            timeline?: components["schemas"]["Timeline"];
        };
        PatientHit: {
            band: components["schemas"]["MatchBand"];
            /**
             * Format: uuid
             * @description The canonical patient
             */
            patientId: string;
            reasons: components["schemas"]["MatchReason"][];
            score: number;
            summary: components["schemas"]["PatientSummary"];
        };
        PatientMatchRequest: {
            aliases?: string[];
            birth?: components["schemas"]["BirthInput"];
            /**
             * Format: uuid
             * @description The patient being edited
             */
            excludePatientId?: string;
            legalName?: components["schemas"]["LegalNameInput"];
            preferredName?: string;
            surface: components["schemas"]["Surface"];
        };
        PatientMatchResult: {
            candidates: components["schemas"]["PatientHit"][];
            /** Format: uuid */
            checkId: string;
        };
        PatientRedirect: {
            /** Format: date-time */
            mergedAt: string;
            /** Format: uuid */
            mergedId: string;
            /** Format: uuid */
            survivorId: string;
        };
        PatientSearch: {
            birth?: components["schemas"]["BirthQuery"];
            /** @default 20 */
            limit: number;
            /** @description Name, street name or description */
            name?: string;
            surface: components["schemas"]["Surface"];
        };
        PatientSearchResult: {
            hits: components["schemas"]["PatientHit"][];
            /** @description More matched than shown: ask for more letters or a birth year */
            truncated: boolean;
        };
        PatientSummary: {
            ageYears?: number | null;
            aliases?: string[];
            allergy?: components["schemas"]["AllergySummary"];
            birth?: components["schemas"]["BirthView"] | null;
            duplicateHint?: boolean;
            /**
             * Format: date
             * @description A calendar date, YYYY-MM-DD
             */
            lastSeenOn?: string | null;
            legalName?: components["schemas"]["LegalNameView"] | null;
            preferredName?: string | null;
            usualArea?: string | null;
            visualDescriptor?: string | null;
        };
        /** @enum {string} */
        Permission: "team.manage_users" | "team.manage_presets" | "team.view_audit" | "patients.view" | "patients.edit" | "patients.correct_identity" | "patients.review_duplicates" | "patients.view_sensitive" | "patients.view_sensitive_exams" | "patients.reverse_resolved" | "encounters.chart" | "checkins.create" | "referrals.create" | "routes.view" | "routes.manage" | "inventory.view" | "inventory.manage" | "billing.view_codes" | "exports.billing" | "exports.grant" | "exports.data" | "quarantine.review" | "devices.manage";
        PermissionInfo: {
            description: string;
            key: components["schemas"]["Permission"];
        };
        PresetEvent: {
            /**
             * @description installed and platform_updated are the platform installer’s; every other act is a person’s
             * @enum {string}
             */
            act: "created" | "updated" | "archived" | "restored" | "update_taken" | "reordered" | "installed" | "platform_updated";
            /** Format: date-time */
            at: string;
            /** @description That version’s body, in the shape of @sineobex/presets for its kind */
            body: {
                [key: string]: unknown;
            };
            /** @description Who acted; null for the platform installer */
            by: components["schemas"]["UserRef"] | null;
            /** @description Why, as the person gave it; null for the platform installer */
            reason: string | null;
            /**
             * @description Whose version it is: the team’s, or the platform’s, installed or taken by a person
             * @enum {string}
             */
            source: "team" | "platform";
            /** @description The version the act made, or stood on: an archive and a restore make none */
            version: number;
        };
        PresetRevision: {
            /** @description The team’s revision this write took: a phone’s next pull gets the change */
            revision: number;
        };
        PresetsPull: {
            /**
             * Format: uuid
             * @description Send as epoch next time
             */
            epoch: string;
            /** @description Every preset changed after since, or all of them; archived ones included */
            presets: components["schemas"]["PulledPreset"][];
            /** @description Replace the copy whole: the revision sent is above the team’s, or another epoch */
            reset: boolean;
            /** @description Send as since next time: the greatest revision among presets, else since */
            revision: number;
        };
        PresetView: {
            /** @description Its current version’s body, in the shape of @sineobex/presets for its kind */
            body: {
                [key: string]: unknown;
            };
            /** @description The team edited, archived or restored it: a platform version is then only offered */
            customized: boolean;
            /** Format: uuid */
            id: string;
            name: string;
            /** @description How many active presets name it, by their kind; only kinds that do. It can’t be archived while any do */
            referencedBy: {
                [key: string]: number;
            };
            /**
             * @description An archived preset is offered for no new work
             * @enum {string}
             */
            state: "active" | "archived";
            /** @description The update changes a field fixed at creation, so it is taken only as a new preset */
            updateChangesFixed: boolean;
            /** @description A newer platform version is on offer to take */
            updateOnOffer: boolean;
            /** @description Its current version: an edit sends it back */
            version: number;
        };
        ProblemNoteView: {
            author: components["schemas"]["UserRef"];
            /** Format: uuid */
            encounterId: string | null;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            problemId: string;
            text: string;
            /** Format: date-time */
            writtenAt: string;
        };
        /** @enum {string} */
        ProblemStatus: "new" | "ongoing" | "resolved";
        ProblemStatusEvent: {
            /** Format: date-time */
            at: string;
            by: components["schemas"]["UserRef"];
            /** Format: uuid */
            encounterId: string | null;
            /** @description A field history entry */
            historyId: string;
            kind: components["schemas"]["HistoryKind"];
            /** Format: uuid */
            problemId: string;
            status: components["schemas"]["ProblemStatus"];
        };
        ProblemView: {
            author: components["schemas"]["UserRef"];
            code: string | null;
            codeDisplay: string | null;
            /** Format: date-time */
            createdAt: string;
            enteredInError: {
                /** Format: date-time */
                at: string;
                by: components["schemas"]["UserRef"];
                reason: string;
            } | null;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            mergedInto: string | null;
            notes: components["schemas"]["ProblemNoteView"][];
            /** Format: uuid */
            patientId: string;
            /** Format: uuid */
            recurrenceOf: string | null;
            /** Format: uuid */
            resolvedInErrorOf: string | null;
            /** @enum {string|null} */
            reversalRequest: "open" | "reversed" | "declined" | null;
            sensitive: boolean;
            status: components["schemas"]["ProblemStatus"];
            statusHistory: components["schemas"]["ProblemStatusEvent"][];
            title: string;
        };
        PulledPreset: {
            /** @description Its current version’s body, in the shape of @sineobex/presets for its kind */
            body: {
                [key: string]: unknown;
            };
            /** Format: uuid */
            id: string;
            /**
             * @description A phone skips a kind it does not know
             * @enum {string}
             */
            kind: "order_category" | "item" | "bundle" | "flag" | "field_supply_map" | "condition_supply_map" | "bag" | "settings";
            /** @description The platform preset it came from; null for the team’s own */
            originKey: string | null;
            /**
             * @description An archived preset is kept for its name
             * @enum {string}
             */
            state: "active" | "archived";
            /** @description Its current version */
            version: number;
        };
        QuarantineItem: {
            /** Format: uuid */
            changeId: string;
            /** Format: date-time */
            decidedAt: string | null;
            decidedBy: components["schemas"]["UserRef"] | null;
            decisionReason: string | null;
            /** Format: uuid */
            deviceId: string;
            /** Format: date-time */
            deviceTime: string;
            entity: string;
            field: string | null;
            /**
             * @description The reviewer may not read this change (lifecycle 6.4): field and value are null, and nothing names what it holds. Their accept answers 403 change_hidden; they may reject it
             * @enum {boolean}
             */
            hidden?: true;
            /** Format: uuid */
            id: string;
            op: string;
            /**
             * @description awaiting_review: it belongs to a record whose create is also waiting here, so that is decided first
             * @enum {string}
             */
            reason: "access_removed" | "permission" | "awaiting_review";
            /** Format: date-time */
            receivedAt: string;
            /** Format: uuid */
            recordId: string;
            /** @enum {string} */
            status: "pending" | "accepted" | "rejected";
            user: components["schemas"]["UserRef"];
            value?: unknown;
        };
        QuarantinePage: {
            /** @description Oldest first */
            items: components["schemas"]["QuarantineItem"][];
            /**
             * Format: uuid
             * @description Pass as afterId for the next page; null on the last
             */
            nextAfterId: string | null;
            /** @description Everyone with items in this status, and the person filtered to, for a filter */
            people: components["schemas"]["UserRef"][];
        };
        QuarantineReceipt: {
            results: {
                /** Format: uuid */
                changeId: string;
                /** @description SHA-256 of the canonical JSON of the value, lowercase hex */
                hash?: string;
                reason?: components["schemas"]["RejectReason"];
                /**
                 * @description quarantined: held for a Program Admin; recorded: an activity log entry, now in the audit chain
                 * @enum {string}
                 */
                status: "quarantined" | "recorded" | "rejected";
            }[];
        };
        QueueNote: {
            /** @description Who attested it last, when a correction sent it back; null otherwise */
            attestedBefore: components["schemas"]["UserRef"] | null;
            author: components["schemas"]["UserRef"];
            /** @description False for a note the caller may not co-sign or attest: one with an answer they may not see, or one they wrote or signed */
            canAct: boolean;
            /** Format: date-time */
            completedAt: string | null;
            heldBecause?: components["schemas"]["NoteHeldBecause"] & unknown;
            /** Format: uuid */
            noteId: string;
            noteTypeKey: string;
            /** @description Who signed it before, when a correction sent it back; null otherwise */
            signedBefore: components["schemas"]["UserRef"] | null;
            /**
             * @description The note type’s title, so no page reads the note types list to word it; empty only in a copy cached before it was sent
             * @default
             */
            title: string;
        };
        QueueVisit: {
            /** Format: uuid */
            encounterId: string;
            notes: components["schemas"]["QueueNote"][];
            /** Format: uuid */
            patientId: string | null;
            preferredName: string | null;
            /** Format: date-time */
            startedAt: string;
        };
        ReadCorrection: {
            at: string;
            by: string;
            credential: string;
            old: string | null;
            path: string;
            reason: string;
        };
        ReadEntry: {
            id: string;
            items: components["schemas"]["ReadItem"][];
            title: string;
        };
        ReadItem: {
            corrections: components["schemas"]["ReadCorrection"][];
            labels: string[];
            path: string;
            /** @description Null for an answer a correction took away */
            value: string | null;
        };
        ReadModel: {
            sections: components["schemas"]["ReadSection"][];
        };
        /** @description A section with items, or a repeating one with entries */
        ReadSection: {
            entries?: components["schemas"]["ReadEntry"][];
            id: string;
            items?: components["schemas"]["ReadItem"][];
            title: string;
        };
        /** @description The automatic recap of one section with an answer (lifecycle 8.1) */
        RecapLine: {
            section: string;
            text: string;
        };
        /** @enum {string} */
        RecordEntity: "encounter" | "encounter_note" | "patient" | "patient_alias" | "patient_allergy" | "patient_consent" | "problem" | "problem_note" | "id_link" | "note_signoff" | "note_addendum" | "note_correction" | "referral";
        RecordRef: {
            entity: components["schemas"]["RecordEntity"];
            /** Format: uuid */
            id: string;
        };
        RecordSnapshot: {
            /** @description What the server holds of the record beyond its fields; no change sets them. Most are set at creation. Some follow what the server records later: a patient’s lastSeenAt, a problem’s status times, merge and reversal request, and a note’s attestation, actingAuthorId and actingAuthorName (who acts as its author, by their display name now), everSigned (signed once, signed now or not), completedAt and signoffId (lifecycle 4.4), and a visit’s hasFinishedNote (a note of it the reader is shown is finished, so its patient, place and summary are locked, lifecycle 3.1). A problem note’s patientId is its problem’s patient, which nothing else of it names (lifecycle 8.4). A note’s createdAt is when the server made it (an admin’s accept, for a create held for review), the order the visit read gives a visit’s notes in, then by ID: to the microsecond, with all six places, so the text sorts as the time does. A sign-off’s signerName, a correction’s correctorName and an addendum’s authorName are as they were then; a referral’s authorName, who recorded it, is their name now */
            attributes: {
                [key: string]: unknown;
            };
            /** Format: uuid */
            authorUserId: string;
            /** Format: date-time */
            createdAt: string;
            entity: components["schemas"]["RecordEntity"];
            fields: {
                [key: string]: components["schemas"]["FieldState"];
            };
            /** Format: uuid */
            id: string;
            status: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        RegisterDevice: {
            appVersion: string;
            /** Format: uuid */
            deviceId: string;
            /** @enum {string} */
            platform: "ios" | "android" | "other";
            /** @description Ed25519 public key, raw bytes, unpadded base64url */
            publicKey: string;
        };
        /** @enum {string} */
        RejectReason: "validation" | "signing_rule" | "stale_reference" | "permission" | "record_locked" | "hash_mismatch" | "awaiting_review";
        RemoveMember: {
            /** @description Why, in a few words. Logged. */
            reason: string;
        };
        ReorderFlags: {
            /** @description Every active flag of the tier, each once, in the order its list shows them */
            ids: string[];
            /** @description Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log. */
            reason: string;
            /**
             * @description The risk level (primary) or the conditions (secondary)
             * @enum {string}
             */
            tier: "primary" | "secondary";
        };
        ReorderFlagsResult: {
            /** @description How many flags moved, each to its next version: 0 when none did, and nothing is written */
            changed: number;
        };
        RestorePreset: {
            /** @description Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log. */
            reason: string;
        };
        ReversalRequestPage: {
            /**
             * Format: uuid
             * @description Pass as afterId for the next page; null on the last
             */
            nextAfterId: string | null;
            requests: {
                original: components["schemas"]["ProblemView"];
                patient: components["schemas"]["PatientSummary"];
                /** Format: uuid */
                patientId: string;
                request: components["schemas"]["ProblemView"];
                /** Format: date-time */
                requestedAt: string;
                requestedBy: components["schemas"]["UserRef"];
            }[];
        };
        ReverseResolved: {
            /** @description Why, in a few words. Logged. */
            reason: string;
            /**
             * Format: uuid
             * @description The "Resolved by mistake" entry this answers
             */
            requestProblemId?: string;
        };
        ReverseResolvedResult: {
            /** @description New or Ongoing entries added since, with the same code or title; the request first */
            mergeCandidates: components["schemas"]["ProblemView"][];
            problem: components["schemas"]["ProblemView"];
        };
        /** @enum {string} */
        ReviewNeeds: "patients.edit" | "patients.correct_identity";
        Role: {
            archived: boolean;
            description: string | null;
            /** Format: uuid */
            id: string;
            isStandard: boolean;
            key: string;
            memberCount: number;
            name: string;
            permissions: components["schemas"]["Permission"][];
        };
        RoleInput: {
            description?: string;
            name: string;
            permissions: components["schemas"]["Permission"][];
        };
        RoleSummary: {
            /** Format: uuid */
            id: string;
            isStandard: boolean;
            key: string;
            name: string;
        };
        ServerTime: {
            epochMs: number;
            /** Format: date-time */
            serverTime: string;
        };
        SignatureQueue: {
            rows: components["schemas"]["QueueVisit"][];
        };
        SignedQuarantine: {
            payload: {
                changes: components["schemas"]["SyncChange"][];
                /** Format: uuid */
                deviceId: string;
                /** @enum {string} */
                purpose: "quarantine";
            };
            /** @description Ed25519 signature of the canonical JSON of `payload`, unpadded base64url */
            signature: string;
        };
        SignedStatus: {
            payload: {
                /** Format: uuid */
                deviceId: string;
                /** @enum {string} */
                purpose: "status";
                /** Format: date-time */
                sentAt: string;
            };
            /** @description Ed25519 signature of the canonical JSON of `payload`, unpadded base64url */
            signature: string;
        };
        SignedWiped: {
            payload: {
                /** Format: uuid */
                deviceId: string;
                /** @enum {string} */
                purpose: "wiped";
                /** Format: date-time */
                wipedAt: string;
            };
            /** @description Ed25519 signature of the canonical JSON of `payload`, unpadded base64url */
            signature: string;
        };
        SignoffView: {
            /** @enum {string} */
            act: "complete" | "sign" | "cosign";
            claimedCredential: components["schemas"]["Credential"] | null;
            clockVerified: boolean;
            /** @description Only to whoever acts as the note’s author, its signer, and a reader who sees every answer of any note */
            contentHash?: string;
            credential: components["schemas"]["Credential"];
            /** @enum {string} */
            effect: "signed" | "completed" | "saved_unsigned" | "none";
            /** Format: uuid */
            id: string;
            needsAttestation: boolean;
            /** Format: date-time */
            signedAt: string;
            signer: components["schemas"]["UserRef"];
            statementVersion: string;
        };
        /**
         * @description Where the result is shown. On the phone no result carries a legal name.
         * @enum {string}
         */
        Surface: "portal" | "phone";
        SyncChange: {
            /**
             * @description The field version the user saw
             * @default 0
             */
            baseVersion: number;
            /** Format: uuid */
            changeId: string;
            /** @default false */
            clockVerified: boolean;
            /**
             * Format: uuid
             * @description The conflicted change this one resolves
             */
            conflictOf?: string;
            /**
             * Format: date-time
             * @description Device time corrected by the last measured offset; from 1970 through 9999 (UTC)
             */
            correctedTime?: string;
            /**
             * Format: date-time
             * @description From 1970 through 9999 (UTC)
             */
            deviceTime: string;
            entity: components["schemas"]["ChangeEntity"];
            field?: string;
            /**
             * Format: uuid
             * @description An earlier change from this device to the same field that this one builds on
             */
            follows?: string;
            /** @enum {string} */
            op: "create" | "set" | "append";
            /** Format: uuid */
            recordId: string;
            /** @enum {string} */
            resolution?: "replace" | "keep_server";
            /** @description Per-device sequence */
            seq: number;
            /**
             * Format: uuid
             * @description A rejected change this one fixes
             */
            supersedes?: string;
            /** @description Required; null is a value */
            value?: unknown;
            /** @description SHA-256 of the canonical JSON of the value, lowercase hex */
            valueHash: string;
        };
        SyncPush: {
            changes: components["schemas"]["SyncChange"][];
            clock: {
                /** Format: date-time */
                deviceTime: string;
            };
            /** Format: uuid */
            deviceId: string;
            unsynced: {
                counts: {
                    [key: string]: number;
                };
                /** Format: date-time */
                oldest?: string;
            };
        };
        SyncPushResult: {
            clock: {
                flagged: boolean;
                offsetMs: number;
            };
            device: {
                status: components["schemas"]["DeviceStatus"];
            };
            /** @description In the order processed. Changes without a result were not processed; send them again. */
            results: components["schemas"]["SyncResult"][];
            /** Format: date-time */
            serverTime: string;
        };
        SyncResult: {
            /** Format: uuid */
            changeId: string;
            /** @description What the server did beyond storing the value. A sign-off’s (lifecycle 4.6): effect, status, attestation, hashMatches, and for effect none its reason: already_finished, not_author or empty (an empty draft, which does not count) */
            details?: {
                [key: string]: unknown;
            };
            /** @description The server’s hash of what it stored; purge only on a match */
            hash?: string;
            message?: string;
            quarantined?: boolean;
            reason?: components["schemas"]["RejectReason"];
            server?: components["schemas"]["FieldState"];
            serverVersion?: number;
            /** @enum {string} */
            status: "accepted" | "rejected" | "conflict";
        };
        TakePresetUpdate: {
            /** @description Take it as a new preset: this one is archived and kept in the history. The only way to take an update that changes a field fixed at creation */
            asNew: boolean;
            /** @description The version you opened: any other is refused as stale, with the current one */
            baseVersion: number;
            /** @description Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log. */
            reason: string;
        };
        TakePresetUpdateResult: {
            /**
             * Format: uuid
             * @description The preset that now holds the update: this one, or the new one
             */
            id: string;
            /** @description The team’s revision this write took: a phone’s next pull gets the change */
            revision: number;
            /** @description Its version now: 1 for a new preset */
            version: number;
        };
        TeamDevice: {
            appVersion: string;
            clockFlagged: boolean;
            clockOffsetMs: number | null;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            lastSeenAt: string | null;
            /** Format: date-time */
            lastSyncAt: string | null;
            /** Format: date-time */
            oldestUnsyncedAt: string | null;
            openRejections: number;
            platform: string;
            /** Format: date-time */
            registeredAt: string;
            status: components["schemas"]["DeviceStatus"];
            unsyncedCounts: {
                [key: string]: number;
            };
            /** @description Something on the phone has waited more than 24 hours (module 9: an admin alert at 24 hours) */
            unsyncedStale: boolean;
            user: components["schemas"]["UserRef"];
            /** Format: date-time */
            wipedAt: string | null;
            /** Format: date-time */
            wipeRequestedAt: string | null;
        };
        TeamIndexPage: {
            entries: components["schemas"]["IndexEntry"][];
            /** Format: date-time */
            generatedAt: string;
            /** Format: uuid */
            next: string | null;
            projection: string;
            /** @description First page only: the team’s complete list */
            redirects: components["schemas"]["PatientRedirect"][];
            /** @enum {string} */
            status: "unchanged" | "page";
            version: string;
        };
        TeamIndexRequest: {
            /**
             * Format: uuid
             * @description The previous page’s next
             */
            after?: string;
            /** @description The version this phone holds */
            have?: string;
            /** @default 500 */
            limit: number;
        };
        TeamStatusChange: {
            /** @description Why, in a few words. Logged. */
            reason: string;
            /** @enum {string} */
            status: "active" | "suspended";
        };
        /** @description On the chart and the phone’s cache; absent where a chart is shown beside a decision */
        Timeline: {
            /** @description Newest first, the first 50 */
            encounters: components["schemas"]["TimelineVisit"][];
            referrals: components["schemas"]["RecordSnapshot"][];
        };
        /**
         * @description The note type’s timeline filter (forms 2.2)
         * @enum {string}
         */
        TimelineGroup: "clinical" | "psych" | "social" | "outreach" | "harm_reduction" | "wound";
        TimelineNote: {
            attestation: components["schemas"]["NoteAttestation"];
            group: components["schemas"]["TimelineGroup"];
            /**
             * @description A Medical note: completed for a co-signer or signed, and attested when it waits (lifecycle 3.1)
             * @default false
             */
            medical: boolean;
            /** Format: uuid */
            noteId: string;
            noteTypeKey: string;
            status: components["schemas"]["NoteStatus"];
            /**
             * @description The note type’s title, so no page reads the note types list to word it; empty only in a copy cached before it was sent
             * @default
             */
            title: string;
        };
        TimelinePage: {
            /** @description Newest first, at most 50 */
            encounters: components["schemas"]["TimelineVisit"][];
        };
        TimelineVisit: {
            /** Format: uuid */
            encounterId: string;
            kind: components["schemas"]["EncounterKind"];
            notes: components["schemas"]["TimelineNote"][];
            /** Format: date-time */
            startedAt: string;
            status: components["schemas"]["NoteStatus"];
        };
        UndoMerge: {
            /** @description Why, in a few words. Logged. */
            comment: string;
        };
        UndoMergeResult: {
            /** @description Reviews on the kept chart that offered the merged record’s values and were decided while merged */
            decidedReviews: {
                /** Format: date-time */
                decidedAt: string;
                decidedBy: components["schemas"]["UserRef"];
                field: string;
                /** @description The kept chart took the merged record’s value. Undo leaves it there: check it and correct it by hand */
                keptMergedValue: boolean;
                /** Format: uuid */
                reviewId: string;
            }[];
            keptFields: string[];
            linksIssuedWhileMerged: {
                /** Format: date-time */
                effectiveAt: string;
                /** Format: uuid */
                issuedOn: string;
                /** Format: uuid */
                linkId: string;
                reason: components["schemas"]["IdLinkReason"];
                tokenRef: string;
            }[];
            merge: components["schemas"]["MergeView"];
            /** @description Edits sent to the merged record while merged, which went to the kept chart: move by hand */
            redirectedEdits: {
                /** Format: date-time */
                at: string;
                by: components["schemas"]["UserRef"];
                field: string;
                /** @description A field history entry */
                historyId: string;
                /**
                 * @description applied: written to the kept chart; kept_both: offered in a review there (taken out by the undo); history_only: kept in its history
                 * @enum {string}
                 */
                outcome: "applied" | "kept_both" | "history_only";
            }[];
            restoredLinks: {
                /** Format: uuid */
                issuedOn: string;
                /** Format: uuid */
                linkId: string;
                tokenRef: string;
            }[];
            revertedFields: string[];
            /** @description Open reviews on the kept chart closed because only the merged record’s values were left to choose */
            reviewsClosed: number;
            /** @description The merged record’s own open reviews, which the merge had closed, open again */
            reviewsReopened: number;
        };
        UserRef: {
            displayName: string;
            /** Format: uuid */
            userId: string;
        };
        VisitNote: {
            actingAuthor: components["schemas"]["UserRef"];
            addenda: components["schemas"]["AddendumView"][];
            attestation: components["schemas"]["NoteAttestation"];
            attestations: components["schemas"]["AttestationView"][];
            author: components["schemas"]["UserRef"];
            /**
             * @description The reader may attest it now: the attestation’s own rule asked as if the hash matched (lifecycle 5.4)
             * @default false
             */
            canAttest: boolean;
            /**
             * @description The reader may co-sign it now: the co-sign’s own rule asked as if the hash matched, as a queue’s canAct is (lifecycle 5.3)
             * @default false
             */
            canCosign: boolean;
            /** Format: date-time */
            completedAt: string | null;
            /** @description The note as it is now (lifecycle 4.5), to send with a co-sign or an attest: only to a reader who acts as its author, sees every answer of any note, or may co-sign or attest and sees every answer of this one */
            contentHash?: string;
            corrections: components["schemas"]["CorrectionView"][];
            group: components["schemas"]["TimelineGroup"];
            heldBecause?: components["schemas"]["NoteHeldBecause"];
            /**
             * @description A Medical note: completed for a co-signer or signed, and attested when it waits (lifecycle 3.1)
             * @default false
             */
            medical: boolean;
            /** Format: uuid */
            noteId: string;
            noteTypeKey: string;
            noteTypeVersion: number;
            read: components["schemas"]["ReadModel"];
            /** @description One line per section with an answer, in the definition’s order, over what the reader may see of the note; nothing from a sensitive exam, for any reader */
            recap: components["schemas"]["RecapLine"][];
            signoffs: components["schemas"]["SignoffView"][];
            status: components["schemas"]["NoteStatus"];
            title: string;
        };
        VisitRead: {
            /** @description The visit’s own, naming no note */
            addenda: components["schemas"]["AddendumView"][];
            clockVerified: boolean;
            /** Format: uuid */
            encounterId: string;
            /**
             * @description The visit’s Red flags note, as the reader may read it, shows Show handoff (EMS was activated): GET /v1/encounters/{encounterId}/ems-handoff would give its file (lifecycle 5.7, 9.11)
             * @default false
             */
            hasHandoff: boolean;
            kind: components["schemas"]["EncounterKind"];
            locationText: string | null;
            /** @description The notes the reader may see; no empty draft */
            notes: components["schemas"]["VisitNote"][];
            /** Format: uuid */
            patientId: string | null;
            /**
             * @description The patient’s preferred name, from the chart they were merged into when they were, as a queue row shows it; null for a visit with no patient
             * @default null
             */
            preferredName: string | null;
            /** @description Referrals, allergies, problems and problem notes made at the visit, whichever chart they are on, as the reader may see them */
            records: components["schemas"]["RecordSnapshot"][];
            /**
             * @description The IDs of the records above that are on a chart other than the visit’s now, by the patients’ charts: a record kept under a merged ID of the visit’s own patient is on its chart; every record of a visit with no patient is on another
             * @default []
             */
            recordsOnAnotherChart: string[];
            /** Format: date-time */
            startedAt: string;
            status: components["schemas"]["NoteStatus"];
            /** @description Absent for a Medical visit to a reader of no Medical notes */
            summary?: string | null;
        };
        WipeDevice: {
            /** @description Why, in a few words. Logged. */
            reason: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    reorderFlags: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReorderFlags"];
            };
        };
        responses: {
            /** @description How many flags moved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReorderFlagsResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listPresets: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The kind of preset */
                kind: "order_category" | "item" | "bundle" | "flag" | "field_supply_map" | "condition_supply_map" | "bag" | "settings";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Presets */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PresetView"][];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createPreset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The kind of preset */
                kind: "order_category" | "item" | "bundle" | "flag" | "field_supply_map" | "condition_supply_map" | "bag" | "settings";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatePreset"];
            };
        };
        responses: {
            /** @description Created at version 1 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatePresetResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    editPreset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                /** @description The kind of preset */
                kind: "order_category" | "item" | "bundle" | "flag" | "field_supply_map" | "condition_supply_map" | "bag" | "settings";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EditPreset"];
            };
        };
        responses: {
            /** @description Its next version */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EditPresetResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    archivePreset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                /** @description The kind of preset */
                kind: "order_category" | "item" | "bundle" | "flag" | "field_supply_map" | "condition_supply_map" | "bag" | "settings";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ArchivePreset"];
            };
        };
        responses: {
            /** @description Archived, at the version it is at */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PresetRevision"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getPresetHistory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                /** @description The kind of preset */
                kind: "order_category" | "item" | "bundle" | "flag" | "field_supply_map" | "condition_supply_map" | "bag" | "settings";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Its history */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PresetEvent"][];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    restorePreset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                /** @description The kind of preset */
                kind: "order_category" | "item" | "bundle" | "flag" | "field_supply_map" | "condition_supply_map" | "bag" | "settings";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RestorePreset"];
            };
        };
        responses: {
            /** @description Restored, at the version it is at */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PresetRevision"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    takePresetUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                /** @description The kind of preset */
                kind: "order_category" | "item" | "bundle" | "flag" | "field_supply_map" | "condition_supply_map" | "bag" | "settings";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TakePresetUpdate"];
            };
        };
        responses: {
            /** @description The preset that holds the update, at its version now */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TakePresetUpdateResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    registerDevice: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterDevice"];
            };
        };
        responses: {
            /** @description Already registered with this key */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Device"];
                };
            };
            /** @description Registered */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Device"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    uploadQuarantine: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deviceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SignedQuarantine"];
            };
        };
        responses: {
            /** @description Receipts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuarantineReceipt"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    deviceStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deviceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SignedStatus"];
            };
        };
        responses: {
            /** @description Status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeviceStatusResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    confirmWiped: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deviceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SignedWiped"];
            };
        };
        responses: {
            /** @description Recorded */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getEncounter: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                encounterId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The visit */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VisitRead"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    attestEncounter: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                encounterId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NoteActInput"];
            };
        };
        responses: {
            /** @description Each note’s state now */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteActResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    cosignEncounter: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                encounterId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NoteActInput"];
            };
        };
        responses: {
            /** @description Each note’s state now */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteActResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getEmsHandoff: {
        parameters: {
            query?: {
                /** @description The reader’s IANA time zone (for example America/Detroit): the file’s times are printed in it, with its name. Without it, in UTC. */
                timeZone?: string;
            };
            header?: never;
            path: {
                encounterId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The handoff, as a PDF to save or print */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/pdf": string;
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listNoteTypes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The list */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteTypeList"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getNoteTypeDefinition: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description A note type’s key, as migration 0017 allows it */
                key: string;
                /** @description A version, 1 or more */
                version: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The definition */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteTypeDefinition"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Healthy */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description You */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    acceptAcknowledgement: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Acknowledgement"];
            };
        };
        responses: {
            /** @description Recorded */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getHomeCounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The counts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HomeCounts"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getNotesToFinish: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The drafts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotesToFinish"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    assignNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                noteId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssignInput"];
            };
        };
        responses: {
            /** @description The assignment */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteAssigned"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getNoteAssignees: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                noteId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The people the note may be assigned to */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteAssignees"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ownerListTeams: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Teams */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnerTeam"][];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ownerCreateTeam: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTeam"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnerTeam"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ownerRemoveMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                membershipId: string;
                teamId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Why, in a few words. Logged. */
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ownerAppointProgramAdmin: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                teamId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AppointAdmin"];
            };
        };
        responses: {
            /** @description Appointed */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ownerSetTeamStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                teamId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TeamStatusChange"];
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnerTeam"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getPatient: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                patientId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The chart */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PatientChart"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    correctIdentity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                patientId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IdentityCorrection"];
            };
        };
        responses: {
            /** @description The chart after the correction */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PatientChart"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getPatientHistory: {
        parameters: {
            query?: {
                /** @description The previous page’s nextAfterId */
                afterId?: string;
                /** @description A field name; every field when absent */
                field?: string;
            };
            header?: never;
            path: {
                patientId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of history */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FieldHistoryPage"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getIdLinks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                patientId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cards */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdLinkState"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    issueIdLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                patientId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IssueIdLink"];
            };
        };
        responses: {
            /** @description Cards after the issue */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdLinkState"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getPatientTimeline: {
        parameters: {
            query?: {
                /** @description The last visit already shown */
                before?: string;
            };
            header?: never;
            path: {
                patientId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Earlier visits */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TimelinePage"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    fetchCharts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FetchCharts"];
            };
        };
        responses: {
            /** @description Charts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChartBundle"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    downloadTeamIndex: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TeamIndexRequest"];
            };
        };
        responses: {
            /** @description A page, or unchanged */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TeamIndexPage"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    matchPatients: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatientMatchRequest"];
            };
        };
        responses: {
            /** @description Candidates */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PatientMatchResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    searchPatients: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatientSearch"];
            };
        };
        responses: {
            /** @description Results */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PatientSearchResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listPermissions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Catalog */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PermissionInfo"][];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    pullPresets: {
        parameters: {
            query?: {
                /** @description The epoch the phone’s copy came from */
                epoch?: string;
                /** @description The revision the phone holds; everything when absent */
                since?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Presets */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PresetsPull"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    mergeProblems: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                problemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MergeProblems"];
            };
        };
        responses: {
            /** @description The entry kept */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemView"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reverseResolvedProblem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                problemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReverseResolved"];
            };
        };
        responses: {
            /** @description Reversed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReverseResolvedResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    syncPush: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SyncPush"];
            };
        };
        responses: {
            /** @description Receipts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SyncPushResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    fetchRecords: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FetchRecords"];
            };
        };
        responses: {
            /** @description Records */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FetchRecordsResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getAttestationQueue: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The queue */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SignatureQueue"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    searchAudit: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AuditSearch"];
            };
        };
        responses: {
            /** @description Entries, newest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditPage"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    verifyAuditChain: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChainCheck"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getCosignQueue: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The queue */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SignatureQueue"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listDevices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Devices */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TeamDevice"][];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    wipeDevice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deviceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WipeDevice"];
            };
        };
        responses: {
            /** @description Wipe requested */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listDuplicates: {
        parameters: {
            query?: {
                /** @description The previous page’s nextAfterId */
                afterId?: string;
                /** @description open: open and not sure */
                status?: "open" | "not_sure" | "decided";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of pairs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DuplicatePage"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    flagDuplicate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FlagDuplicate"];
            };
        };
        responses: {
            /** @description The pair */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DuplicatePairSummary"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getDuplicatePair: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                pairId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The pair */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DuplicatePairDetail"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    decideDuplicate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                pairId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DecideDuplicate"];
            };
        };
        responses: {
            /** @description Decided */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DuplicateDecisionResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listFieldReviews: {
        parameters: {
            query?: {
                /** @description The previous page’s nextAfterId */
                afterId?: string;
                status?: "open" | "decided";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of reviews */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FieldReviewPage"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    decideFieldReview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                reviewId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DecideFieldReview"];
            };
        };
        responses: {
            /** @description Decided */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FieldReviewView"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getIncompleteNotes: {
        parameters: {
            query?: {
                /** @description Only the drafts this person acts as the author of (the route lead’s view, phase 7) */
                author?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The drafts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IncompleteNotes"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listMembers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Members */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"][];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    inviteMember: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InviteMember"];
            };
        };
        responses: {
            /** @description Invited */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                membershipId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Member */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    changeMemberCredential: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                membershipId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeCredential"];
            };
        };
        responses: {
            /** @description Changed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"] & {
                        /** @enum {string} */
                        direction: "up" | "down" | "same";
                    };
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getMemberHistory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                membershipId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description History */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MembershipChange"][];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    removeMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                membershipId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RemoveMember"];
            };
        };
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    changeMemberRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                membershipId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeRole"];
            };
        };
        responses: {
            /** @description Changed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listMerges: {
        parameters: {
            query?: {
                /** @description The previous page’s nextAfterId */
                afterId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of merges */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MergePage"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    undoMerge: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                mergeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UndoMerge"];
            };
        };
        responses: {
            /** @description Undone */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UndoMergeResult"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listNotices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Notices */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Notice"][];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    markNoticeRead: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                noticeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Marked read */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listProblemReversals: {
        parameters: {
            query?: {
                /** @description The previous page’s nextAfterId */
                afterId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of requests */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReversalRequestPage"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    declineProblemReversal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                problemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeclineReversal"];
            };
        };
        responses: {
            /** @description Declined */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemView"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listQuarantine: {
        parameters: {
            query?: {
                /** @description The previous page’s nextAfterId */
                afterId?: string;
                status?: "pending" | "accepted" | "rejected";
                /** @description Only this person’s items */
                userId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of items */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuarantinePage"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    decideQuarantine: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DecideQuarantine"];
            };
        };
        responses: {
            /** @description Decided */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listRoles: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Roles */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Role"][];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createRole: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleInput"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Role"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                roleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleInput"];
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Role"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    archiveRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                roleId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Archived */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Role"];
                };
            };
            /** @description Not signed in, or the session expired */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getServerTime: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current server time */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServerTime"];
                };
            };
        };
    };
}
