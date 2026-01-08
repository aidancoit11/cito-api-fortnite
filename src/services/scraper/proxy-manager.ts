/**
 * Proxy Manager with Rate Limit Detection
 * Handles rotating proxies and automatic backoff when rate limited
 */

import axios, { type AxiosRequestConfig } from 'axios';

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

interface ProxyState {
  proxy: ProxyConfig;
  failures: number;
  lastUsed: number;
  rateLimitedUntil: number;
}

class ProxyManager {
  private proxies: ProxyState[] = [];
  private currentIndex = 0;
  private defaultHeaders = {
    'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // Rate limit settings
  private baseDelay = 200; // ms between requests
  private maxRetries = 3;
  private rateLimitBackoff = 60000; // 1 minute backoff on rate limit

  /**
   * Load proxies from environment variable or config
   * Format: host:port:user:pass,host:port:user:pass,...
   */
  loadProxies(proxyString?: string): void {
    const proxiesEnv = proxyString || process.env.PROXY_LIST || '';

    if (!proxiesEnv) {
      console.log('⚠️  No proxies configured - using direct connection');
      return;
    }

    const proxyList = proxiesEnv.split(',').filter(p => p.trim());

    for (const proxyStr of proxyList) {
      const parts = proxyStr.trim().split(':');
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const proxy: ProxyConfig = {
          host: parts[0],
          port: parseInt(parts[1], 10),
          username: parts[2] || undefined,
          password: parts[3] || undefined,
        };
        this.proxies.push({
          proxy,
          failures: 0,
          lastUsed: 0,
          rateLimitedUntil: 0,
        });
      }
    }

    console.log(`✅ Loaded ${this.proxies.length} proxies`);
  }

  /**
   * Get the next available proxy (round-robin with rate limit awareness)
   */
  private getNextProxy(): ProxyState | null {
    if (this.proxies.length === 0) return null;

    const now = Date.now();
    let attempts = 0;

    while (attempts < this.proxies.length) {
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      const state = this.proxies[this.currentIndex]!;

      // Skip if rate limited
      if (state.rateLimitedUntil > now) {
        attempts++;
        continue;
      }

      // Skip if too many failures
      if (state.failures >= 5) {
        attempts++;
        continue;
      }

      return state;
    }

    // All proxies rate limited - return the one that will be available soonest
    return this.proxies.reduce((min, p) =>
      p.rateLimitedUntil < min.rateLimitedUntil ? p : min
    ) ?? null;
  }

  /**
   * Create axios config with proxy
   */
  private getAxiosConfig(proxyState: ProxyState | null): AxiosRequestConfig {
    const config: AxiosRequestConfig = {
      headers: this.defaultHeaders,
      timeout: 15000,
    };

    if (proxyState) {
      const { proxy } = proxyState;
      config.proxy = {
        host: proxy.host,
        port: proxy.port,
        auth: proxy.username && proxy.password ? {
          username: proxy.username,
          password: proxy.password,
        } : undefined,
      };
    }

    return config;
  }

  /**
   * Check if response indicates rate limiting
   */
  private isRateLimited(status: number, data?: string): boolean {
    if (status === 429) return true;
    if (status === 503) return true;
    if (status === 403 && data?.includes('rate limit')) return true;
    return false;
  }

  /**
   * Make a request with automatic proxy rotation and retry
   */
  async fetch(url: string, retries = 0): Promise<string> {
    const proxyState = this.getNextProxy();

    // Wait if all proxies are rate limited
    if (proxyState && proxyState.rateLimitedUntil > Date.now()) {
      const waitTime = proxyState.rateLimitedUntil - Date.now();
      console.log(`⏳ All proxies rate limited, waiting ${Math.round(waitTime/1000)}s...`);
      await this.sleep(waitTime);
    }

    // Base delay between requests
    await this.sleep(this.baseDelay);

    try {
      const config = this.getAxiosConfig(proxyState);
      const response = await axios.get(url, config);

      // Success - reset failure count
      if (proxyState) {
        proxyState.failures = 0;
        proxyState.lastUsed = Date.now();
      }

      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      const data = error.response?.data;

      // Handle rate limiting
      if (this.isRateLimited(status, data)) {
        console.log(`🚫 Rate limited on ${proxyState ? 'proxy' : 'direct'} - backing off`);

        if (proxyState) {
          proxyState.rateLimitedUntil = Date.now() + this.rateLimitBackoff;
          proxyState.failures++;
        } else {
          // No proxies - just wait
          await this.sleep(this.rateLimitBackoff);
        }

        // Retry with different proxy
        if (retries < this.maxRetries) {
          return this.fetch(url, retries + 1);
        }
      }

      // Handle other errors
      if (proxyState) {
        proxyState.failures++;
      }

      // Retry on transient errors
      if (retries < this.maxRetries && (status >= 500 || !status)) {
        await this.sleep(1000 * (retries + 1));
        return this.fetch(url, retries + 1);
      }

      throw error;
    }
  }

  /**
   * Get stats about proxy health
   */
  getStats(): { total: number; healthy: number; rateLimited: number } {
    const now = Date.now();
    return {
      total: this.proxies.length,
      healthy: this.proxies.filter(p => p.failures < 5 && p.rateLimitedUntil <= now).length,
      rateLimited: this.proxies.filter(p => p.rateLimitedUntil > now).length,
    };
  }

  /**
   * Set delay between requests
   */
  setDelay(ms: number): void {
    this.baseDelay = ms;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const proxyManager = new ProxyManager();

// Initialize from environment on import
proxyManager.loadProxies();
