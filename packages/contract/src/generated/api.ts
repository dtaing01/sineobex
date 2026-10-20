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
        readonly Health: {
            readonly demo: boolean;
            /** @enum {string} */
            readonly environment: "local" | "test" | "preview" | "pilot" | "production";
            readonly release: string;
            /** @enum {string} */
            readonly status: "ok";
        };
        readonly ServerTime: {
            readonly epochMs: number;
            /** Format: date-time */
            readonly serverTime: string;
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
