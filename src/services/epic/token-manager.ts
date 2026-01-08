import { config } from '../../config/index.js';
import { epicAuthService, OAuthTokenResponse } from './auth.service.js';
import { prisma } from '../../db/client.js';

/**
 * Token Manager Service
 * Singleton that manages Epic Games OAuth tokens with auto-refresh
 *
 * Features:
 * - Auto-refresh tokens before expiration
 * - Database fallback for device auth credentials
 * - Detailed error logging
 * - Graceful degradation
 */

interface TokenState {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  refreshExpiresAt: Date | null;
  accountId: string;
}

interface DeviceAuthCredentials {
  deviceId: string;
  accountId: string;
  deviceSecret: string;
  source: 'env' | 'database';
}

class TokenManager {
  private tokenState: TokenState | null = null;
  private refreshPromise: Promise<string> | null = null;
  private initialized = false;
  private lastError: string | null = null;

  // Refresh token 5 minutes before expiration
  private readonly REFRESH_BUFFER_MS = 5 * 60 * 1000;

  /**
   * Initialize the token manager with device auth credentials
   * Tries .env first, then falls back to database
   */
  async initialize(): Promise<void> {
    if (this.initialized && this.tokenState) {
      console.log('[TokenManager] Already initialized with valid token');
      return;
    }

    console.log('[TokenManager] Initializing...');

    // Try to get credentials (env first, then database)
    const credentials = await this.getDeviceAuthCredentials();

    if (!credentials) {
      this.lastError = 'No device auth credentials found in .env or database';
      console.warn(`[TokenManager] ${this.lastError}`);
      console.warn('[TokenManager] Run "npm run generate-auth" to generate device auth credentials');
      return;
    }

    console.log(`[TokenManager] Using credentials from ${credentials.source}`);
    console.log(`[TokenManager] Account ID: ${credentials.accountId}`);

    try {
      await this.refreshWithDeviceAuth(credentials);
      this.initialized = true;
      this.lastError = null;
      console.log('[TokenManager] Initialized successfully');

      // Update last used timestamp in database
      if (credentials.source === 'database') {
        await this.updateCredentialLastUsed(credentials.accountId);
      }
    } catch (error: any) {
      this.lastError = `Failed to initialize: ${error.message}`;
      console.error(`[TokenManager] ${this.lastError}`);

      // If env credentials failed, try database
      if (credentials.source === 'env') {
        console.log('[TokenManager] Trying database credentials as fallback...');
        const dbCredentials = await this.getDeviceAuthFromDatabase();
        if (dbCredentials && dbCredentials.accountId !== credentials.accountId) {
          try {
            await this.refreshWithDeviceAuth(dbCredentials);
            this.initialized = true;
            this.lastError = null;
            console.log('[TokenManager] Initialized with database credentials');
            await this.updateCredentialLastUsed(dbCredentials.accountId);
          } catch (dbError: any) {
            this.lastError = `Both env and database credentials failed: ${dbError.message}`;
            console.error(`[TokenManager] ${this.lastError}`);
          }
        }
      }
    }
  }

  /**
   * Get device auth credentials - tries env first, then database
   */
  private async getDeviceAuthCredentials(): Promise<DeviceAuthCredentials | null> {
    // First try environment variables
    const { deviceId, accountId, deviceSecret } = config.epic;

    if (deviceId && accountId && deviceSecret) {
      return {
        deviceId,
        accountId,
        deviceSecret,
        source: 'env',
      };
    }

    // Fallback to database
    return this.getDeviceAuthFromDatabase();
  }

  /**
   * Get device auth credentials from database
   */
  private async getDeviceAuthFromDatabase(): Promise<DeviceAuthCredentials | null> {
    try {
      const credential = await prisma.deviceAuthCredential.findFirst({
        where: { isActive: true },
        orderBy: { lastUsed: 'desc' },
      });

      if (credential) {
        return {
          deviceId: credential.deviceId,
          accountId: credential.accountId,
          deviceSecret: credential.deviceSecret,
          source: 'database',
        };
      }
    } catch (error: any) {
      console.error('[TokenManager] Failed to query database for credentials:', error.message);
    }

    return null;
  }

