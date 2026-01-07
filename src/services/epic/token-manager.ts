import { config } from '../../config/index.js';
import { epicAuthService, OAuthTokenResponse } from './auth.service.js';

/**
 * Token Manager Service
 * Singleton that manages Epic Games OAuth tokens with auto-refresh
 *
 * Usage:
 *   const token = await tokenManager.getToken();
 *   // Use token for Epic API requests
 */

interface TokenState {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  refreshExpiresAt: Date | null;
  accountId: string;
}

class TokenManager {
  private tokenState: TokenState | null = null;
  private refreshPromise: Promise<string> | null = null;
  private initialized = false;

  // Refresh token 5 minutes before expiration
  private readonly REFRESH_BUFFER_MS = 5 * 60 * 1000;

  /**
   * Initialize the token manager with device auth credentials
   * Call this once at app startup
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('⚡ Token manager already initialized');
      return;
    }

    const { deviceId, accountId, deviceSecret } = config.epic;

    if (!deviceId || !accountId || !deviceSecret) {
      console.warn(
        '⚠️  Device auth credentials not configured. Run "npm run generate-auth" first.'
      );
      return;
    }

    console.log('🔐 Initializing token manager...');

    try {
      await this.refreshWithDeviceAuth();
      this.initialized = true;
      console.log('✅ Token manager initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize token manager:', error);
      throw error;
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
        throw new Error('No valid token available. Device auth not configured.');
      }
    }

    // Check if token needs refresh
    const now = new Date();
    const expiresAt = new Date(this.tokenState.expiresAt.getTime() - this.REFRESH_BUFFER_MS);

    if (now >= expiresAt) {
      console.log('🔄 Token expired or expiring soon, refreshing...');
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
          console.log('🔄 Refreshing token using refresh_token...');
          const response = await epicAuthService.refreshAccessToken(
            this.tokenState.refreshToken
          );
          this.updateTokenState(response);
          console.log('✅ Token refreshed via refresh_token');
          return this.tokenState!.accessToken;
        } catch (error) {
          console.warn('⚠️  Refresh token failed, falling back to device auth');
        }
      }
    }

    // Fallback to device auth
    return this.refreshWithDeviceAuth();
  }

  /**
   * Refresh using device auth credentials
   */
  private async refreshWithDeviceAuth(): Promise<string> {
    const { deviceId, accountId, deviceSecret } = config.epic;

    if (!deviceId || !accountId || !deviceSecret) {
      throw new Error('Device auth credentials not configured');
    }

    console.log('🔐 Getting token with device auth...');

    const response = await epicAuthService.getAccessTokenWithDeviceAuth(
      deviceId,
      accountId,
      deviceSecret
    );

    this.updateTokenState(response);
    console.log('✅ Token obtained via device auth');

    return this.tokenState!.accessToken;
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
    console.log(`📋 Token expires in ${expiresInMinutes} minutes`);
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
        console.warn('Failed to kill session:', error);
      }
    }

    this.tokenState = null;
    this.initialized = false;
    console.log('🔒 Logged out and cleared token');
  }
}

// Export singleton instance
export const tokenManager = new TokenManager();
