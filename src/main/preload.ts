// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels =
  | 'write-file'
  | 'read-file'
  | 'delete-file'
  | 'image-gen'
  | 'inpaint-image'
  | 'list-files'
  | 'prompt'
  | 'login'
  | 'rename-file'
  | 'rename-dir'
  | 'write-data-file'
  | 'read-data-file'
  | 'read-global-file'
  | 'write-global-file'
  | 'copy-file'
  | 'copy-file-absolute'
  | 'convert-to-webp'
  | 'close'
  | 'restart-app'
  | 'show-file'
  | 'publish-export'
  | 'open-path'
  | 'zip-files'
  | 'get-free-space'
  | 'get-runtime-diag'
  | 'get-boot-warnings'
  | 'get-data-root'
  | 'backup-failed-config'
  | 'check-writable'
  | 'get-version'
  | 'open-web-page'
  | 'search-tags'
  | 'load-pieces-db'
  | 'get-config'
  | 'set-config'
  | 'search-pieces'
  | 'trash-file'
  | 'delete-dir'
  | 'spawn-local-ai'
  | 'is-local-ai-running'
  | 'resize-image'
  | 'exist-file'
  | 'open-image-editor'
  | 'watch-image'
  | 'unwatch-image'
  | 'load-model'
  | 'extract-zip'
  | 'download'
  | 'remove-bg'
  | 'select-dir'
  | 'unzip-files'
  | 'select-file'
  | 'select-files'
  | 'read-binary-file'
  | 'get-remain-credits'
  | 'copy-image-to-clipboard'
  | 'lookup-tag'
  | 'write-data-file-absolute'
  | 'list-files-with-stats'
  | 'exist-file-absolute'
  | 'artist-analyze'
  | 'window-minimize'
  | 'window-maximize'
  | 'window-close'
  | 'window-is-maximized'
  | 'open-new-window'
  | 'project-lock-acquire'
  | 'project-lock-release'
  | 'project-lock-query'
  | 'project-lock-focus-owner'
  | 'lock-owner-notice'
  | 'take-initial-project'
  | 'notify-global-store-changed'
  | 'global-store-changed'
  | 'is-generation-host'
  | 'generation-host-changed'
  | 'generation-peer-count'
  | 'delegate-task'
  | 'delegate-cancel'
  | 'delegate-run'
  | 'delegate-stop'
  | 'delegate-complete'
  | 'delegate-queue-snapshot'
  | 'notify-session-op'
  | 'session-op';

const electronHandler = {
  ipcRenderer: {
    on(channel: string, func: (...args: any[]) => void | Promise<void>) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
    invoke(channel: Channels, ...args: unknown[]) {
      return ipcRenderer.invoke(channel, ...args);
    },
    onClose(func: () => void) {
      ipcRenderer.on('close', func);
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
