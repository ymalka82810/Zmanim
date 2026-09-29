/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as errorLog from "../errorLog.js";
import type * as events from "../events.js";
import type * as fund from "../fund.js";
import type * as hebrewDate from "../hebrewDate.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as inviteCode from "../inviteCode.js";
import type * as invites from "../invites.js";
import type * as kiddush from "../kiddush.js";
import type * as members from "../members.js";
import type * as notifications from "../notifications.js";
import type * as roles from "../roles.js";
import type * as schedules from "../schedules.js";
import type * as storage from "../storage.js";
import type * as synagogues from "../synagogues.js";
import type * as users from "../users.js";
import type * as zmanimProfiles from "../zmanimProfiles.js";
import type * as zmanimSettings from "../zmanimSettings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  crons: typeof crons;
  email: typeof email;
  errorLog: typeof errorLog;
  events: typeof events;
  fund: typeof fund;
  hebrewDate: typeof hebrewDate;
  http: typeof http;
  invitations: typeof invitations;
  inviteCode: typeof inviteCode;
  invites: typeof invites;
  kiddush: typeof kiddush;
  members: typeof members;
  notifications: typeof notifications;
  roles: typeof roles;
  schedules: typeof schedules;
  storage: typeof storage;
  synagogues: typeof synagogues;
  users: typeof users;
  zmanimProfiles: typeof zmanimProfiles;
  zmanimSettings: typeof zmanimSettings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
