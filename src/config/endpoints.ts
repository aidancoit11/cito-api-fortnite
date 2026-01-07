/**
 * Epic Games API Endpoints
 * Source: https://github.com/LeleDerGrasshalmi/FortniteEndpointsDocumentation
 */

export const EPIC_ENDPOINTS = {
  // Base URLs
  ACCOUNT_SERVICE: 'https://account-public-service-prod.ol.epicgames.com',
  FORTNITE_SERVICE: 'https://fortnite-public-service-prod11.ol.epicgames.com',
  STATS_PROXY: 'https://statsproxy-public-service-live.ol.epicgames.com',
  EVENTS_SERVICE: 'https://events-public-service-live.ol.epicgames.com',
  FRIENDS_SERVICE: 'https://friends-public-service-prod.ol.epicgames.com',

  // OAuth / Authentication
  OAUTH_TOKEN: '/account/api/oauth/token',
  OAUTH_EXCHANGE: '/account/api/oauth/exchange',
  OAUTH_VERIFY: '/account/api/oauth/verify',
  OAUTH_SESSION_KILL: '/account/api/oauth/sessions/kill',

  // Account Management
  ACCOUNT_CREATE: '/account/api/public/account',
  ACCOUNT_BY_ID: (accountId: string) => `/account/api/public/account/${accountId}`,
  ACCOUNT_UPDATE: (accountId: string) => `/account/api/public/account/${accountId}`,
  ACCOUNT_DEVICE_AUTH: (accountId: string) =>
    `/account/api/public/account/${accountId}/deviceAuth`,
  ACCOUNT_EXTERNAL_AUTHS: (accountId: string) =>
    `/account/api/public/account/${accountId}/externalAuths`,
  ACCOUNT_LOOKUP: (username: string) =>
    `/account/api/public/account/displayName/${username}`,

  // Fortnite Game Service
  PROFILE_COMMAND: (accountId: string, command: string) =>
    `/fortnite/api/game/v2/profile/${accountId}/client/${command}`,
  PROFILE_PRIVACY: (accountId: string) => `/fortnite/api/game/v2/privacy/account/${accountId}`,

  // Store & Catalog
  STOREFRONT_CATALOG: '/fortnite/api/storefront/v2/catalog',

  // Timeline & Events
  CALENDAR_TIMELINE: '/fortnite/api/calendar/v1/timeline',

  // Cloud Storage
  CLOUD_STORAGE: (accountId: string) => `/fortnite/api/cloudstorage/user/${accountId}`,

  // Battle Royale Inventory
  BR_INVENTORY: (accountId: string) =>
    `/fortnite/api/game/v2/br-inventory/account/${accountId}`,

  // Stats
  STATS_BY_ACCOUNT: (accountId: string) => `/statsproxy/api/statsv2/account/${accountId}`,
  STATS_LEADERBOARD: '/statsproxy/api/statsv2/leaderboards',

  // Competitive Events
  EVENTS_TOURNAMENTS: '/fortnite/api/game/v2/events/v2/setTrack',
  EVENTS_WINDOWS: (eventId: string) => `/api/v1/events/Fortnite/${eventId}/windows`,
  EVENTS_LEADERBOARD: (eventId: string, windowId: string, page: number) =>
    `/api/v1/leaderboards/Fortnite/${eventId}/${windowId}/${page}`,
  EVENTS_PLAYER_HISTORY: (accountId: string) =>
    `/api/v1/events/Fortnite/history/${accountId}`,

  // Friends
  FRIENDS_LIST: (accountId: string) => `/friends/api/v1/${accountId}/friends`,
  FRIENDS_ADD: (accountId: string, friendId: string) =>
    `/friends/api/v1/${accountId}/friends/${friendId}`,
  FRIENDS_BLOCKLIST: (accountId: string, blockedId: string) =>
    `/friends/api/v1/${accountId}/blocklist/${blockedId}`,
  FRIENDS_RECENT: (accountId: string, namespace: string) =>
    `/friends/api/v1/${accountId}/recent/${namespace}`,
} as const;

/**
 * Epic OAuth Client Credentials (Public - well-known Epic client credentials)
 */
export const EPIC_CLIENT_CREDENTIALS = {
  // Epic Games Launcher - used for initial login/auth code
  LAUNCHER_CLIENT_ID: 'ec684b8c687f479fadea3cb2ad83f5c6',
  LAUNCHER_CLIENT_SECRET: 'e1f31c211f28413186262d37a13fc84d',
  LAUNCHER_BASIC_AUTH: 'basic ZWM2ODRiOGM2ODdmNDc5ZmFkZWEzY2IyYWQ4M2Y1YzY6ZTFmMzFjMjExZjI4NDEzMTg2MjYyZDM3YTEzZmM4NGQ=',

  // Fortnite iOS - has device auth permissions
  FORTNITE_IOS_CLIENT_ID: '3446cd72694c4a4485d81b77adbb2141',
  FORTNITE_IOS_CLIENT_SECRET: '9209d4a5e25a457fb9b07489d313b41a',
  FORTNITE_IOS_BASIC_AUTH: 'basic MzQ0NmNkNzI2OTRjNGE0NDg1ZDgxYjc3YWRiYjIxNDE6OTIwOWQ0YTVlMjVhNDU3ZmI5YjA3NDg5ZDMxM2I0MWE=',

  // Fortnite Android - has device auth permissions
  FORTNITE_ANDROID_CLIENT_ID: '3f69e56c7649492c8cc29f1af08a8a12',
  FORTNITE_ANDROID_CLIENT_SECRET: 'b51ee9cb12234f50a69efa67ef53812e',
  FORTNITE_ANDROID_BASIC_AUTH: 'basic M2Y2OWU1NmM3NjQ5NDkyYzhjYzI5ZjFhZjA4YThhMTI6YjUxZWU5Y2IxMjIzNGY1MGE2OWVmYTY3ZWY1MzgxMmU=',
} as const;

/**
 * Epic OAuth Grant Types
 */
export const GRANT_TYPES = {
  CLIENT_CREDENTIALS: 'client_credentials',
  PASSWORD: 'password',
  DEVICE_AUTH: 'device_auth',
  EXCHANGE_CODE: 'exchange_code',
  REFRESH_TOKEN: 'refresh_token',
  AUTHORIZATION_CODE: 'authorization_code',
} as const;

/**
 * Epic OAuth Scopes
 */
export const SCOPES = {
  BASIC_PROFILE: 'basic_profile',
  FRIENDS_LIST: 'friends_list',
  PRESENCE: 'presence',
} as const;