  /**
   * Update last used timestamp for credentials
   */
  private async updateCredentialLastUsed(accountId: string): Promise<void> {
    try {
      await prisma.deviceAuthCredential.update({
        where: { accountId },
        data: { lastUsed: new Date(), updatedAt: new Date() },
      });
    } catch (error) {
      // Ignore - credential might not exist in database
    }
  }

  /**
   * Save device auth credentials to database
   */
  async saveDeviceAuthToDatabase(
    deviceId: string,
    accountId: string,
    deviceSecret: string,
    displayName?: string
  ): Promise<void> {
    try {
      await prisma.deviceAuthCredential.upsert({
        where: { accountId },
        create: {
          deviceId,
          accountId,
          deviceSecret,
          displayName,
          isActive: true,
          lastUsed: new Date(),
        },
        update: {
          deviceId,
          deviceSecret,
          displayName,
          isActive: true,
          lastUsed: new Date(),
          updatedAt: new Date(),
        },
      });
      console.log('[TokenManager] Device auth credentials saved to database');
    } catch (error: any) {
      console.error('[TokenManager] Failed to save credentials to database:', error.message);
    }
  }

  /**
   * Get a valid access token
   * Auto-refreshes if token is expired or about to expire
   */
  async getToken(): Promise<string> {
    // If no token exists, try to initialize
    if (!this.tokenState) {
      await this.initialize();
      if (!this.tokenState) {
        throw new Error(`No valid token available. ${this.lastError || 'Device auth not configured.'}`);
      }
    }

    // Check if token needs refresh
    const now = new Date();
    const expiresAt = new Date(this.tokenState.expiresAt.getTime() - this.REFRESH_BUFFER_MS);

    if (now >= expiresAt) {
      console.log('[TokenManager] Token expired or expiring soon, refreshing...');
      return this.refresh();
    }

    return this.tokenState.accessToken;
  }

  /**
   * Get the current account ID
   */
  getAccountId(): string | null {
    return this.tokenState?.accountId || config.epic.accountId || null;
  }

  /**
   * Check if token manager is initialized and has a valid token
   */
  isReady(): boolean {
    return this.initialized && this.tokenState !== null;
  }

  /**
   * Get the last error message
   */
  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Get detailed status information
   */
  getStatus(): {
    initialized: boolean;
    hasToken: boolean;
    accountId: string | null;
    expiresAt: Date | null;
    expiresInMs: number | null;
    lastError: string | null;
  } {
    return {
      initialized: this.initialized,
      hasToken: this.tokenState !== null,
      accountId: this.tokenState?.accountId || null,
      expiresAt: this.tokenState?.expiresAt || null,
      expiresInMs: this.tokenState
        ? Math.max(0, this.tokenState.expiresAt.getTime() - Date.now())
        : null,
      lastError: this.lastError,
    };
  }

  /**
   * Get token expiration info
   */
  getTokenInfo(): { expiresAt: Date; expiresInMs: number } | null {
    if (!this.tokenState) return null;

    const expiresInMs = this.tokenState.expiresAt.getTime() - Date.now();
    return {
      expiresAt: this.tokenState.expiresAt,
      expiresInMs: Math.max(0, expiresInMs),
    };
  }

