// GENERATED FILE. Do not edit by hand. Regenerate with `pnpm contract:generate`.
export interface paths {
    readonly "/v1/health": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Liveness, database reachability and whether this is a demo deployment */
        readonly get: operations["getHealth"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** The signed-in person, their teams, and what they still need to do before using one */
        readonly get: operations["getMe"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me/acknowledgements": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Accept the Terms of Use or the confidentiality acknowledgement */
        readonly post: operations["acceptAcknowledgement"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/owner/teams": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Every team, with its Program Admins (platform owners only) */
        readonly get: operations["ownerListTeams"];
        readonly put?: never;
        /** Create a team. A community health worker preset role is added to it. */
        readonly post: operations["ownerCreateTeam"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/owner/teams/{teamId}/members/{membershipId}/remove": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Remove anyone from a team, including a Program Admin */
        readonly post: operations["ownerRemoveMember"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/owner/teams/{teamId}/program-admins": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Appoint a team's Program Admin */
        readonly post: operations["ownerAppointProgramAdmin"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/owner/teams/{teamId}/status": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Suspend or reinstate a team. A suspended team cannot reach any data. */
        readonly post: operations["ownerSetTeamStatus"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/permissions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Every permission a role can hold, with a plain description */
        readonly get: operations["listPermissions"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/audit/search": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Search the audit log by person, patient, action and time. The search itself is logged. */
        readonly post: operations["searchAudit"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/audit/verify": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Recompute every hash in the team's audit chain */
        readonly post: operations["verifyAuditChain"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/members": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Everyone on the team, active and removed */
        readonly get: operations["listMembers"];
        readonly put?: never;
        /** Invite a person with a role and credential (Program Admins can only be appointed by owners) */
        readonly post: operations["inviteMember"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/members/{membershipId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["getMember"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/members/{membershipId}/credential": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** Change a credential. Moving up takes effect only with the new credential's fields filled in. */
        readonly put: operations["changeMemberCredential"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/members/{membershipId}/history": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Every role, credential and status change for one membership, with reasons */
        readonly get: operations["getMemberHistory"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/members/{membershipId}/remove": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Remove a person. Their sessions stop working at once; their phone's data is handled at next contact. */
        readonly post: operations["removeMember"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/members/{membershipId}/role": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** Change a role, with a reason that is logged */
        readonly put: operations["changeMemberRole"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/roles": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Standard roles and this team's custom roles */
        readonly get: operations["listRoles"];
        readonly put?: never;
        /** Create a custom role from existing permissions */
        readonly post: operations["createRole"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/roles/{roleId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** Change a custom role. Standard roles cannot be changed. */
        readonly put: operations["updateRole"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/team/roles/{roleId}/archive": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Archive a custom role nobody holds */
        readonly post: operations["archiveRole"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/time": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Server time, used by the phone to measure its clock offset (module 9) */
        readonly get: operations["getServerTime"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        readonly Acknowledgement: {
            /** @enum {string} */
            readonly kind: "terms_of_use" | "confidentiality";
            readonly version: string;
        };
        readonly AppointAdmin: {
            readonly credential?: components["schemas"]["Credential"];
            readonly credentialFields?: components["schemas"]["CredentialFields"];
            readonly displayName: string;
            /** Format: email */
            readonly email: string;
        };
        readonly AuditEntry: {
            readonly action: string;
            readonly actor: {
                readonly displayName: string | null;
                readonly role: string | null;
                /** Format: uuid */
                readonly userId: string | null;
            };
            readonly details: {
                readonly [key: string]: unknown;
            };
            /** Format: uuid */
            readonly deviceId: string | null;
            /** Format: date-time */
            readonly deviceTime: string | null;
            readonly entity: string | null;
            readonly entityId: string | null;
            readonly id: string;
            readonly ip: string | null;
            /** Format: date-time */
            readonly occurredAt: string;
            /** Format: uuid */
            readonly patientId: string | null;
            readonly seq: string;
        };
        readonly AuditPage: {
            readonly entries: readonly components["schemas"]["AuditEntry"][];
            readonly nextBeforeId: string | null;
        };
        readonly AuditSearch: {
            readonly actionPrefix?: string;
            /** Format: uuid */
            readonly actorUserId?: string;
            readonly beforeId?: string;
            /** Format: date-time */
            readonly from?: string;
            /** @default 50 */
            readonly limit: number;
            /** Format: uuid */
            readonly patientId?: string;
            /** Format: date-time */
            readonly to?: string;
        };
        readonly ChainCheck: {
            readonly checked: number;
            readonly firstBadSeq: number | null;
            readonly ok: boolean;
            readonly problem: string | null;
        };
        readonly ChangeCredential: {
            readonly credential: components["schemas"]["Credential"];
            readonly credentialFields?: components["schemas"]["CredentialFields"];
            /** @description Why, in a few words. Logged. */
            readonly reason: string;
        };
        readonly ChangeRole: {
            /** @description Why, in a few words. Logged. */
            readonly reason: string;
            /** Format: uuid */
            readonly roleId: string;
        };
        readonly CreateTeam: {
            readonly name: string;
        };
        /** @enum {string} */
        readonly Credential: "attending" | "resident" | "np" | "pa" | "student" | "chw" | "none";
        readonly CredentialFields: {
            readonly licenseNumber?: string;
            readonly licenseState?: string;
            readonly npi?: string;
            readonly program?: string;
            readonly school?: string;
            readonly supervisingAttending?: string;
            readonly supervisingPhysician?: string;
        };
        readonly ErrorResponse: {
            readonly error: {
                readonly code: string;
                readonly details?: {
                    readonly [key: string]: unknown;
                };
                readonly message: string;
            };
        };
        readonly Health: {
            readonly demo: boolean;
            /** @enum {string} */
            readonly environment: "local" | "test" | "preview" | "pilot" | "production";
            readonly release: string;
            /** @enum {string} */
            readonly status: "ok";
        };
        readonly InviteMember: {
            readonly credential?: components["schemas"]["Credential"];
            readonly credentialFields?: components["schemas"]["CredentialFields"];
            readonly displayName: string;
            /** Format: email */
            readonly email: string;
            /** Format: uuid */
            readonly roleId: string;
        };
        readonly Me: {
            readonly isOwner: boolean;
            readonly mfa: {
                readonly required: boolean;
                readonly satisfied: boolean;
            };
            readonly pendingAcknowledgements: readonly components["schemas"]["Acknowledgement"][];
            readonly teams: readonly components["schemas"]["MyTeam"][];
            readonly user: {
                readonly displayName: string;
                readonly email: string;
                /** Format: uuid */
                readonly id: string;
            };
        };
        readonly Member: {
            readonly credential: components["schemas"]["Credential"];
            readonly credentialFields: components["schemas"]["CredentialFields"];
            readonly displayName: string;
            readonly email: string;
            /** Format: date-time */
            readonly invitedAt: string;
            /** Format: uuid */
            readonly membershipId: string;
            /** Format: date-time */
            readonly removedAt: string | null;
            readonly role: components["schemas"]["RoleSummary"];
            /** @enum {string} */
            readonly status: "active" | "removed";
            /** Format: uuid */
            readonly userId: string;
        };
        readonly MembershipChange: {
            /** Format: date-time */
            readonly changedAt: string;
            readonly changedBy: {
                readonly displayName: string;
                /** Format: uuid */
                readonly userId: string;
            };
            /** Format: uuid */
            readonly id: string;
            /** @enum {string} */
            readonly kind: "invited" | "role" | "credential" | "removed" | "restored";
            readonly newValue?: unknown;
            readonly oldValue?: unknown;
            readonly reason: string | null;
        };
        readonly MyTeam: {
            readonly credential: components["schemas"]["Credential"];
            readonly permissions: readonly components["schemas"]["Permission"][];
            readonly roleKey: string;
            readonly roleName: string;
            /** Format: uuid */
            readonly teamId: string;
            readonly teamName: string;
            /** @enum {string} */
            readonly teamStatus: "active" | "suspended";
        };
        readonly Ok: {
            /** @enum {boolean} */
            readonly ok: true;
        };
        readonly OwnerTeam: {
            readonly activeMembers: number;
            /** Format: date-time */
            readonly createdAt: string;
            /** Format: uuid */
            readonly id: string;
            readonly name: string;
            readonly programAdmins: readonly {
                readonly displayName: string;
                readonly email: string;
                /** Format: uuid */
                readonly membershipId: string;
            }[];
            /** @enum {string} */
            readonly status: "active" | "suspended";
        };
        /** @enum {string} */
        readonly Permission: "team.manage_users" | "team.manage_presets" | "team.view_audit" | "patients.view" | "patients.edit" | "patients.correct_identity" | "patients.review_duplicates" | "patients.view_sensitive" | "patients.view_sensitive_exams" | "patients.reverse_resolved" | "encounters.chart" | "checkins.create" | "referrals.create" | "routes.view" | "routes.manage" | "inventory.view" | "inventory.manage" | "billing.view_codes" | "exports.billing" | "exports.grant" | "exports.data" | "quarantine.review" | "devices.manage";
        readonly PermissionInfo: {
            readonly description: string;
            readonly key: components["schemas"]["Permission"];
        };
        readonly RemoveMember: {
            /** @description Why, in a few words. Logged. */
            readonly reason: string;
        };
        readonly Role: {
            readonly archived: boolean;
            readonly description: string | null;
            /** Format: uuid */
            readonly id: string;
            readonly isStandard: boolean;
            readonly key: string;
            readonly memberCount: number;
            readonly name: string;
            readonly permissions: readonly components["schemas"]["Permission"][];
        };
        readonly RoleInput: {
            readonly description?: string;
            readonly name: string;
            readonly permissions: readonly components["schemas"]["Permission"][];
        };
        readonly RoleSummary: {
            /** Format: uuid */
            readonly id: string;
            readonly isStandard: boolean;
            readonly key: string;
            readonly name: string;
        };
        readonly ServerTime: {
            readonly epochMs: number;
            /** Format: date-time */
            readonly serverTime: string;
        };
        readonly TeamStatusChange: {
            /** @description Why, in a few words. Logged. */
            readonly reason: string;
            /** @enum {string} */
            readonly status: "active" | "suspended";
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
    readonly getHealth: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Healthy */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    readonly getMe: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description You */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly acceptAcknowledgement: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["Acknowledgement"];
            };
        };
        readonly responses: {
            /** @description Recorded */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Ok"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly ownerListTeams: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Teams */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": readonly components["schemas"]["OwnerTeam"][];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly ownerCreateTeam: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateTeam"];
            };
        };
        readonly responses: {
            /** @description Created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["OwnerTeam"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly ownerRemoveMember: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly membershipId: string;
                readonly teamId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": {
                    /** @description Why, in a few words. Logged. */
                    readonly reason: string;
                };
            };
        };
        readonly responses: {
            /** @description Removed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly ownerAppointProgramAdmin: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly teamId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["AppointAdmin"];
            };
        };
        readonly responses: {
            /** @description Appointed */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly ownerSetTeamStatus: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly teamId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["TeamStatusChange"];
            };
        };
        readonly responses: {
            /** @description Updated */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["OwnerTeam"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly listPermissions: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Catalog */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": readonly components["schemas"]["PermissionInfo"][];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly searchAudit: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["AuditSearch"];
            };
        };
        readonly responses: {
            /** @description Entries, newest first */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AuditPage"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly verifyAuditChain: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Result */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ChainCheck"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly listMembers: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Members */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": readonly components["schemas"]["Member"][];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly inviteMember: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["InviteMember"];
            };
        };
        readonly responses: {
            /** @description Invited */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly getMember: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly membershipId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Member */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly changeMemberCredential: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly membershipId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ChangeCredential"];
            };
        };
        readonly responses: {
            /** @description Changed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Member"] & {
                        /** @enum {string} */
                        readonly direction: "up" | "down" | "same";
                    };
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly getMemberHistory: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly membershipId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description History */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": readonly components["schemas"]["MembershipChange"][];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly removeMember: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly membershipId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RemoveMember"];
            };
        };
        readonly responses: {
            /** @description Removed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly changeMemberRole: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly membershipId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ChangeRole"];
            };
        };
        readonly responses: {
            /** @description Changed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly listRoles: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Roles */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": readonly components["schemas"]["Role"][];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly createRole: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RoleInput"];
            };
        };
        readonly responses: {
            /** @description Created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Role"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly updateRole: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly roleId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RoleInput"];
            };
        };
        readonly responses: {
            /** @description Updated */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Role"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation failed */
            readonly 422: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly archiveRole: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly roleId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Archived */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Role"];
                };
            };
            /** @description Not signed in, or the session expired */
            readonly 401: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not allowed; the refusal is logged */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Not found */
            readonly 404: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Conflicts with the current state */
            readonly 409: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    readonly getServerTime: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Current server time */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ServerTime"];
                };
            };
        };
    };
}
