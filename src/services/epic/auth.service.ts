import axios, { AxiosError } from 'axios';
import { config } from '../../config/index.js';
import { EPIC_ENDPOINTS, EPIC_CLIENT_CREDENTIALS, GRANT_TYPES } from '../../config/endpoints.js';

/**
 * Epic Games Authentication Service
 * Handles all OAuth operations including device auth and token management
 */

export interface DeviceAuthResponse {
  deviceId: string;
  accountId: string;
  secret: string;
  userAgent: string;
  created: {
    location: string;
    ipAddress: string;
    dateTime: string;
  };
}

export interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  expires_at: string;
  token_type: string;
  refresh_token?: string;
  refresh_expires?: number;
  refresh_expires_at?: string;
  account_id: string;
  client_id: string;
  internal_client: boolean;
  client_service: string;
  displayName?: string;
  app: string;
  in_app_id: string;
  device_id?: string;
}

export interface AccountLookupResponse {
  id: string;
  displayName: string;
  externalAuths: Array<{
    accountId: string;
    type: string;
    externalAuthId: string;
    externalDisplayName?: string;
    authIds?: Array<{
      id: string;
      type: string;
    }>;
    dateAdded?: string;
  }>;
}

class EpicAuthService {
  private baseUrl = EPIC_ENDPOINTS.ACCOUNT_SERVICE;

  /**
   * Step 1: Get access token using email/password
   * This is used ONCE to generate device auth credentials
   */
  async getAccessTokenWithPassword(
    email: string,
    password: string
  ): Promise<OAuthTokenResponse> {
    try {
      const response = await axios.post<OAuthTokenResponse>(
        `${this.baseUrl}${EPIC_ENDPOINTS.OAUTH_TOKEN}`,
        new URLSearchParams({
          grant_type: GRANT_TYPES.PASSWORD,
          username: email,
          password: password,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: EPIC_CLIENT_CREDENTIALS.LAUNCHER_BASIC_AUTH,
          },
        }
      );

      return response.data;
    } catch (error) {
      this.handleAuthError(error, 'Failed to get access token with password');
      throw error;
    }
  }

  /**
   * Step 2: Generate device auth credentials
   * This creates a device_id and secret that can be used for future logins
   */
  async generateDeviceAuth(accessToken: string, accountId: string): Promise<DeviceAuthResponse> {
    try {
      const response = await axios.post<DeviceAuthResponse>(
        `${this.baseUrl}${EPIC_ENDPOINTS.ACCOUNT_DEVICE_AUTH(accountId)}`,
        {},
        {
          headers: {
            Authorization: `bearer ${accessToken}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      this.handleAuthError(error, 'Failed to generate device auth');
      throw error;
    }
  }

  /**
   * Step 3: Get access token using device auth
   * This is the main method used for authentication after device auth is set up
   * Uses Fortnite Android client which has device auth permissions
   */
  async getAccessTokenWithDeviceAuth(
    deviceId: string,
    accountId: string,
    secret: string
  ): Promise<OAuthTokenResponse> {
    try {
      const response = await axios.post<OAuthTokenResponse>(
        `${this.baseUrl}${EPIC_ENDPOINTS.OAUTH_TOKEN}`,
        new URLSearchParams({
          grant_type: GRANT_TYPES.DEVICE_AUTH,
          device_id: deviceId,
          account_id: accountId,
          secret: secret,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: EPIC_CLIENT_CREDENTIALS.FORTNITE_ANDROID_BASIC_AUTH,
          },
        }
      );

      return response.data;
    } catch (error) {
      this.handleAuthError(error, 'Failed to get access token with device auth');
      throw error;
    }
  }

  /**
   * Refresh an access token using a refresh token
   * Uses Fortnite Android client for consistency with device auth
   */
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
    try {
      const response = await axios.post<OAuthTokenResponse>(
        `${this.baseUrl}${EPIC_ENDPOINTS.OAUTH_TOKEN}`,
        new URLSearchParams({
          grant_type: GRANT_TYPES.REFRESH_TOKEN,
          refresh_token: refreshToken,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: EPIC_CLIENT_CREDENTIALS.FORTNITE_ANDROID_BASIC_AUTH,
          },
        }
      );

      return response.data;
    } catch (error) {
      this.handleAuthError(error, 'Failed to refresh access token');
      throw error;
    }
  }

  /**
   * Verify an access token is still valid
   */
  async verifyToken(accessToken: string): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}${EPIC_ENDPOINTS.OAUTH_VERIFY}`, {
        headers: {
          Authorization: `bearer ${accessToken}`,
        },
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Lookup account by username
   */
  async lookupAccountByUsername(
    username: string,
    accessToken: string
  ): Promise<AccountLookupResponse> {
    try {
      const response = await axios.get<AccountLookupResponse>(
        `${this.baseUrl}${EPIC_ENDPOINTS.ACCOUNT_LOOKUP(username)}`,
        {
          headers: {
            Authorization: `bearer ${accessToken}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      this.handleAuthError(error, `Failed to lookup account for username: ${username}`);
      throw error;
    }
  }

  /**
   * Get account info by account ID
   */
  async getAccountById(accountId: string, accessToken: string): Promise<AccountLookupResponse> {
    try {
      const response = await axios.get<AccountLookupResponse>(
        `${this.baseUrl}${EPIC_ENDPOINTS.ACCOUNT_BY_ID(accountId)}`,
        {
          headers: {
            Authorization: `bearer ${accessToken}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      this.handleAuthError(error, `Failed to get account by ID: ${accountId}`);
      throw error;
    }
  }

  /**
   * Kill all sessions for an account (logout)
   */
  async killSessions(accessToken: string): Promise<void> {
    try {
      await axios.delete(`${this.baseUrl}${EPIC_ENDPOINTS.OAUTH_SESSION_KILL}`, {
        headers: {
          Authorization: `bearer ${accessToken}`,
        },
      });
    } catch (error) {
      this.handleAuthError(error, 'Failed to kill sessions');
      throw error;
    }
  }

  /**
   * Handle authentication errors with proper logging
   */
  private handleAuthError(error: unknown, message: string): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error(`${message}:`, {
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        data: axiosError.response?.data,
        message: axiosError.message,
      });
    } else {
      console.error(`${message}:`, error);
    }
  }
}

export const epicAuthService = new EpicAuthService();