  /**
   * Force refresh the token
   * Returns the new access token
   */
  async refresh(): Promise<string> {
    // Prevent concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Internal refresh logic
   */
  private async doRefresh(): Promise<string> {
    // Try refresh token first (if available and not expired)
    if (this.tokenState?.refreshToken && this.tokenState.refreshExpiresAt) {
      const now = new Date();
      if (now < this.tokenState.refreshExpiresAt) {
        try {
          console.log('[TokenManager] Refreshing token using refresh_token...');
          const response = await epicAuthService.refreshAccessToken(
            this.tokenState.refreshToken
          );
          this.updateTokenState(response);
          console.log('[TokenManager] Token refreshed via refresh_token');
          return this.tokenState!.accessToken;
        } catch (error: any) {
          console.warn('[TokenManager] Refresh token failed, falling back to device auth:', error.message);
        }
      }
    }

    // Fallback to device auth
    const credentials = await this.getDeviceAuthCredentials();
    if (!credentials) {
      throw new Error('No device auth credentials available for refresh');
    }

    return this.refreshWithDeviceAuth(credentials);
  }

  /**
   * Refresh using device auth credentials
   */
  private async refreshWithDeviceAuth(credentials: DeviceAuthCredentials): Promise<string> {
    console.log('[TokenManager] Getting token with device auth...');
    console.log(`[TokenManager] Device ID: ${credentials.deviceId.substring(0, 8)}...`);
    console.log(`[TokenManager] Account ID: ${credentials.accountId}`);

    try {
      const response = await epicAuthService.getAccessTokenWithDeviceAuth(
        credentials.deviceId,
        credentials.accountId,
        credentials.deviceSecret
      );

      this.updateTokenState(response);
      this.lastError = null;
      console.log('[TokenManager] Token obtained via device auth');

      return this.tokenState!.accessToken;
    } catch (error: any) {
      // Log detailed error information
      console.error('[TokenManager] Device auth failed:');
      console.error(`  Status: ${error.response?.status || 'N/A'}`);
      console.error(`  Message: ${error.message}`);

      if (error.response?.data) {
        console.error(`  Response: ${JSON.stringify(error.response.data)}`);
      }

      // Check for specific error codes
      if (error.response?.status === 400) {
        this.lastError = 'Device auth credentials are invalid or expired. Need to regenerate.';
        console.error('[TokenManager] ' + this.lastError);
        console.error('[TokenManager] Run: npm run generate-auth-manual');
      } else if (error.response?.status === 401) {
        this.lastError = 'Unauthorized - device auth credentials rejected';
        console.error('[TokenManager] ' + this.lastError);
      } else if (error.response?.status === 403) {
        this.lastError = 'Forbidden - account may be banned or locked';
        console.error('[TokenManager] ' + this.lastError);
      }

      throw error;
    }
  }

  /**
   * Update internal token state from OAuth response
   */
  private updateTokenState(response: OAuthTokenResponse): void {
    this.tokenState = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token || null,
      expiresAt: new Date(response.expires_at),
      refreshExpiresAt: response.refresh_expires_at
        ? new Date(response.refresh_expires_at)
        : null,
      accountId: response.account_id,
    };

    const expiresInMinutes = Math.round(
      (this.tokenState.expiresAt.getTime() - Date.now()) / 60000
    );
    console.log(`[TokenManager] Token expires in ${expiresInMinutes} minutes`);
  }

  /**
   * Verify current token is still valid with Epic
   */
  async verifyToken(): Promise<boolean> {
    if (!this.tokenState) return false;

    return epicAuthService.verifyToken(this.tokenState.accessToken);
  }

  /**
   * Clear token state (logout)
   */
  async logout(): Promise<void> {
    if (this.tokenState) {
      try {
        await epicAuthService.killSessions(this.tokenState.accessToken);
      } catch (error) {
        console.warn('[TokenManager] Failed to kill session:', error);
      }
    }

    this.tokenState = null;
    this.initialized = false;
    this.lastError = null;
    console.log('[TokenManager] Logged out and cleared token');
  }

  /**
   * Reset the token manager state (for reinitializing)
   */
  reset(): void {
    this.tokenState = null;
    this.initialized = false;
    this.refreshPromise = null;
    this.lastError = null;
    console.log('[TokenManager] State reset');
  }
}

// Export singleton instance
export const tokenManager = new TokenManager();
