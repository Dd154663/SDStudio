import { backend } from '.';
import { sleep } from './util';

const UPDATE_SERVICE_INTERVAL = 240 * 1000;
const DISMISSED_VERSION_KEY = 'sdstudio-update-dismissed-version';

export class AppUpdateNoticeService extends EventTarget {
  current: string;
  outdated: boolean;
  latestVersion: string;
  notifiedVersion: string;
  constructor() {
    super();
    this.current = '';
    this.latestVersion = '';
    this.notifiedVersion = '';
    this.outdated = false;
    this.run();
  }
  async getLatestRelease(repoOwner: string, repoName: string) {
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error(`Error fetching release: ${response.statusText}`);
      }

      const data = await response.json();
      return data.tag_name;
    } catch (error) {
      console.error('Failed to fetch latest release:', error);
    }
  }

  isDismissed(version: string): boolean {
    try {
      return localStorage.getItem(DISMISSED_VERSION_KEY) === version;
    } catch {
      return false;
    }
  }

  dismissVersion(version: string) {
    try {
      localStorage.setItem(DISMISSED_VERSION_KEY, version);
    } catch {}
  }

  async checkForUpdate(): Promise<{ outdated: boolean; latest: string }> {
    if (this.current === '') this.current = await backend.getVersion();
    const latest = (await this.getLatestRelease('Dd154663', 'SDStudio') ?? '').replace(/^v/, '');
    const outdated = this.isOutdated(this.current, latest);
    this.latestVersion = latest;
    this.outdated = outdated;
    return { outdated, latest };
  }

  async run() {
    while (true) {
      try {
        const { outdated, latest } = await this.checkForUpdate();
        if (outdated && !this.isDismissed(latest) && this.notifiedVersion !== latest) {
          this.notifiedVersion = latest;
          this.dispatchEvent(new CustomEvent('updated', { detail: {} }));
        }
      } catch (e: any) {
        console.error(e);
      }
      await sleep(UPDATE_SERVICE_INTERVAL);
    }
  }

  isOutdated(current: string, latest: string): boolean {
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);

    for (
      let i = 0;
      i < Math.max(currentParts.length, latestParts.length);
      i++
    ) {
      const currentPart = currentParts[i] || 0;
      const latestPart = latestParts[i] || 0;

      if (currentPart < latestPart) {
        return true;
      } else if (currentPart > latestPart) {
        return false;
      }
    }

    return false; // they are equal
  }
}
