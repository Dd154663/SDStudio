import {
  backend,
  gameService,
  globalCharacterPresetService,
  globalPieceService,
  globalPresetService,
  artistLibraryService,
  imageService,
  isMobile,
  localAIService,
  projectSizeService,
  sessionService,
  taskQueueService,
  trashService,
  workFlowService,
  zipService,
} from '.';
import type { GlobalPresetType, IGlobalPresetEntry } from './GlobalPresetService';
import { SUPPORTED_GLOBAL_PRESET_TYPES } from './GlobalPresetService';
import { Dialog } from '../componenets/ConfirmWindow';
import { cropMirrorResultFromDataUri, dataUriToBase64, deleteImageFiles } from './ImageService';
import {
  createImageWithText,
  embedJSONInPNG,
  importPreset,
  normalizePresetJson,
  readJSONFromPNG,
} from './SessionService';
import { action, observable } from 'mobx';
import {
  CharacterPreset,
  GenericScene,
  InpaintScene,
  ISession,
  isValidPieceLibrary,
  isValidSession,
  isValidNAISPreset,
  extractNAISPieceNames,
  convertNAISToSession,
  Piece,
  PieceLibrary,
  PromptPiece,
  Scene,
  Session,
  genericSceneFromJSON,
} from './types';
import { extractPromptDataFromBase64, getFirstFile } from './util';
import { ImageOptimizeMethod } from '../backend';
import { v4 } from 'uuid';
import { Resolution, resolutionMap } from '../backends/imageGen';
import { ProgressDialog } from '../componenets/ProgressWindow';
import { migratePieceLibrary } from './legacy';
import {
  oneTimeFlowMap,
  oneTimeFlows,
  queueRemoveBg,
} from './workflows/OneTimeFlows';
import { appState } from './AppService';
import type { ExportPreset } from './AppService';

// 전체 백업에 담는 전역 설정 파일. (백업엔 전부 담되, 설정 병합 복원 시
// trash.json / folderOrder.json 은 의도적으로 제외 — 아래 mergeSettingsFromDir 참조)
const FULL_BACKUP_SETTINGS_FILES = [
  'favorites.json',
  'bookmarks.json',
  'thumbnails.json',
  'folderColors.json',
  'folderOrder.json',
  'trash.json',
  'exportPresets.json',
  'global_presets.json',
  'global_pieces.json',
  'global_character_presets.json',
];
// 글로벌 프리셋/캐릭터가 참조하는 이미지 디렉터리 (플랫, 파일만)
const FULL_BACKUP_SETTINGS_IMAGE_DIRS = ['global_vibes', 'global_char_images'];

export class BackupService {
  projectBackupMenu() {
    appState.pushDialog({
      type: 'select',
      text: '메뉴를 선택해주세요',
      items: [
        {
          text: '파일 불러오기',
          value: 'load',
        },
        {
          text: '프로젝트 백업 불러오기',
          value: 'loadDeep',
        },
        {
          text: '📦 폴더 백업 불러오기',
          value: 'loadFolder',
        },
        {
          text: '프로젝트 파일 내보내기 (이미지 미포함)',
          value: 'save',
        },
        {
          text: '프로젝트 백업 내보내기 (이미지 포함)',
          value: 'saveDeep',
        },
        {
          text: '📑 프로젝트 복제',
          value: 'duplicate',
        },
        {
          text: '✏️ 프로젝트 이름 수정',
          value: 'rename',
        },
        {
          text: appState.curSession && sessionService.isFavorite(appState.curSession.name)
            ? '⭐ 즐겨찾기 해제'
            : '⭐ 즐겨찾기 지정',
          value: 'toggleFavorite',
        },
      ],

      callback: async (value) => {
        if (value === 'save') {
          if (appState.curSession) {
            const proj = await sessionService.exportSessionShallow(
              appState.curSession,
            );
            const path = 'exports/' + appState.curSession.name + '.json';
            await backend.writeFile(path, JSON.stringify(proj));
            await backend.showFile(path);
          }
        } else if (value === 'saveDeep') {
          if (appState.curSession) {
            const path = 'exports/' + appState.curSession.name + '.tar';
            if (zipService.isZipping) {
              appState.pushMessage('이미 내보내기 작업이 진행중입니다.');
              return;
            }
            appState.setProgressDialog({
              text: '압축 파일 생성중..',
              done: 0,
              total: 1,
            });
            try {
              await sessionService.exportSessionDeep(appState.curSession, path);
            } catch (e: any) {
              appState.setProgressDialog(undefined);
              return;
            }
            appState.setProgressDialog(undefined);
            appState.pushDialog({
              type: 'yes-only',
              text: '백업이 완료되었습니다.',
            });
            await backend.showFile(path);
            appState.setProgressDialog(undefined);
          }
        } else if (value === 'load') {
          const file = await getFirstFile();
          appState.handleFile(file as any);
        } else if (value === 'loadFolder') {
          await this.folderBackupImport();
        } else if (value === 'duplicate') {
          await this.duplicateProject();
        } else if (value === 'rename') {
          if (!appState.curSession) {
            appState.pushMessage('프로젝트를 먼저 선택해주세요');
            return;
          }
          appState.pushDialog({
            type: 'input-confirm',
            text: '새로운 프로젝트 이름을 입력해주세요',
            callback: async (inputValue) => {
              if (!inputValue) return;
              if (sessionService.list().includes(inputValue)) {
                appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
                return;
              }
              const oldName = appState.curSession!.name;
              await imageService.onRenameSession(oldName, inputValue);
              await sessionService.rename(oldName, inputValue);
              appState.curSession!.name = inputValue;
              appState.pushMessage('프로젝트 이름이 변경되었습니다.');
            },
          });
        } else if (value === 'toggleFavorite') {
          if (!appState.curSession) {
            appState.pushMessage('프로젝트를 먼저 선택해주세요');
            return;
          }
          await sessionService.toggleFavorite(appState.curSession.name);
          const isFav = sessionService.isFavorite(appState.curSession.name);
          appState.pushMessage(isFav ? '즐겨찾기에 추가되었습니다' : '즐겨찾기가 해제되었습니다');
        } else {
          appState.pushDialog({
            type: 'input-confirm',
            text: '새로운 프로젝트 이름을 입력해주세요',
            callback: async (inputValue) => {
              if (inputValue) {
                if (inputValue in sessionService.list()) {
                  appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
                  return;
                }
                const tarPath = await backend.selectFile();
                if (tarPath) {
                  appState.setProgressDialog({
                    text: '프로젝트 백업을 불러오는 중입니다...',
                    done: 0,
                    total: 1,
                  });
                  try {
                    await sessionService.importSessionDeep(tarPath, inputValue);
                  } catch (e: any) {
                    appState.setProgressDialog(undefined);
                    appState.pushMessage(e.message);
                    return;
                  }
                  appState.setProgressDialog(undefined);
                  appState.pushDialog({
                    type: 'yes-only',
                    text: '프로젝트 백업을 불러왔습니다.',
                  });
                  const sess = await sessionService.get(inputValue);
                  appState.curSession = sess;
                }
              }
            },
          });
        }
      },
    });
  }
  // 현재 프로젝트를 앱 내에서 복제한다. (이미지 포함/미포함 2택)
  // 결과적으로 "내보내기 후 재임포트"와 동일하며 기존 export/import 동작을 재사용한다.
  // 미포함 = exportSessionShallow → importSessionShallow
  // 포함  = duplicateSessionDeep (JSON + 모든 이미지 디렉터리 복사)
  async duplicateProject() {
    const cur = appState.curSession;
    if (!cur) {
      appState.pushMessage('프로젝트를 먼저 선택해주세요');
      return;
    }
    const mode = await appState.pushDialogAsync({
      type: 'select',
      text: '복제 방식을 선택해주세요',
      items: [
        { text: '이미지 포함', value: 'deep' },
        { text: '이미지 미포함', value: 'shallow' },
      ],
    });
    if (!mode) return;

    // "(원본 이름) Copy" — 충돌 시 번호 부여
    const existing = sessionService.list();
    const base = cur.name + ' Copy';
    let newName = base;
    let i = 2;
    while (existing.includes(newName)) {
      newName = `${base} (${i})`;
      i++;
    }
    // 원본이 폴더 소속이면 같은 폴더에 복제
    const folder = sessionService.getFolderOf(cur.name);

    appState.setProgressDialog({ text: '프로젝트 복제 중...', done: 0, total: 1 });
    try {
      if (mode === 'shallow') {
        const proj = await sessionService.exportSessionShallow(cur);
        await sessionService.importSessionShallow(proj, newName);
      } else {
        await sessionService.duplicateSessionDeep(cur, newName);
      }
      if (folder) {
        try {
          await sessionService.moveToFolder(newName, folder);
        } catch (e) {}
      }
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage(e.message || '프로젝트 복제에 실패했습니다.');
      return;
    }
    appState.setProgressDialog(undefined);
    const sess = await sessionService.get(newName);
    if (sess) appState.curSession = sess;
    appState.pushMessage(`"${newName}" (으)로 복제되었습니다.`);
  }

