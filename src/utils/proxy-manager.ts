import { HttpsProxyAgent } from 'https-proxy-agent';

interface Proxy {
  host: string;
  port: number;
  username: string;
  password: string;
  url: string;
  agent: HttpsProxyAgent<string>;
}

/**
 * Proxy Manager
 * Rotates through a pool of residential proxies for web scraping
 */
class ProxyManager {
  private proxies: Proxy[] = [];
  private currentIndex = 0;
  private enabled = false;

  constructor() {
    this.loadProxies();
  }

  /**
   * Load proxies from environment or hardcoded list
   */
  private loadProxies(): void {
    // Proxy list in format: ip:port:username:password
    const proxyList = process.env.PROXY_LIST || `
9.142.15.182:6338:jejyhmci:6ofmnf6phybb
138.226.77.69:7258:jejyhmci:6ofmnf6phybb
195.40.129.167:6888:jejyhmci:6ofmnf6phybb
195.40.132.67:6288:jejyhmci:6ofmnf6phybb
104.253.199.68:5347:jejyhmci:6ofmnf6phybb
82.23.97.175:7901:jejyhmci:6ofmnf6phybb
9.142.41.143:6313:jejyhmci:6ofmnf6phybb
104.243.210.113:5761:jejyhmci:6ofmnf6phybb
138.226.77.93:7282:jejyhmci:6ofmnf6phybb
192.53.138.242:6180:jejyhmci:6ofmnf6phybb
46.203.91.60:5558:jejyhmci:6ofmnf6phybb
82.29.47.25:7749:jejyhmci:6ofmnf6phybb
104.253.111.198:5976:jejyhmci:6ofmnf6phybb
96.62.181.242:7454:jejyhmci:6ofmnf6phybb
45.56.179.95:9299:jejyhmci:6ofmnf6phybb
216.170.122.120:6158:jejyhmci:6ofmnf6phybb
209.166.16.225:6886:jejyhmci:6ofmnf6phybb
46.203.20.215:6716:jejyhmci:6ofmnf6phybb
138.226.70.47:7737:jejyhmci:6ofmnf6phybb
82.21.11.89:6349:jejyhmci:6ofmnf6phybb
82.26.107.217:7428:jejyhmci:6ofmnf6phybb
147.79.5.9:7722:jejyhmci:6ofmnf6phybb
82.23.102.74:7301:jejyhmci:6ofmnf6phybb
216.98.254.162:6472:jejyhmci:6ofmnf6phybb
45.56.179.251:9455:jejyhmci:6ofmnf6phybb
9.142.43.75:5245:jejyhmci:6ofmnf6phybb
63.246.153.225:5894:jejyhmci:6ofmnf6phybb
192.46.203.83:6049:jejyhmci:6ofmnf6phybb
82.21.11.39:6299:jejyhmci:6ofmnf6phybb
82.23.57.153:7407:jejyhmci:6ofmnf6phybb
9.142.42.118:5788:jejyhmci:6ofmnf6phybb
31.98.14.239:5916:jejyhmci:6ofmnf6phybb
45.248.55.183:6769:jejyhmci:6ofmnf6phybb
209.166.2.199:7860:jejyhmci:6ofmnf6phybb
140.233.170.226:7938:jejyhmci:6ofmnf6phybb
103.210.12.53:5981:jejyhmci:6ofmnf6phybb
5.59.250.15:6713:jejyhmci:6ofmnf6phybb
9.142.9.58:5215:jejyhmci:6ofmnf6phybb
45.39.157.208:9240:jejyhmci:6ofmnf6phybb
9.142.35.46:6217:jejyhmci:6ofmnf6phybb
72.1.136.108:6999:jejyhmci:6ofmnf6phybb
159.148.239.198:6750:jejyhmci:6ofmnf6phybb
46.203.47.223:5722:jejyhmci:6ofmnf6phybb
138.226.88.147:7835:jejyhmci:6ofmnf6phybb
140.233.169.230:7947:jejyhmci:6ofmnf6phybb
45.56.137.196:9261:jejyhmci:6ofmnf6phybb
46.203.20.66:6567:jejyhmci:6ofmnf6phybb
72.46.138.203:6429:jejyhmci:6ofmnf6phybb
138.226.65.192:7383:jejyhmci:6ofmnf6phybb
9.142.23.220:6377:jejyhmci:6ofmnf6phybb
    `.trim();

    const lines = proxyList.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length === 4) {
        const host = parts[0]!;
        const portStr = parts[1]!;
        const username = parts[2]!;
        const password = parts[3]!;
        const port = parseInt(portStr, 10);
        const url = `http://${username}:${password}@${host}:${port}`;

        this.proxies.push({
          host,
          port,
          username,
          password,
          url,
          agent: new HttpsProxyAgent(url),
        });
      }
    }

    this.enabled = this.proxies.length > 0;

    if (this.enabled) {
      console.log(`[ProxyManager] Loaded ${this.proxies.length} proxies`);
    } else {
      console.log('[ProxyManager] No proxies loaded, requests will use direct connection');
    }
  }

  /**
   * Check if proxies are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the next proxy in rotation
   */
  getNextProxy(): Proxy | null {
    if (!this.enabled || this.proxies.length === 0) {
      return null;
    }

    const proxy = this.proxies[this.currentIndex]!;
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
  }

  /**
   * Get a random proxy
   */
  getRandomProxy(): Proxy | null {
    if (!this.enabled || this.proxies.length === 0) {
      return null;
    }

    const index = Math.floor(Math.random() * this.proxies.length);
    return this.proxies[index] ?? null;
  }

  /**
   * Get proxy agent for axios/fetch requests
   */
  getAgent(): HttpsProxyAgent<string> | undefined {
    const proxy = this.getNextProxy();
    return proxy?.agent;
  }

  /**
   * Get axios config with proxy
   */
  getAxiosConfig(): { httpsAgent?: HttpsProxyAgent<string>; httpAgent?: HttpsProxyAgent<string> } {
    const agent = this.getAgent();
    if (!agent) {
      return {};
    }
    return {
      httpsAgent: agent,
      httpAgent: agent,
    };
  }

  /**
   * Get proxy count
   */
  getProxyCount(): number {
    return this.proxies.length;
  }

  /**
   * Disable proxies (for testing or fallback)
   */
  disable(): void {
    this.enabled = false;
    console.log('[ProxyManager] Proxies disabled');
  }

  /**
   * Enable proxies
   */
  enable(): void {
    if (this.proxies.length > 0) {
      this.enabled = true;
      console.log('[ProxyManager] Proxies enabled');
    }
  }
}

// Export singleton instance
export const proxyManager = new ProxyManager();
