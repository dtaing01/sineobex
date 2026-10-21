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
        ChangeEntity: "encounter" | "encounter_note" | "audit";
        ChangeRole: {
            /** @description Why, in a few words. Logged. */
            reason: string;
            /** Format: uuid */
            roleId: string;
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
        DecideQuarantine: {
            /** @enum {string} */
            decision: "accept" | "reject";
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
        ErrorResponse: {
            error: {
                code: string;
                details?: {
                    [key: string]: unknown;
                };
                message: string;
            };
        };
        FetchRecords: {
            records: components["schemas"]["RecordRef"][];
        };
        FetchRecordsResult: {
            missing: components["schemas"]["RecordRef"][];
            records: components["schemas"]["RecordSnapshot"][];
        };
        /** @description On conflict: the value the server holds */
        FieldState: {
            /** Format: date-time */
            changedAt: string | null;
            /** Format: uuid */
            changedBy: string | null;
            value?: unknown;
            version: number;
        };
        Health: {
            demo: boolean;
            /** @enum {string} */
            environment: "local" | "test" | "preview" | "pilot" | "production";
            release: string;
            /** @enum {string} */
            status: "ok";
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
        Me: {
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
        /** @enum {string} */
        Permission: "team.manage_users" | "team.manage_presets" | "team.view_audit" | "patients.view" | "patients.edit" | "patients.correct_identity" | "patients.review_duplicates" | "patients.view_sensitive" | "patients.view_sensitive_exams" | "patients.reverse_resolved" | "encounters.chart" | "checkins.create" | "referrals.create" | "routes.view" | "routes.manage" | "inventory.view" | "inventory.manage" | "billing.view_codes" | "exports.billing" | "exports.grant" | "exports.data" | "quarantine.review" | "devices.manage";
        PermissionInfo: {
            description: string;
            key: components["schemas"]["Permission"];
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
        RecordEntity: "encounter" | "encounter_note";
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
        TeamStatusChange: {
            /** @description Why, in a few words. Logged. */
            reason: string;
            /** @enum {string} */
            status: "active" | "suspended";
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