  // ===== 폴더 단위 내보내기/불러오기 =====
  // 프로젝트 메뉴와 동일하지만 범위를 폴더 전체로 확장한다.
  // - 불러오기: 가져온 프로젝트를 해당 폴더로 이동
  // - 내보내기: 폴더 내 프로젝트를 개별 내보낸 뒤 한 번 더 묶어 폴더째 압축
  private projectsInFolder(folder: string): string[] {
    return sessionService
      .list()
      .filter((n) => sessionService.getFolderOf(n) === folder)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  // 폴더와 그 안의 프로젝트를 모두 삭제(프로젝트는 휴지통으로 이동, 복구 가능).
  // 핵심: 프로젝트를 먼저 미분류(루트)로 옮긴 뒤 삭제해야 .deleted 가 루트에 생겨
  //       폴더 디렉터리 제거(deleteDir) 후에도 휴지통에 보존된다.
  async deleteFolderWithProjects(folder: string) {
    const names = sessionService.getProjectsInFolder(folder);
    appState.setProgressDialog({ text: '프로젝트 삭제중..', done: 0, total: names.length });
    let done = 0;
    for (const name of names) {
      try {
        await sessionService.moveToFolder(name, null);
        await sessionService.delete(name);
      } catch (e) {
        console.error('폴더 일괄 삭제 실패:', name, e);
      }
      appState.setProgressDialog({ text: '프로젝트 삭제중..', done: ++done, total: names.length });
    }
    try {
      await sessionService.deleteFolder(folder);
    } catch (e) {
      // 폴더 안에 프로젝트가 모두 빠졌으면 빈 디렉터리만 제거됨
    }
    // 현재 열린 프로젝트가 삭제 대상이었다면 해제
    if (appState.curSession && names.includes(appState.curSession.name)) {
      appState.curSession = undefined;
    }
    appState.setProgressDialog(undefined);
    appState.pushMessage(
      `폴더 "${folder}"와 ${names.length}개 프로젝트를 삭제했습니다. (휴지통에서 복구 가능)`,
    );
  }

  folderBackupMenu(folder: string) {
    appState.pushDialog({
      type: 'select',
      text: `폴더 "${folder}"`,
      items: [
        { text: '파일 불러오기', value: 'load' },
        { text: '프로젝트 백업 불러오기', value: 'loadDeep' },
        { text: '📦 폴더 백업 불러오기', value: 'loadFolder' },
        { text: '📦 폴더 백업 내보내기 (폴더째)', value: 'saveFolder' },
        { text: '🖼️ 이미지 내보내기', value: 'saveImages' },
      ],
      callback: async (value) => {
        if (value === 'saveFolder') await this.folderBackupExport(folder);
        else if (value === 'saveImages') await this.folderExportImages(folder);
        else if (value === 'load') await this.folderImportFile(folder);
        else if (value === 'loadDeep') this.folderImportDeep(folder);
        else if (value === 'loadFolder') await this.folderBackupImport();
      },
    });
  }

  // ===== 폴더 백업 (폴더째 단일 아카이브) =====
  // 내보내기: 폴더 내 모든 프로젝트의 파일을 <프로젝트명>/ 네임스페이스로 하나의 tar에 담고
  //           매니페스트(_folder.json)를 포함해 폴더 백업임을 표시한다.
  async folderBackupExport(folder: string) {
    const names = sessionService.getProjectsInFolder(folder);
    if (names.length === 0) {
      appState.pushMessage('폴더에 프로젝트가 없습니다.');
      return;
    }
    if (zipService.isZipping) {
      appState.pushMessage('이미 내보내기 작업이 진행중입니다.');
      return;
    }
    appState.setProgressDialog({ text: '폴더 백업 생성중..', done: 0, total: names.length });
    const entries: { path: string; name: string }[] = [];
    const manifest: {
      type: string;
      version: number;
      folder: string;
      color: string | null;
      projects: string[];
    } = {
      type: 'sdstudio-folder-backup',
      version: 1,
      folder,
      color: sessionService.getFolderColor(folder) || null,
      projects: [],
    };
    let done = 0;
    for (const name of names) {
      try {
        const session = await sessionService.get(name);
        if (session) {
          const projEntries = await sessionService.buildSessionDeepEntries(
            session,
            name + '/',
          );
          entries.push(...projEntries);
          manifest.projects.push(name);
        }
      } catch (e) {}
      appState.setProgressDialog({ text: '폴더 백업 생성중..', done: ++done, total: names.length });
    }
    if (manifest.projects.length === 0) {
      appState.setProgressDialog(undefined);
      appState.pushMessage('내보낼 프로젝트가 없습니다.');
      return;
    }
    // 매니페스트를 임시 파일로 써서 아카이브에 포함
    const tmpManifest = 'tmp/' + v4() + '.json';
    await backend.writeFile(tmpManifest, JSON.stringify(manifest));
    entries.push({ path: tmpManifest, name: '_folder.json' });

    appState.setProgressDialog({ text: '압축 파일 생성중..', done: 0, total: 1 });
    const outPath = 'exports/' + folder + '_folder_' + Date.now() + '.tar';
    try {
      await zipService.zipFiles(entries, outPath);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage(e.message);
      return;
    }
    appState.setProgressDialog(undefined);
    appState.pushDialog({
      type: 'yes-only',
      text: `폴더 "${folder}" 백업이 완료되었습니다. (${manifest.projects.length}개 프로젝트)`,
    });
    await backend.showFile(outPath);
  }

  // 불러오기: 폴더 백업 아카이브를 선택 → 매니페스트 인식 → 폴더 새로 만들고 프로젝트 전체 복원.
  // 폴더 탭 / 프로젝트 메뉴 등 어디서나 호출 가능.
  async folderBackupImport() {
    const tarPath = await backend.selectFile();
    if (!tarPath) return;
    appState.setProgressDialog({ text: '폴더 백업을 불러오는 중입니다...', done: 0, total: 1 });

    const root = 'tmp/' + v4();
    try {
      await backend.unzipFiles(tarPath, root);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage('압축 해제에 실패했습니다.');
      return;
    }

    // 매니페스트 파싱 — 폴더 백업 파일인지 인식
    const manifest = await this.readFolderBackupManifest(root);
    if (!manifest) {
      appState.setProgressDialog(undefined);
      try { await backend.deleteDir(root); } catch (e) {}
      appState.pushMessage('폴더 백업 파일이 아닙니다.');
      return;
    }
    await this.restoreFolderBackupFromDir(root, manifest);
  }

  // 추출된 디렉터리에서 폴더 백업 매니페스트를 읽고 유효성 검증. 폴더 백업이 아니면 null.
  private async readFolderBackupManifest(root: string): Promise<any | null> {
    let manifest: any = null;
    try {
      manifest = JSON.parse(await backend.readFile(root + '/_folder.json'));
    } catch (e) {
      return null;
    }
    if (
      !manifest ||
      manifest.type !== 'sdstudio-folder-backup' ||
      !Array.isArray(manifest.projects)
    ) {
      return null;
    }
    return manifest;
  }

  // 이미 추출된 디렉터리(root)와 매니페스트로 폴더와 하위 프로젝트를 복원한다.
  // (folderBackupImport / 드래그&드롭 임포트가 공용으로 사용)
  private async restoreFolderBackupFromDir(root: string, manifest: any) {
    appState.setProgressDialog({ text: '폴더 백업을 불러오는 중입니다...', done: 0, total: 1 });

    // 폴더 이름 결정 (충돌 시 번호 부여)
    const baseFolder = (manifest.folder || '폴더').toString().trim() || '폴더';
    let folderName = baseFolder;
    {
      let i = 2;
      const folders = sessionService.listFolders();
      const projects = sessionService.list();
      while (folders.includes(folderName) || projects.includes(folderName)) {
        folderName = `${baseFolder} (${i})`;
        i++;
      }
    }
    try {
      await sessionService.createFolder(folderName);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      try { await backend.deleteDir(root); } catch (e2) {}
      appState.pushMessage(e.message || '폴더 생성에 실패했습니다.');
      return;
    }
    if (manifest.color) {
      try { await sessionService.setFolderColor(folderName, manifest.color); } catch (e) {}
    }

    // 프로젝트별 복원 (이름 충돌 시 번호 부여)
    const total = manifest.projects.length;
    let done = 0;
    let restored = 0;
    for (const origName of manifest.projects) {
      appState.setProgressDialog({ text: '프로젝트 복원중..', done, total });
      let pname = origName;
      let j = 2;
      while (sessionService.list().includes(pname)) {
        pname = `${origName} (${j})`;
        j++;
      }
      try {
        await sessionService.importSessionDeepFromDir(root + '/' + origName, pname);
        await sessionService.moveToFolder(pname, folderName);
        restored++;
      } catch (e) {
        console.error('폴더 백업 프로젝트 복원 실패:', origName, e);
      }
      done++;
    }
    try { await backend.deleteDir(root); } catch (e) {}

    appState.setProgressDialog(undefined);
    appState.pushDialog({
      type: 'yes-only',
      text: `폴더 "${folderName}"(으)로 ${restored}/${total}개 프로젝트를 복원했습니다.`,
    });
  }

  // ===== 라이브러리 단위 백업/복원 (글로벌 프리셋 · 작가 라이브러리) =====

  // 복원 시 이름 충돌 처리 방식을 묻는다. 덮어쓰기는 파괴적이라 2번 더 확인.
  private async askLibraryBackupPolicy(
    label: string,
  ): Promise<'rename' | 'skip' | 'overwrite' | undefined> {
    const choice = await appState.pushDialogAsync({
      type: 'select',
      text: `${label} 백업을 불러옵니다.\n이름이 같은 항목이 있을 때 처리 방식을 선택하세요.`,
      items: [
        { text: '동명은 새 이름 (2)로 불러오기 (권장)', value: 'rename' },
        { text: '동명은 건너뛰기', value: 'skip' },
        { text: '⚠️ 동명을 덮어쓰기 (기존 영구 삭제)', value: 'overwrite' },
      ],
    });
    if (!choice || choice === 'cancel') return undefined;
    if (choice === 'overwrite') {
      const c1 = await appState.pushDialogAsync({
        type: 'select',
        text: '⚠️ 덮어쓰기: 이름이 같은 기존 항목이 영구 삭제되고 백업으로 대체됩니다.\n정말로 진행할까요?',
        items: [{ text: '예, 덮어씁니다', value: 'yes' }],
      });
      if (c1 !== 'yes') return undefined;
      const c2 = await appState.pushDialogAsync({
        type: 'select',
        text: '정말 정말로 진행할까요?\n이 작업은 되돌릴 수 없습니다.',
        items: [{ text: '예, 확실합니다', value: 'yes' }],
      });
      if (c2 !== 'yes') return undefined;
    }
    return choice as 'rename' | 'skip' | 'overwrite';
  }

  private async libraryBackupExport(opts: {
    label: string;
    manifestType: string;
    fileBase: string;
    isEmpty: boolean;
    buildEntries: () => Promise<{ path: string; name: string }[]>;
  }) {
    if (zipService.isZipping) {
      appState.pushMessage('이미 내보내기 작업이 진행중입니다.');
      return;
    }
    if (opts.isEmpty) {
      appState.pushMessage(`${opts.label}이(가) 비어 있어 백업할 내용이 없습니다.`);
      return;
    }
    appState.setProgressDialog({ text: '백업 생성중..', done: 0, total: 1 });
    let entries: { path: string; name: string }[];
    try {
      entries = await opts.buildEntries();
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage('백업 생성 실패: ' + (e.message || e));
      return;
    }
    const manifest = {
      type: opts.manifestType,
      version: 1,
      createdAt: Date.now(),
    };
    const tmpManifest = 'tmp/' + v4() + '.json';
    await backend.writeFile(tmpManifest, JSON.stringify(manifest));
    entries.push({ path: tmpManifest, name: '_manifest.json' });
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = `exports/sdstudio-${opts.fileBase}-${dateStr}.tar`;
    try {
      await zipService.zipFiles(entries, outPath);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage(e.message);
      return;
    }
    appState.setProgressDialog(undefined);
    appState.pushDialog({
      type: 'yes-only',
      text: `${opts.label} 백업이 완료되었습니다.`,
    });
    try {
      await backend.showFile(outPath);
    } catch (e) {}
  }

  private async libraryBackupImport(opts: {
    label: string;
    manifestType: string;
    restore: (
      root: string,
      policy: 'rename' | 'skip' | 'overwrite',
    ) => Promise<{ added: number; skipped: number; overwritten: number }>;
  }) {
    const tarPath = await backend.selectFile();
    if (!tarPath) return;
    appState.setProgressDialog({ text: '백업을 확인하는 중..', done: 0, total: 1 });
    const root = 'tmp/' + v4();
    try {
      await backend.unzipFiles(tarPath, root);
    } catch (e) {
      appState.setProgressDialog(undefined);
      appState.pushMessage('압축 해제에 실패했습니다.');
      return;
    }
    let manifest: any = null;
    try {
      manifest = JSON.parse(await backend.readFile(root + '/_manifest.json'));
    } catch (e) {}
    appState.setProgressDialog(undefined);
    const cleanup = async () => {
      try {
        await backend.deleteDir(root);
      } catch (e) {}
    };
    if (!manifest || manifest.type !== opts.manifestType) {
      await cleanup();
      appState.pushMessage(`${opts.label} 백업 파일이 아닙니다.`);
      return;
    }
    const policy = await this.askLibraryBackupPolicy(opts.label);
    if (!policy) {
      await cleanup();
      return;
    }
    appState.setProgressDialog({ text: '복원중..', done: 0, total: 1 });
    let res: { added: number; skipped: number; overwritten: number };
    try {
      res = await opts.restore(root, policy);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      await cleanup();
      appState.pushMessage('복원 실패: ' + (e.message || e));
      return;
    }
    appState.setProgressDialog(undefined);
    await cleanup();
    const extra: string[] = [];
    if (res.skipped > 0) extra.push(`${res.skipped}개 건너뜀`);
    if (res.overwritten > 0) extra.push(`${res.overwritten}개 덮어씀`);
    appState.pushDialog({
      type: 'yes-only',
      text:
        `${opts.label} ${res.added}개를 불러왔습니다.` +
        (extra.length ? `\n(${extra.join(', ')})` : ''),
    });
  }

  async globalPresetBackupExport() {
    await globalPresetService.flushSave(); // 디스크 JSON 최신화 후 백업
    await this.libraryBackupExport({
      label: '글로벌 프리셋',
      manifestType: 'sdstudio-global-presets',
      fileBase: 'global-presets',
      isEmpty: globalPresetService.presets.length === 0,
      buildEntries: () => globalPresetService.buildBackupEntries(),
    });
  }

  async globalPresetBackupImport() {
    await this.libraryBackupImport({
      label: '글로벌 프리셋',
      manifestType: 'sdstudio-global-presets',
      restore: (root, policy) =>
        globalPresetService.restoreFromBackupDir(root, policy),
    });
  }

  async artistLibraryBackupExport() {
    await artistLibraryService.flushSave(); // 디스크 JSON 최신화 후 백업
    await this.libraryBackupExport({
      label: '작가 라이브러리',
      manifestType: 'sdstudio-artist-library',
      fileBase: 'artist-library',
      isEmpty: artistLibraryService.artists.length === 0,
      buildEntries: () => artistLibraryService.buildBackupEntries(),
    });
  }

  async artistLibraryBackupImport() {
    await this.libraryBackupImport({
      label: '작가 라이브러리',
      manifestType: 'sdstudio-artist-library',
      restore: (root, policy) =>
        artistLibraryService.restoreFromBackupDir(root, policy),
    });
  }

  // ===== 전체 백업 (모든 프로젝트 + 전역 설정, 단일 아카이브) =====
  // 어떤 삭제 버그에도 사용자를 지키는 최종 안전망. 프로젝트 드로어 상단에서 호출.
  fullBackupMenu() {
    appState.pushDialog({
      type: 'select',
      text: '전체 백업',
      items: [
        { text: '📦 백업 만들기 (이미지 포함)', value: 'export_full' },
        { text: '📦 백업 만들기 (이미지 제외)', value: 'export_noimg' },
        { text: '⚙️ 백업 만들기 (설정만)', value: 'export_settings' },
        { text: '📥 백업 불러오기', value: 'import' },
      ],
      callback: async (value) => {
        if (value === 'export_full') await this.fullBackupExport('full');
        else if (value === 'export_noimg') await this.fullBackupExport('noimg');
        else if (value === 'export_settings')
          await this.fullBackupExport('settings');
        else if (value === 'import') await this.fullBackupImport();
      },
    });
  }

  async fullBackupExport(mode: 'full' | 'noimg' | 'settings') {
    if (zipService.isZipping) {
      appState.pushMessage('이미 내보내기 작업이 진행중입니다.');
      return;
    }
    const allNames = mode === 'settings' ? [] : sessionService.list();

    // 이미지 포함 백업은 용량이 클 수 있으니, 시작 전 예상 용량을 계산해 한 번 더 확인.
    // ('저장 공간 관리'의 용량 계산 로직 재사용)
    if (mode === 'full' && allNames.length > 0) {
      appState.setProgressDialog({ text: '백업 용량 확인중..', done: 0, total: 1 });
      let bytes = 0;
      try {
        bytes = await projectSizeService.estimateFullBackupBytes(allNames);
      } catch (e) {
        console.error('백업 용량 계산 실패:', e);
      }
      appState.setProgressDialog(undefined);
      const fmt = (b: number) => {
        if (b < 1024) return b + ' B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
        if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
        return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
      };
      const ans = await appState.pushDialogAsync({
        type: 'select',
        text: `이미지를 포함한 전체 백업의 예상 용량은 약 ${fmt(bytes)} 입니다.\n용량이 클 수 있으니 저장 공간을 확인하세요.\n계속할까요?`,
        items: [{ text: '계속 진행', value: 'yes' }],
      });
      if (ans !== 'yes') return;
    }

    const entries: { path: string; name: string }[] = [];
    const projects: { name: string; folder: string | null }[] = [];

    if (mode !== 'settings') {
      appState.setProgressDialog({
        text: '백업 생성중..',
        done: 0,
        total: allNames.length,
      });
      let done = 0;
      for (const name of allNames) {
        try {
          const session = await sessionService.get(name);
          if (session) {
            let projEntries = await sessionService.buildSessionDeepEntries(
              session,
              name + '/',
            );
            if (mode === 'noimg') {
              // 생성 이미지(outs/inpaints)만 제외. vibe/참조/인페인트 원본·마스크는 유지.
              const prefixLen = (name + '/').length;
              projEntries = projEntries.filter((e) => {
                const rel = e.name.substring(prefixLen);
                return !(rel.startsWith('outs/') || rel.startsWith('inpaints/'));
              });
            }
            entries.push(...projEntries);
            projects.push({ name, folder: sessionService.getFolderOf(name) });
          }
        } catch (e) {}
        appState.setProgressDialog({
          text: '백업 생성중..',
          done: ++done,
          total: allNames.length,
        });
      }
    }

    // 전역 설정 (모든 모드 포함)
    appState.setProgressDialog({ text: '설정 수집중..', done: 0, total: 1 });
    const settingsEntries = await this.buildSettingsEntries();
    entries.push(...settingsEntries);

    if (entries.length === 0) {
      appState.setProgressDialog(undefined);
      appState.pushMessage('백업할 데이터가 없습니다.');
      return;
    }

    const folders = sessionService.listFolders().map((f) => ({
      name: f,
      color: sessionService.getFolderColor(f) || null,
    }));
    const manifest = {
      type: 'sdstudio-full-backup',
      version: 1,
      mode,
      createdAt: Date.now(),
      projects,
      folders,
      folderOrder: sessionService.getOrderedFolders(),
    };
    const tmpManifest = 'tmp/' + v4() + '.json';
    await backend.writeFile(tmpManifest, JSON.stringify(manifest));
    entries.push({ path: tmpManifest, name: '_backup.json' });

    appState.setProgressDialog({ text: '압축 파일 생성중..', done: 0, total: 1 });
    const dateStr = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const outPath = 'exports/sdstudio-backup-' + mode + '-' + dateStr + '.tar';
    try {
      await zipService.zipFiles(entries, outPath);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage(e.message);
      return;
    }
    appState.setProgressDialog(undefined);
    appState.pushDialog({
      type: 'yes-only',
      text:
        mode === 'settings'
          ? '설정 백업이 완료되었습니다.'
          : `전체 백업이 완료되었습니다. (${projects.length}개 프로젝트${
              mode === 'noimg' ? ', 이미지 제외' : ''
            })`,
    });
    try {
      await backend.showFile(outPath);
    } catch (e) {}
  }

  // 전역 설정 파일 + 글로벌 이미지 디렉터리를 __settings__/ 네임스페이스 엔트리로.
  private async buildSettingsEntries(): Promise<
    { path: string; name: string }[]
  > {
    const entries: { path: string; name: string }[] = [];
    for (const file of FULL_BACKUP_SETTINGS_FILES) {
      try {
        if (await backend.existFile(file)) {
          entries.push({ path: file, name: '__settings__/' + file });
        }
      } catch (e) {}
    }
    for (const dir of FULL_BACKUP_SETTINGS_IMAGE_DIRS) {
      // listFilesWithStats = 파일만 반환(디렉터리 제외) → zip이 디렉터리를 읽다 EISDIR 나는 것 방지
      let stats: any[] = [];
      try {
        stats = await backend.listFilesWithStats(dir);
      } catch (e) {
        stats = [];
      }
      for (const s of stats) {
        if (s.name.startsWith('.')) continue;
        entries.push({
          path: dir + '/' + s.name,
          name: '__settings__/' + dir + '/' + s.name,
        });
      }
    }
    return entries;
  }

  async fullBackupImport() {
    const tarPath = await backend.selectFile();
    if (!tarPath) return;
    appState.setProgressDialog({
      text: '백업을 확인하는 중입니다...',
      done: 0,
      total: 1,
    });
    const root = 'tmp/' + v4();
    try {
      await backend.unzipFiles(tarPath, root);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage('압축 해제에 실패했습니다.');
      return;
    }
    let manifest: any = null;
    try {
      manifest = JSON.parse(await backend.readFile(root + '/_backup.json'));
    } catch (e) {}
    appState.setProgressDialog(undefined);
    if (!manifest || manifest.type !== 'sdstudio-full-backup') {
      try {
        await backend.deleteDir(root);
      } catch (e) {}
      appState.pushMessage('전체 백업 파일이 아닙니다.');
      return;
    }
    const mode: 'full' | 'noimg' | 'settings' =
      manifest.mode === 'settings'
        ? 'settings'
        : manifest.mode === 'noimg'
          ? 'noimg'
          : 'full';
    const projCount = Array.isArray(manifest.projects)
      ? manifest.projects.length
      : 0;
    const cleanup = async () => {
      try {
        await backend.deleteDir(root);
      } catch (e) {}
    };

    // 설정만 모드: 충돌 정책 불필요 — 병합만.
    if (mode === 'settings') {
      const ans = await appState.pushDialogAsync({
        type: 'select',
        text: '설정 백업을 불러옵니다.\n현재 데이터는 보존되며, 백업의 설정이 병합됩니다(덮어쓰지 않음).\n계속할까요?',
        items: [{ text: '계속 진행', value: 'yes' }],
      });
      if (ans !== 'yes') {
        await cleanup();
        return;
      }
      await this.restoreFullBackupFromDir(root, manifest, mode, 'rename');
      return;
    }

    // 전체/이미지제외: 동명 프로젝트 처리 방식 선택.
    // 단, 이미지 없는 백업(noimg)은 덮어쓰기 금지 — 기존 이미지가 사라지고
    // 이미지 없는 버전으로 대체돼 순손실이 되기 때문.
    const policyItems: { text: string; value: string }[] = [
      { text: '동명은 새 이름 (2)로 복원 (권장)', value: 'rename' },
      { text: '동명은 건너뛰기', value: 'skip' },
    ];
    if (mode !== 'noimg') {
      policyItems.push({
        text: '⚠️ 동명을 덮어쓰기 (기존 영구 삭제)',
        value: 'overwrite',
      });
    }
    const choice = await appState.pushDialogAsync({
      type: 'select',
      text:
        `전체 백업을 불러옵니다. (${projCount}개 프로젝트)\n이름이 같은 프로젝트가 있을 때 처리 방식을 선택하세요.` +
        (mode === 'noimg'
          ? '\n(이미지 없는 백업이라 덮어쓰기는 제공되지 않습니다.)'
          : ''),
      items: policyItems,
    });
    if (!choice || choice === 'cancel') {
      await cleanup();
      return;
    }
    const policy = choice as 'rename' | 'skip' | 'overwrite';

    // 덮어쓰기는 파괴적 — 두 번 더 확인.
    if (policy === 'overwrite') {
      const c1 = await appState.pushDialogAsync({
        type: 'select',
        text: '⚠️ 덮어쓰기: 이름이 같은 기존 프로젝트와 그 이미지가 영구 삭제되고 백업으로 대체됩니다.\n정말로 진행할까요?',
        items: [{ text: '예, 덮어씁니다', value: 'yes' }],
      });
      if (c1 !== 'yes') {
        await cleanup();
        return;
      }
      const c2 = await appState.pushDialogAsync({
        type: 'select',
        text: '정말 정말로 진행할까요?\n이 작업은 되돌릴 수 없습니다.',
        items: [{ text: '예, 확실합니다', value: 'yes' }],
      });
      if (c2 !== 'yes') {
        await cleanup();
        return;
      }
    }

    await this.restoreFullBackupFromDir(root, manifest, mode, policy);
  }

  private async restoreFullBackupFromDir(
    root: string,
    manifest: any,
    mode: 'full' | 'noimg' | 'settings',
    policy: 'rename' | 'skip' | 'overwrite',
  ) {
    try {
      if (mode !== 'settings') {
        // 1. 폴더 먼저 생성 (+색상)
        if (Array.isArray(manifest.folders)) {
          for (const f of manifest.folders) {
            if (!f || !f.name) continue;
            if (!sessionService.listFolders().includes(f.name)) {
              try {
                await sessionService.createFolder(f.name);
              } catch (e) {}
            }
            if (f.color) {
              try {
                await sessionService.setFolderColor(f.name, f.color);
              } catch (e) {}
            }
          }
        }
        // 2. 프로젝트 복원 (이름 충돌 시 새 이름 — 덮어쓰지 않음)
        const projects = Array.isArray(manifest.projects)
          ? manifest.projects
          : [];
        const total = projects.length;
        let done = 0;
        let restored = 0;
        let skipped = 0;
        let overwritten = 0;
        for (const p of projects) {
          const origName = typeof p === 'string' ? p : p.name;
          const folder = typeof p === 'string' ? null : p.folder ?? null;
          if (!origName) {
            done++;
            continue;
          }
          appState.setProgressDialog({ text: '프로젝트 복원중..', done, total });
          let pname = origName;
          const exists = sessionService.list().includes(origName);
          if (exists) {
            if (policy === 'skip') {
              skipped++;
              done++;
              continue;
            }
            if (policy === 'overwrite' && mode !== 'noimg') {
              // 기존 동명 프로젝트를 완전히 제거(.json + 이미지 디렉터리)한 뒤 복원.
              // delete로 .json→.deleted + 메모리 제거 → permanentlyDeleteProject가
              // 활성 .json이 없어진 상태에서 .deleted와 이미지 디렉터리를 정리한다.
              try {
                if (appState.curSession?.name === origName) {
                  appState.curSession = undefined;
                }
                await sessionService.delete(origName);
                await trashService.permanentlyDeleteProject(origName);
                overwritten++;
              } catch (e) {
                console.error('덮어쓰기용 기존 프로젝트 제거 실패:', origName, e);
              }
              pname = origName;
            } else {
              // rename: 빈 이름이 나올 때까지 (n) 부여
              let j = 2;
              while (sessionService.list().includes(pname)) {
                pname = `${origName} (${j})`;
                j++;
              }
            }
          }
          try {
            await sessionService.importSessionDeepFromDir(
              root + '/' + origName,
              pname,
            );
            if (folder && sessionService.listFolders().includes(folder)) {
              try {
                await sessionService.moveToFolder(pname, folder);
              } catch (e) {}
            }
            restored++;
          } catch (e) {
            console.error('백업 프로젝트 복원 실패:', origName, e);
          }
          done++;
        }
        // 3. 폴더 순서 (전체 복원에서만 반영)
        if (Array.isArray(manifest.folderOrder) && manifest.folderOrder.length) {
          try {
            await sessionService.setFolderOrder(manifest.folderOrder);
          } catch (e) {}
        }
        appState.setProgressDialog({ text: '설정 병합중..', done: 0, total: 1 });
        await this.mergeSettingsFromDir(root + '/__settings__');
        appState.setProgressDialog(undefined);
        const extra: string[] = [];
        if (skipped > 0) extra.push(`${skipped}개 건너뜀`);
        if (overwritten > 0) extra.push(`${overwritten}개 덮어씀`);
        appState.pushDialog({
          type: 'yes-only',
          text:
            `${restored}/${total}개 프로젝트와 설정을 복원했습니다.` +
            (extra.length ? `\n(${extra.join(', ')})` : ''),
        });
      } else {
        appState.setProgressDialog({ text: '설정 병합중..', done: 0, total: 1 });
        await this.mergeSettingsFromDir(root + '/__settings__');
        appState.setProgressDialog(undefined);
        appState.pushDialog({ type: 'yes-only', text: '설정을 병합했습니다.' });
      }
    } finally {
      try {
        await backend.deleteDir(root);
      } catch (e) {}
    }
  }

  // 설정 병합: 디스크 실데이터가 진실. 현재 값을 덮어쓰지 않고(union/fill),
  // 실재하지 않는 프로젝트/폴더 참조는 버린다(prune). trash.json/folderOrder는 제외.
  private async mergeSettingsFromDir(dir: string) {
    const readJson = async (name: string): Promise<any | null> => {
      try {
        return JSON.parse(await backend.readFile(dir + '/' + name));
      } catch (e) {
        return null;
      }
    };
    const existingProjects = new Set(sessionService.list());
    const existingFolders = new Set(sessionService.listFolders());

    // 즐겨찾기: 존재하는 프로젝트만 union
    try {
      const fav = await readJson('favorites.json');
      if (Array.isArray(fav)) {
        let changed = false;
        for (const n of fav) {
          if (existingProjects.has(n) && !sessionService.favorites.has(n)) {
            sessionService.favorites.add(n);
            changed = true;
          }
        }
        if (changed) await sessionService.saveFavorites();
      }
    } catch (e) {}

    // 내보내기 프리셋: 이름 기준 union (현재 우선)
    try {
      const ep = await readJson('exportPresets.json');
      if (Array.isArray(ep)) {
        const cur = appState.loadExportPresets();
        const names = new Set(cur.map((p: any) => p.name));
        let added = false;
        for (const p of ep) {
          if (p && p.name && !names.has(p.name)) {
            cur.push(p);
            names.add(p.name);
            added = true;
          }
        }
        if (added) appState.saveExportPresets(cur);
      }
    } catch (e) {}

    // 폴더 색상: 존재 폴더 중 색상 없는 것만 채움
    try {
      const fc = await readJson('folderColors.json');
      if (fc && typeof fc === 'object') {
        for (const [folder, color] of Object.entries(fc)) {
          if (
            existingFolders.has(folder) &&
            color &&
            !sessionService.getFolderColor(folder)
          ) {
            try {
              await sessionService.setFolderColor(folder, color as string);
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    // 썸네일: 존재 프로젝트 중 참조 없는 것만 채움
    try {
      const th = await readJson('thumbnails.json');
      if (th && typeof th === 'object') {
        for (const [proj, ref] of Object.entries(th as any)) {
          if (
            existingProjects.has(proj) &&
            ref &&
            (ref as any).scene &&
            (ref as any).image &&
            !sessionService.getThumbnailRef(proj)
          ) {
            sessionService.setThumbnailRef(
              proj,
              (ref as any).scene,
              (ref as any).image,
            );
          }
        }
      }
    } catch (e) {}

    // 북마크: 존재 프로젝트 중 없는 것만 채움
    try {
      const bm = await readJson('bookmarks.json');
      if (bm && typeof bm === 'object') {
        const scenes = bm.scenes || {};
        for (const [proj, b] of Object.entries(scenes as any)) {
          if (
            existingProjects.has(proj) &&
            b &&
            (b as any).name &&
            !sessionService.getSceneBookmark(proj)
          ) {
            await sessionService.toggleSceneBookmark(
              proj,
              (b as any).name,
              (b as any).type || 'scene',
            );
          }
        }
        const images = bm.images || {};
        for (const [key, filename] of Object.entries(images as any)) {
          const idx = key.indexOf(':');
          if (idx < 0) continue;
          const proj = key.substring(0, idx);
          const scene = key.substring(idx + 1);
          if (
            existingProjects.has(proj) &&
            filename &&
            !sessionService.getImageBookmark(proj, scene)
          ) {
            await sessionService.toggleImageBookmark(
              proj,
              scene,
              filename as string,
            );
          }
        }
      }
    } catch (e) {}

    // 글로벌 라이브러리: 현재 비어 있을 때만 통째 채택(이미지 포함).
    // 채워져 있으면 보존(깊은 id-병합은 후속 작업).
    await this.adoptGlobalsIfEmpty(dir);

    // trash.json, folderOrder.json: 설정 병합에서 의도적으로 제외
  }

  private async adoptGlobalsIfEmpty(dir: string) {
    const copyImages = async (sub: string) => {
      // 파일만 (디렉터리 제외)
      let stats: any[] = [];
      try {
        stats = await backend.listFilesWithStats(dir + '/' + sub);
      } catch (e) {
        return;
      }
      for (const s of stats) {
        if (s.name.startsWith('.')) continue;
        try {
          if (!(await backend.existFile(sub + '/' + s.name))) {
            await backend.copyFile(
              dir + '/' + sub + '/' + s.name,
              sub + '/' + s.name,
            );
          }
        } catch (e) {}
      }
    };
    // 글로벌 프리셋
    try {
      if (
        globalPresetService.list().length === 0 &&
        (await backend.existFile(dir + '/global_presets.json'))
      ) {
        await copyImages('global_vibes');
        await backend.copyFile(
          dir + '/global_presets.json',
          'global_presets.json',
        );
        await globalPresetService.load();
      }
    } catch (e) {}
    // 글로벌 프롬프트 조각
    try {
      if (
        globalPieceService.library.size === 0 &&
        (await backend.existFile(dir + '/global_pieces.json'))
      ) {
        await backend.copyFile(
          dir + '/global_pieces.json',
          'global_pieces.json',
        );
        await globalPieceService.load();
      }
    } catch (e) {}
    // 글로벌 캐릭터 프리셋
    try {
      if (
        globalCharacterPresetService.presets.length === 0 &&
        (await backend.existFile(dir + '/global_character_presets.json'))
      ) {
        await copyImages('global_char_images');
        await backend.copyFile(
          dir + '/global_character_presets.json',
          'global_character_presets.json',
        );
        await globalCharacterPresetService.load();
      }
    } catch (e) {}
  }

  folderImportDeep(folder: string) {
    appState.pushDialog({
      type: 'input-confirm',
      text: '새로운 프로젝트 이름을 입력해주세요',
      callback: async (inputValue) => {
        if (!inputValue) return;
        if (sessionService.list().includes(inputValue)) {
          appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
          return;
        }
        const tarPath = await backend.selectFile();
        if (!tarPath) return;
        appState.setProgressDialog({ text: '프로젝트 백업을 불러오는 중입니다...', done: 0, total: 1 });
        try {
          await sessionService.importSessionDeep(tarPath, inputValue);
        } catch (e: any) {
          appState.setProgressDialog(undefined);
          appState.pushMessage(e.message);
          return;
        }
        try {
          await sessionService.moveToFolder(inputValue, folder);
        } catch (e) {}
        appState.setProgressDialog(undefined);
        appState.pushDialog({ type: 'yes-only', text: `"${folder}" 폴더로 백업을 불러왔습니다.` });
      },
    });
  }

  // 파일 불러오기: 가져온 직후 새로 생긴 프로젝트(들)를 폴더로 이동
  async folderImportFile(folder: string) {
    const before = new Set(sessionService.list());
    const file = await getFirstFile();
    if (!file) return;
    appState.handleFile(file as any);
    const newNames = await this.waitForNewProjects(before, 20000);
    if (newNames.length === 0) return;
    for (const n of newNames) {
      try {
        await sessionService.moveToFolder(n, folder);
      } catch (e) {}
    }
    appState.pushMessage(`"${folder}" 폴더로 ${newNames.length}개 불러왔습니다.`);
  }

  // listupdated를 감시해 새로 추가된 프로젝트 이름을 모아 반환 (타임아웃 보호)
  private waitForNewProjects(before: Set<string>, timeout: number): Promise<string[]> {
    return new Promise((resolve) => {
      let settled = false;
      let settleTimer: any = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        sessionService.removeEventListener('listupdated', onUpd);
        clearTimeout(timeoutTimer);
        if (settleTimer) clearTimeout(settleTimer);
        resolve(sessionService.list().filter((n) => !before.has(n)));
      };
      const onUpd = () => {
        if (sessionService.list().some((n) => !before.has(n))) {
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(finish, 700);
        }
      };
      const timeoutTimer = setTimeout(finish, timeout);
      sessionService.addEventListener('listupdated', onUpd);
    });
  }

  // 특정 세션의 이미지들을 (선택적 최적화까지 수행하여) 압축 엔트리 목록으로 만든다.
  // exportPackage의 단일 이미지 내보내기 로직을 세션 인자형으로 재구성한 것.
  private async buildSessionImageEntries(
    session: Session,
    type: 'scene' | 'inpaint',
    prefix: string,
    fav: boolean,
    opt: string,
    imageSize: number,
    separator: string,
    charsToReplace: Set<string>,
  ): Promise<{ path: string; name: string }[]> {
    let paths: { path: string; name: string }[] = [];
    await imageService.refreshBatch(session);
    const scenes = session.getScenes(type);
    await Promise.allSettled(scenes.map((s) => gameService.refreshList(session, s)));
    for (const scene of scenes) {
      const cands = gameService.getOutputs(session, scene);
      const imageMap: any = {};
      cands.forEach((x) => {
        imageMap[x] = true;
      });
      const images: string[] = [];
      if (fav) {
        if (scene.mains.length) {
          for (const main of scene.mains) if (imageMap[main]) images.push(main);
        } else if (cands.length) {
          images.push(cands[0]);
        }
      } else {
        for (const cand of cands) images.push(cand);
      }
      const characterPreset = appState.getAppliedCharacterPreset();
      const presetPrefix = characterPreset?.filenamePrefix || '';
      const presetSuffix = characterPreset?.filenameSuffix || '';
      let sceneName = scene.name;
      let finalPrefix = prefix;
      let finalPresetPrefix = presetPrefix ? presetPrefix + separator : '';
      let finalPresetSuffix = presetSuffix ? separator + presetSuffix : '';
      if (charsToReplace.size > 0) {
        const escaped = Array.from(charsToReplace)
          .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|');
        const regex = new RegExp(`(${escaped})+`, 'g');
        sceneName = sceneName.replace(regex, separator);
        finalPrefix = finalPrefix.replace(regex, separator);
        finalPresetPrefix = finalPresetPrefix.replace(regex, separator);
        finalPresetSuffix = finalPresetSuffix.replace(regex, separator);
      }
      const isMirror =
        scene.type === 'inpaint' &&
        (scene as InpaintScene).workflowType === 'SDMirror';
      for (let i = 0; i < images.length; i++) {
        let imgPath = imageService.getOutputDir(session, scene) + '/' + images[i];
        if (isMirror) {
          const imgData = await imageService.fetchImage(imgPath);
          if (imgData) {
            const cropped = await cropMirrorResultFromDataUri(
              imgData,
              (scene as InpaintScene).mirrorCropX,
            );
            const tmpPath = 'tmp/' + v4() + '.png';
            await backend.writeDataFile(tmpPath, cropped);
            imgPath = tmpPath;
          }
        }
        const baseName = finalPresetPrefix + finalPrefix + sceneName + finalPresetSuffix;
        const name =
          images.length === 1
            ? baseName + '.png'
            : baseName + separator + (i + 1).toString() + '.png';
        paths.push({ path: imgPath, name });
      }
    }
    if (opt !== 'original') {
      const ext = opt === 'avif' ? '.avif' : '.webp';
      const optimizeMethod =
        opt === 'lossy'
          ? ImageOptimizeMethod.LOSSY
          : opt === 'avif'
            ? ImageOptimizeMethod.AVIF
            : ImageOptimizeMethod.LOSSLESS;
      let done = 0;
      let failCount = 0;
      const config = await backend.getConfig();
      const CONCURRENCY = Math.max(
        1,
        Math.min(4, config.exportConcurrency ?? (isMobile ? 2 : 4)),
      );
      const results: ({ path: string; name: string } | null)[] = new Array(
        paths.length,
      ).fill(null);
      appState.exportProgress = {
        text: '이미지 크기 최적화 중..',
        done: 0,
        total: paths.length,
      };
      const queue = paths.map((item, idx) => ({ item, idx }));
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, queue.length) },
        async () => {
          while (queue.length > 0) {
            const task = queue.shift();
            if (!task) break;
            const { item, idx } = task;
            const outputPath = 'tmp/' + v4() + ext;
            try {
              await backend.resizeImage({
                inputPath: item.path,
                outputPath: outputPath,
                maxHeight: imageSize,
                maxWidth: imageSize,
                optimize: optimizeMethod,
              });
              results[idx] = {
                path: outputPath,
                name: item.name.substring(0, item.name.length - 4) + ext,
              };
            } catch (e: any) {
              failCount++;
              console.error('이미지 최적화 실패:', item.path, e.message);
            }
            done++;
            appState.exportProgress = {
              text: '이미지 크기 최적화 중..',
              done: done,
              total: paths.length,
            };
          }
        },
      );
      await Promise.all(workers);
      paths = results.filter(
        (r): r is { path: string; name: string } => r !== null,
      );
      if (failCount > 0) {
        appState.pushMessage(`${failCount}개 이미지 최적화 실패 (건너뜀)`);
      }
    }
    return paths;
  }

  // 폴더 일괄 이미지 내보내기: 프로젝트별 이미지를 모아 한 압축 파일로
  // (프로젝트별 하위 폴더로 구분). 옵션은 폴더당 1회만 입력(프리셋 지원).
  async folderExportImages(folder: string) {
    const names = sessionService.getProjectsInFolder(folder);
    if (names.length === 0) {
      appState.pushMessage('폴더에 프로젝트가 없습니다.');
      return;
    }
    const opts = await this.askFolderImageOptions();
    if (!opts) return;

    // 폴더 내 모든 프로젝트의 씬 이름을 모아 특수문자 변환 여부를 한 번 질의
    const sceneNames: string[] = [];
    for (const name of names) {
      try {
        const session = await sessionService.get(name);
        if (session) {
          for (const s of session.getScenes('scene')) sceneNames.push(s.name);
        }
      } catch (e) {}
    }
    const charsToReplace = await appState.detectSpecialCharsFromNames(
      sceneNames,
      opts.separator,
    );
    if (charsToReplace === undefined) return; // 취소

    if (zipService.isZipping) {
      appState.pushMessage('이미 내보내기 작업이 진행중입니다.');
      return;
    }
    const allEntries: { path: string; name: string }[] = [];
    let i = 0;
    for (const name of names) {
      appState.exportProgress = {
        text: `이미지 수집 중.. (${name})`,
        done: i,
        total: names.length,
      };
      try {
        const session = await sessionService.get(name);
        if (session) {
          const entries = await this.buildSessionImageEntries(
            session,
            'scene',
            opts.prefix,
            opts.fav,
            opts.opt,
            opts.imageSize,
            opts.separator,
            charsToReplace,
          );
          for (const e of entries) {
            allEntries.push({ path: e.path, name: name + '/' + e.name });
          }
        }
      } catch (e) {}
      i++;
    }
    if (allEntries.length === 0) {
      appState.exportProgress = undefined;
      appState.pushMessage('내보낼 이미지가 없습니다.');
      return;
    }
    appState.exportProgress = {
      text: '이미지 압축파일 생성중..',
      done: 0,
      total: 1,
    };
    const outPath = 'exports/' + folder + '_images_' + Date.now() + '.tar';
    try {
      await zipService.zipFiles(allEntries, outPath);
    } catch (e: any) {
      appState.exportProgress = undefined;
      appState.pushMessage(e.message);
      return;
    }
    appState.exportProgress = undefined;
    appState.pushDialog({
      type: 'yes-only',
      text: `폴더 "${folder}" 이미지 내보내기가 완료되었습니다. (${allEntries.length}장)`,
    });
    await backend.showFile(outPath);
  }

  // 이미지 내보내기 옵션을 한 번 입력 받는다 (프리셋 또는 직접 설정).
  // 특수문자 치환은 폴더 일괄에서는 생략(빈 Set 사용).
  private async askFolderImageOptions(): Promise<
    { prefix: string; fav: boolean; opt: string; imageSize: number; separator: string } | undefined
  > {
    const presets = appState.loadExportPresets();
    const presetItems: { text: string; value: string }[] = presets.map(
      (p: ExportPreset, idx: number) => ({ text: p.name, value: `preset_${idx}` }),
    );
    presetItems.push({ text: '⚙️ 프리셋 관리', value: '_manage' });
    presetItems.push({ text: '── 직접 설정으로 내보내기 ──', value: '_manual' });
    const choice = await appState.pushDialogAsync({
      type: 'select',
      text: '내보내기 방법을 선택해주세요',
      items: presetItems,
    });
    if (!choice) return undefined;
    if (choice === '_manage') {
      appState.openExportPresetManager();
      return undefined;
    }
    if (choice.startsWith('preset_')) {
      const ep = presets[parseInt(choice.split('_')[1])];
      if (!ep) return undefined;
      let epPrefix = '';
      if (ep.format === 'prefix' && ep.prefix) {
        epPrefix = ep.prefix + ep.separator;
      } else if (ep.format === 'prefix_ask') {
        const inputName = await appState.pushDialogAsync({
          type: 'input-confirm',
          text: '캐릭터 이름을 입력해주세요',
        });
        if (!inputName) return undefined;
        epPrefix = inputName + ep.separator;
      }
      return {
        prefix: epPrefix,
        fav: ep.menu === 'fav',
        opt: ep.opt,
        imageSize: ep.imageSize,
        separator: ep.separator,
      };
    }
    // 직접 설정
    const menu = await appState.pushDialogAsync({
      type: 'select',
      text: '내보낼 이미지를 선택해주세요',
      items: [
        { text: '즐겨찾기 이미지만 내보내기', value: 'fav' },
        { text: '모든 이미지 전부 내보내기', value: 'all' },
      ],
    });
    if (!menu) return undefined;
    const format = await appState.pushDialogAsync({
      type: 'select',
      text: '파일 이름 형식을 선택해주세요',
      items: [
        { text: '(씬이름).(이미지 번호).png', value: 'normal' },
        { text: '(캐릭터 이름).(씬이름).(이미지 번호)', value: 'prefix' },
      ],
    });
    if (!format) return undefined;
    const optItems = [
      { text: '원본', value: 'original' },
      { text: '저손실 webp 최적화 (에셋용 권장)', value: 'lossy' },
    ];
    if (!isMobile) optItems.push({ text: '무손실 webp 최적화', value: 'lossless' });
    optItems.push({ text: isMobile ? 'AVIF 최적화 (PC 권장)' : 'AVIF 최적화', value: 'avif' });
    const opt = await appState.pushDialogAsync({
      type: 'select',
      text: '이미지 크기 최적화 방법을 선택해주세요',
      items: optItems,
    });
    if (!opt) return undefined;
    let imageSize = 0;
    if (opt !== 'original') {
      const inputImageSize = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '이미지 픽셀 크기를 결정해주세요 (추천값 1024)',
      });
      if (!inputImageSize) return undefined;
      imageSize = parseInt(inputImageSize);
      if (isNaN(imageSize)) return undefined;
    }
    const separatorInput = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '파일명 구분자를 입력해주세요 (기본값: .)',
    });
    if (separatorInput === undefined) return undefined;
    const separator = separatorInput || '.';
    let prefix = '';
    if (format === 'prefix') {
      const inputPrefix = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '캐릭터 이름을 입력해주세요',
      });
      if (!inputPrefix) return undefined;
      prefix = inputPrefix + separator;
    }
    return { prefix, fav: menu === 'fav', opt, imageSize, separator };
  }

  // ---------------- PNG 임포트 분기 ----------------

  /**
   * PNG base64 데이터를 받아서 사용자에게 임포트 방식을 물어본다.
   * - 메타데이터에 유효한 프리셋이 있고 글로벌 지원 타입이면:
   *     [현재 세션으로 / 글로벌 프리셋으로 / 프롬프트만 추출]
   * - 프리셋이 있지만 글로벌 지원 외 타입이면:
   *     [현재 세션으로 / 프롬프트만 추출]
   * - 프리셋이 없으면 기존대로 externalImage (프롬프트 추출 뷰)
   */
  async handleTarImport(tarPath: string): Promise<void> {
    // tar 내용을 한 번 추출해 폴더 백업 / 프로젝트 백업을 정확히 구분한다.
    // (드래그&드롭으로 들어온 tar 가 폴더 백업일 수도, 프로젝트 백업일 수도 있음)
    const root = 'tmp/' + v4();
    appState.setProgressDialog({ text: '백업 파일을 확인하는 중...', done: 0, total: 1 });
    try {
      await backend.unzipFiles(tarPath, root);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage('압축 해제에 실패했습니다.');
      return;
    }
    appState.setProgressDialog(undefined);

    // 1) 폴더 백업 (_folder.json 매니페스트) → 폴더째 복원
    const manifest = await this.readFolderBackupManifest(root);
    if (manifest) {
      await this.restoreFolderBackupFromDir(root, manifest);
      return;
    }

    // 2) 프로젝트 백업 (project.json 존재) → 단일 프로젝트로 복원
    let isProject = false;
    try {
      isProject = await backend.existFile(root + '/project.json');
    } catch (e) {}
    if (!isProject) {
      try { await backend.deleteDir(root); } catch (e) {}
      appState.pushMessage('인식할 수 없는 백업 파일입니다.');
      return;
    }

    appState.pushDialog({
      type: 'input-confirm',
      text: '프로젝트 백업을 불러옵니다.\n새 프로젝트 이름을 입력하세요.',
      onCancel: async () => {
        try { await backend.deleteDir(root); } catch (e) {}
      },
      callback: async (inputValue) => {
        if (!inputValue) {
          try { await backend.deleteDir(root); } catch (e) {}
          return;
        }
        if (sessionService.list().includes(inputValue)) {
          appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
          try { await backend.deleteDir(root); } catch (e) {}
          return;
        }
        appState.setProgressDialog({
          text: '프로젝트 백업을 불러오는 중입니다...',
          done: 0,
          total: 1,
        });
        try {
          await sessionService.importSessionDeepFromDir(root, inputValue);
        } catch (e: any) {
          appState.setProgressDialog(undefined);
          appState.pushMessage('백업 불러오기 실패: ' + e.message);
          try { await backend.deleteDir(root); } catch (e2) {}
          return;
        }
        try { await backend.deleteDir(root); } catch (e) {}
        appState.setProgressDialog(undefined);
        appState.pushDialog({
          type: 'yes-only',
          text: '프로젝트 백업을 불러왔습니다.',
        });
        const sess = await sessionService.get(inputValue);
        appState.curSession = sess;
      },
    });
  }

  async handlePngImport(base64: string): Promise<void> {
    if (!appState.curSession) return;
    const session = appState.curSession;

    let meta: any = null;
    try {
      meta = readJSONFromPNG(base64);
    } catch (e) {
      meta = null;
    }

    if (meta) {
      meta = normalizePresetJson(meta);
    }

    const hasPreset = !!(meta && meta.type && meta.name);
    const isGlobalSupported =
      hasPreset &&
      (SUPPORTED_GLOBAL_PRESET_TYPES as readonly string[]).includes(meta.type);

    if (!hasPreset) {
      // 프리셋 메타 없음 → 프롬프트 추출 뷰로
      appState.externalImage = base64;
      return;
    }

    const items: { text: string; value: string }[] = [
      {
        text: `현재 세션의 프리셋으로 가져오기`,
        value: 'session',
      },
    ];
    if (isGlobalSupported) {
      items.push({
        text: '글로벌 프리셋으로 저장',
        value: 'global',
      });
    }
    items.push({
      text: '프롬프트만 추출 (프리셋 저장 안 함)',
      value: 'extract',
    });

    const presetLabel = meta.name ? `"${meta.name}" ` : '';
    const typeLabel = isGlobalSupported
      ? meta.type === 'SDImageGenEasy'
        ? ' (그림체 이지모드)'
        : ' (그림체)'
      : ` (${meta.type})`;

    appState.pushDialog({
      type: 'select',
      text: `이미지에서 ${presetLabel}프리셋${typeLabel}을(를) 발견했습니다.\n어떻게 가져올까요?`,
      items,
      callback: async (option?: string) => {
        if (!option) return;
        if (option === 'session') {
          try {
            const preset = await importPreset(session, base64);
            if (preset) {
              session.selectedWorkflow = {
                workflowType: preset.type,
                presetName: preset.name,
              };
              appState.pushDialog({
                type: 'yes-only',
                text: `"${preset.name}" 프리셋을 현재 세션에 가져왔습니다.`,
              });
            } else {
              appState.externalImage = base64;
            }
          } catch (e: any) {
            appState.pushMessage('세션 임포트 실패: ' + (e.message || e));
          }
        } else if (option === 'global') {
          try {
            const entry = await globalPresetService.importFromPng(base64);
            if (entry) {
              appState.pushDialog({
                type: 'yes-only',
                text: `"${entry.name}" 프리셋을 글로벌 프리셋에 저장했습니다.`,
              });
            } else {
              appState.pushMessage('글로벌 프리셋 저장 실패: 유효하지 않은 메타데이터');
            }
          } catch (e: any) {
            appState.pushMessage('글로벌 프리셋 저장 실패: ' + (e.message || e));
          }
        } else if (option === 'extract') {
          appState.externalImage = base64;
        }
      },
    });
  }
}
