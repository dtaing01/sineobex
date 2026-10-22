// GENERATED FILE. Do not edit by hand. Regenerate with `pnpm contract:generate`.
export interface paths {
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
        /** The server’s copy of records, with each field’s version, for drafts a phone holds open */
        post: operations["fetchRecords"];
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
        ChangeEntity: "encounter" | "encounter_note" | "audit" | "patient" | "patient_alias" | "patient_allergy" | "patient_consent" | "problem" | "problem_note" | "id_link";
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
            /** @enum {string} */
            status: "open" | "not_sure";
        };
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
            field: string;
            /** Format: uuid */
            id: string;
            needs: components["schemas"]["ReviewNeeds"];
            /** Format: date-time */
            openedAt: string;
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
        IndexEntry: {
            aliases: {
                alias: string;
                /** Format: uuid */
                id: string;
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
            duplicate: components["schemas"]["DuplicateHint"] | null;
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
        Notice: {
            /** Format: date-time */
            createdAt: string;
            entity: string | null;
            /** Format: uuid */
            id: string;
            kind: string;
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
            /**
             * Format: uuid
             * @description The merged ID that was asked for
             */
            redirectedFrom?: string;
            reviews: components["schemas"]["FieldReviewView"][];
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
        /** @enum {string} */
        RecordEntity: "encounter" | "encounter_note" | "patient" | "patient_alias" | "patient_allergy" | "patient_consent" | "problem" | "problem_note" | "id_link";
        RecordRef: {
            entity: components["schemas"]["RecordEntity"];
            /** Format: uuid */
            id: string;
        };
        RecordSnapshot: {
            /** @description Set at creation, never changed */
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
             * @description Device time corrected by the last measured offset
             */
            correctedTime?: string;
            /** Format: date-time */
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
        UndoMerge: {
            /** @description Why, in a few words. Logged. */
            comment: string;
        };
        UndoMergeResult: {
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
            /** @description Edits sent to the merged record and applied to the survivor: move by hand */
            redirectedEdits: {
                /** Format: date-time */
                at: string;
                by: components["schemas"]["UserRef"];
                field: string;
                /** @description A field history entry */
                historyId: string;
            }[];
            restoredLinks: {
                /** Format: uuid */
                issuedOn: string;
                /** Format: uuid */
                linkId: string;
                tokenRef: string;
            }[];
            revertedFields: string[];
            reviewsClosed: number;
        };
        UserRef: {
            displayName: string;
            /** Format: uuid */
            userId: string;
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
