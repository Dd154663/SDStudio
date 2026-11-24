import {
  backend,
  exportPresetService,
  globalCharacterPresetService,
  globalPieceService,
  globalPresetService,
  artistLibraryService,
  projectTemplateService,
  imageService,
  localAIService,
  projectSizeService,
  sessionService,
  taskQueueService,
  templateService,
  trashService,
  workFlowService,
  zipService,
  flushGlobalStoresNow,
} from '.';
import { TEMPLATES_SIDECAR_FILE } from './TemplateService';
import type { FullBackupTemplatesOutcome } from './TemplateService';
import {
  PROJECT_TEMPLATES_FILE,
  PROJECT_TEMPLATE_IMAGES_DIR,
} from './ProjectTemplateService';
import type { FullBackupTemplateAdoptOutcome } from './ProjectTemplateService';
import {
  fullBackupTemplateNote,
  type FullBackupIncomingProject,
  type PreOverwriteDesignation,
} from './fullBackupTemplatePlan';
import type { GlobalPresetType, IGlobalPresetEntry } from './GlobalPresetService';
import { SUPPORTED_GLOBAL_PRESET_TYPES } from './GlobalPresetService';
import { Dialog, DialogItem } from '../componenets/ConfirmWindow';
import { dataUriToBase64, deleteImageFiles } from './ImageService';
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
import { stringifyExportJson } from './jsonExport';
import { buildBackupDoneText, BACKUP_EXPORT_TEXT } from './backupExportSummary';
import { isNotifiedExportTransferError } from '../backends/verifiedExportCopy';
import {
  DEFAULT_FOLDER_EXPORT_TARGET,
  exportRunOptionsFromPreset,
  FOLDER_EXPORT_VARIANT_DIR,
  folderExportSceneTypes,
} from './exportSettings';
import type { FolderExportTarget } from './exportSettings';
import type { ExportImageItem } from './ExportPresetService';
import { characterFilenameAffixOf } from './appliedCharacterPreset';
import { sanitizeFilenamePart } from './exportPresetUtils';
import {
  chooseImportSource,
  deliverExport,
  DriveExportKind,
  getSyncFolder,
  saveExportSilently,
  syncFileName,
} from './driveSync';
import { importFromDrive } from './driveImport';
import {
  askImportPolicy,
  askImportPolicyWithConfirm,
  confirmOverwrite,
  countNameConflicts,
  IMPORT_FLOW_TEXT,
  librarySummary,
  notifyImportDone,
  readNamesFromStore,
  type ImportPolicy,
} from './importFlow';
import { nameErrorMessage, projectNameRules, promptName, suggestFolderCopyName } from './nameInput';
import {
  fileStemOf,
  overwriteFailureText,
  planProjectImport,
  projectBackupFileName,
  projectImportSummary,
  PROJECT_IMPORT_LABEL,
  PROJECT_IMPORT_TEXT,
  runProjectOverwrite,
  suggestProjectName,
} from './projectOverwrite';
import { PROJECT_IMAGE_ROOTS } from './projectPaths';
import { runFolderDeleteWithProjects, type FolderDeleteResult } from './folderDeleteFlow';
import {
  deleteProjectForFolderFlow,
  deleteProjectForReplaceFlow,
} from './projectDeleteFlow';
import { deleteFolderWithProjectsRecorded } from './projectDeleteUndo';
import {
  clearForFullBackupOverwrite,
  FULL_BACKUP_OVERWRITE_TEXT,
} from './fullBackupOverwrite';
import {
  buildTemplateBackupStore,
  globalTemplateNames,
  readBackupTemplates,
  PROJECT_TEMPLATE_BACKUP,
} from './projectTemplateBackup';
import { beginPresetListRecord } from './presetUndo';
import { UNDO_TEXT } from './undoService';
import {
  BACKUP_IMPORT_TEXT,
  detectBackupKind,
  planBackupRoute,
  type BackupDetection,
  type BackupImportEntry,
} from './backupKind';
import {
  countBackupLibraryItems,
  fullBackupResultText,
  type FullBackupLibraryKind,
  type FullBackupLibraryOutcome,
} from './fullBackupResult';

// 전체 백업에 담는 전역 설정 파일. (백업엔 전부 담되, 설정 병합 복원 시
// trash.json / folderOrder.json 은 의도적으로 제외 — 아래 mergeSettingsFromDir 참조)
// 씬 템플릿 지정 목록·프로젝트 템플릿은 2026-11-18 T1 에 추가(파일 추가만 — 구버전 복원은 모르는 이름을 읽지 않는다).
// 함수로 둔다: 서비스 모듈의 이름 상수를 모듈 평가 시점이 아니라 쓸 때 읽게(순환 import 평가 순서와 무관하게).
const fullBackupSettingsFiles = (): string[] => [
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
  TEMPLATES_SIDECAR_FILE,
  PROJECT_TEMPLATES_FILE,
];
// 글로벌 프리셋/캐릭터·프로젝트 템플릿이 참조하는 이미지 디렉터리 (플랫, 파일만)
const fullBackupSettingsImageDirs = (): string[] => [
  'global_vibes',
  'global_char_images',
  PROJECT_TEMPLATE_IMAGES_DIR,
];

// 이 버전이 복원할 수 있는 매니페스트 version 상한. 현행 아카이브 포맷은
// version 1 그대로이며(무변경), 이 상한 검사는 미래에 포맷이 바뀌어 version이
// 올라갔을 때 지금 버전의 앱이 신 백업을 잘못 복원(이미지 유실 등)하는 것을
// 막는 포워드 호환 안전판이다. version 필드 부재(구 백업)는 통과.
const SUPPORTED_MANIFEST_VERSION = 1;

// 압축 해제된 라이브러리 백업 JSON 에서 항목 이름 목록(충돌 개수 계산용). 읽기 실패는 throw.
async function readBackupNames(path: string, key: string): Promise<string[]> {
  return readNamesFromStore(JSON.parse(await backend.readFile(path)), key);
}

// 라이브러리 복원 공개 메서드의 선택 인자(드라이브 API ③).
// pickedPath = 이미 받은 백업 파일(절대 경로) — 출처 선택·파일 선택기를 건너뛴다.
export interface LibraryImportOptions {
  pickedPath?: string;
}

/** 폴더 일괄 이미지 내보내기 — 폴더 안 모든 프로젝트의 씬 이름(종류별, 2026-11-17 M5 묶음 b-3) */
type FolderSceneNames = { scene: string[]; inpaint: string[] };

export class BackupService {
  // 프로젝트 불러오기·내보내기 메뉴(2026-11-19 백업 메뉴 분할 — 종전 projectBackupMenu 한 창의 8개를 둘로 나눔).
  // 복제·이름 수정·즐겨찾기는 이 메뉴에서 뺐다(프로젝트 서랍의 우클릭 목록·⋮ 메뉴·행의 별이 같은 일을 한다).
  // 항목 문구·값·동작 코드는 종전 그대로 옮겼다.
  projectImportMenu() {
    appState.pushDialog({
      type: 'select',
      text: '불러올 것을 선택해주세요',
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
      ],
      callback: async (value) => {
        if (value === 'load') {
          const file = await getFirstFile();
          appState.handleFile(file as any);
        } else if (value === 'loadFolder') {
          await this.folderBackupImport();
        } else if (value === 'loadDeep') {
          // 프로젝트 백업 불러오기(드라이브 동기화 ⑤): 파일 고르기 → 이름 확인/정책 선택 →
          // (덮어쓰기면 확인 2회 → 임시 백업·휴지통 이관 절차) → 완료 안내.
          // 드래그로 들어온 tar(handleTarImport)와 같은 흐름을 쓴다.
          // PC 는 드라이브 동기화 폴더가 있으면 그 폴더에서, tar 만 보이게 연다(모바일 무시).
          // Google 드라이브에 연결돼 있으면(PC) 먼저 출처를 묻는다(드라이브 API ③) — 드라이브면
          // 백업 관리 창에서 골라 받은 tar 가 같은 handleTarImport 로 들어간다.
          const source = await chooseImportSource('project');
          if (source === 'cancelled') return;
          if (source === 'drive') {
            await importFromDrive('project');
            return;
          }
          const syncFolder = await getSyncFolder();
          const tarPath = await backend.selectFile({
            ...(syncFolder ? { defaultPath: syncFolder } : {}),
            filters: [{ name: '프로젝트 백업', extensions: ['tar'] }],
          });
          if (!tarPath) return;
          await this.handleTarImport(tarPath);
        }
      },
    });
  }

  projectExportMenu() {
    appState.pushDialog({
      type: 'select',
      text: '내보낼 것을 선택해주세요',
      items: [
        {
          text: '프로젝트 파일 내보내기 (이미지 미포함)',
          value: 'save',
        },
        {
          text: '프로젝트 백업 내보내기 (이미지 포함)',
          value: 'saveDeep',
        },
      ],
      callback: async (value) => {
        if (value === 'save') {
          if (appState.curSession) {
            const proj = await sessionService.exportSessionShallow(
              appState.curSession,
            );
            const path = 'exports/' + appState.curSession.name + '.json';
            await backend.writeFile(path, stringifyExportJson(proj));
            await backend.publishExport(path);
          }
        } else if (value === 'saveDeep') {
          if (appState.curSession) {
            // 공용 파일명 규칙 sdstudio-project-<안전한 이름>-<날짜>.tar (드라이브 동기화 ⑤)
            const path =
              'exports/' +
              projectBackupFileName(appState.curSession.name, new Date());
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
              // 무음 실패였다(X13) — 사유를 알린다
              console.error('프로젝트 백업 파일 생성 실패:', e);
              appState.pushMessage(
                '프로젝트 백업 파일을 만들지 못했습니다' +
                  (e?.message ? `: ${e.message}` : '.'),
              );
              return;
            }
            appState.setProgressDialog(undefined);
            // 목적지 선택(드라이브 폴더/다운로드 폴더)은 공용층이 담당 — 폴더 미설정·
            // Android 는 기존과 같이 완료 창 + publishExport.
            await deliverExport(path, 'project', {
              doneText: '백업이 완료되었습니다.',
            });
            appState.setProgressDialog(undefined);
          }
        }
      },
    });
  }
  // 현재 프로젝트를 앱 내에서 복제한다. (이미지 포함/미포함 2택)
  // 결과적으로 "내보내기 후 재임포트"와 동일하며 기존 export/import 동작을 재사용한다.
  // 미포함 = cloneSessionShallow(얕은 직렬화 + 변형 씬·첨부 파일 동반, 2026-11-16)
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

    // 복제 이름 단일 규칙(2026-11-14 M2 C10) — 「X 복사본」→「X 복사본 (2)」(종전 「X Copy」). 묻지 않음·같은 폴더는 그대로
    const existing = sessionService.list();
    const newName = suggestFolderCopyName(cur.name, (n) => existing.includes(n));
    // 원본이 폴더 소속이면 같은 폴더에 복제
    const folder = sessionService.getFolderOf(cur.name);

    appState.setProgressDialog({ text: '프로젝트 복제 중...', done: 0, total: 1 });
    try {
      if (mode === 'shallow') {
        // 변형 씬·첨부 파일까지 복제(2026-11-16 — 종전 exportSessionShallow 기본값은 변형 씬을 버렸다)
        await sessionService.cloneSessionShallow(cur, newName);
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
  // 2026-10-02(B2): 미로드 프로젝트가 삭제되지 않고 미분류로 남던 결함 수정 — 절차는
  // folderDeleteFlow.ts. 전부 휴지통으로 보낸 것을 확인한 뒤에만 폴더를 지우고,
  // 실패한 프로젝트는 원래 폴더로 되돌린 뒤 이름과 사유를 알린다.
  async deleteFolderWithProjects(folder: string) {
    const leaf = sessionService.folderLeafName(folder);
    // 흐름 1회 실행(진행 창 포함) — 되돌리기 기록(2차 P1-b-3)이 흐름 전체를 한 항목으로 묶고, 다시 실행도 이 함수를 부른다.
    // 개별 프로젝트 삭제(deleteProjectForFolderFlow)는 따로 기록하지 않는다(이중 기록 금지).
    const run = async (): Promise<FolderDeleteResult> => {
      try {
        return await this.runFolderDeleteFlow(folder);
      } finally {
        appState.setProgressDialog(undefined);
      }
    };
    const result = await deleteFolderWithProjectsRecorded(folder, run);
    this.reportFolderDeleteResult(leaf, result);
  }

  private runFolderDeleteFlow(folder: string): Promise<FolderDeleteResult> {
    return runFolderDeleteWithProjects(folder, {
        projectsInFolder: (f) => sessionService.getProjectsInFolder(f),
        folderOf: (n) => sessionService.getFolderOf(n),
        ensureLoaded: async (n) => {
          await sessionService.get(n);
          return sessionService.isLoaded(n);
        },
        isLoaded: (n) => sessionService.isLoaded(n),
        moveToFolder: (n, f) => sessionService.moveToFolder(n, f),
        // 공통 관문(projectDeleteFlow): 현재 열린 프로젝트가 실제로 지워졌으면(메모리에서 내려감)
        // 닫는다 — 단일 삭제와 같은 규칙. 예외는 같은 메시지로 다시 던져 실패 사유에 남는다.
        deleteProject: async (n) => {
          await deleteProjectForFolderFlow(n);
        },
        deleteFolder: (f) => sessionService.deleteFolder(f),
        onProgress: (done, total) =>
          appState.setProgressDialog({ text: '프로젝트 삭제중..', done, total }),
      });
  }

  private reportFolderDeleteResult(leaf: string, result: FolderDeleteResult) {
    for (const f of result.failed) {
      console.error('폴더 일괄 삭제 실패:', f.name, f.reason);
    }
    if (result.failed.length === 0 && result.folderDeleted) {
      appState.pushMessage(
        `폴더 "${leaf}"와 ${result.deleted.length}개 프로젝트를 삭제했습니다. (휴지통에서 복구 가능)`,
      );
      return;
    }
    if (result.failed.length === 0) {
      appState.pushDialog({
        type: 'yes-only',
        text:
          `${result.deleted.length}개 프로젝트는 휴지통으로 옮겼지만 폴더 "${leaf}"는 지우지 못했습니다.\n` +
          (result.folderError ?? ''),
      });
      return;
    }
    const lines = result.failed.map((f) => `• ${f.name}: ${f.reason}`).join('\n');
    appState.pushDialog({
      type: 'yes-only',
      text:
        `${result.deleted.length}개 프로젝트를 휴지통으로 옮겼습니다.\n` +
        `아래 ${result.failed.length}개 프로젝트는 삭제하지 못해 폴더 "${leaf}"를 그대로 두었습니다.\n\n` +
        lines,
    });
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
    // 저장 대기 중인 프로젝트 편집을 먼저 디스크에(아래는 디스크 project.json 을 그대로 담는다 — 3-7).
    await this.flushProjectsBeforeBackup(names);
    let done = 0;
    // 빠진 것 알리기(P3): 읽지 못해 빠진 프로젝트 / 이미지 폴더 목록을 읽지 못한 프로젝트
    const skipped: string[] = [];
    const imagesUnread: string[] = [];
    for (const name of names) {
      try {
        const session = await sessionService.get(name);
        if (session) {
          let listFailed = false;
          const projEntries = await sessionService.buildSessionDeepEntries(
            session,
            name + '/',
            { onListError: () => (listFailed = true) },
          );
          entries.push(...projEntries);
          manifest.projects.push(name);
          if (listFailed) imagesUnread.push(name);
        } else {
          skipped.push(name);
        }
      } catch (e) {
        console.error('폴더 백업: 프로젝트를 읽지 못해 건너뜀:', name, e);
        skipped.push(name);
      }
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
      appState.pushMessage(e.message, 'error');
      return;
    }
    appState.setProgressDialog(undefined);
    // 완료 창은 옮기기(다운로드 폴더)가 끝난 뒤에 — 옮기기 실패를 「완료」 뒤에 묻지 않는다(P1).
    await this.publishThenShowDone(
      outPath,
      buildBackupDoneText({
        kind: 'folder',
        folder,
        includedCount: manifest.projects.length,
        skipped,
        imagesUnread,
      }),
    );
  }

  // 불러오기: 폴더 백업 아카이브를 선택 → 매니페스트 인식 → 폴더 새로 만들고 프로젝트 전체 복원.
  // 폴더 탭 / 프로젝트 메뉴 등 어디서나 호출 가능.
  // 2026-11-22: 한 번 풀어 종류를 가린다(models/backupKind.ts) — 전체·프로젝트 백업이면 안내 한 줄 뒤 그 흐름으로.
  async folderBackupImport() {
    const tarPath = await backend.selectFile();
    if (!tarPath) return;
    const ex = await this.extractBackupArchive(tarPath, '폴더 백업을 불러오는 중입니다...');
    if (!ex) return;
    await this.routeExtractedBackup('folder', tarPath, ex.tmpRoot, ex.detection);
  }

  // ===== 백업 tar 불러오기 공용(2026-11-22 백업 불러오기 견고화, models/backupKind.ts) =====
  // 백업 tar 를 받는 모든 경로(전체 백업 불러오기·handleTarImport·폴더 백업 불러오기·폴더 메뉴의 프로젝트 백업 불러오기·
  // 라이브러리 백업의 형식 불일치)가 이 둘을 쓴다: 한 번 풀기 → 종류 판정 → 종류에 맞는 기존 흐름.

  private async removeTmpDir(dir: string) {
    try {
      await backend.deleteDir(dir);
    } catch (e) {}
  }

  // 풀기(한 번) → 종류 판정. 풀기 실패면 그 임시 폴더를 지우고 안내한 뒤 null.
  private async extractBackupArchive(
    tarPath: string,
    progressText: string,
  ): Promise<{ tmpRoot: string; detection: BackupDetection } | null> {
    appState.setProgressDialog({ text: progressText, done: 0, total: 1 });
    const tmpRoot = 'tmp/' + v4();
    try {
      await backend.unzipFiles(tarPath, tmpRoot);
    } catch (e) {
      console.error('백업 파일 풀기 실패:', e);
      appState.setProgressDialog(undefined);
      await this.removeTmpDir(tmpRoot);
      appState.pushMessage(BACKUP_IMPORT_TEXT.unzipFailed);
      return null;
    }
    const detection = await detectBackupKind(tmpRoot, backend);
    appState.setProgressDialog(undefined);
    return { tmpRoot, detection };
  }

  // 판정 결과를 종류에 맞는 기존 흐름으로 넘긴다. tmpRoot(푼 임시 폴더 — 한 겹 벗겼으면 detection.root 의 바깥)는
  // 넘긴 흐름이 끝날 때 지우고, 여기서 끝낼 때(알 수 없음·새 버전)도 지운다. 매니페스트 version 검사는 종전 그대로.
  // project = 프로젝트 백업을 받는 방식이 다른 경로(폴더 메뉴 — 이름을 먼저 받음)만 넘긴다. 없으면 공용 프로젝트 흐름.
  private async routeExtractedBackup(
    entry: BackupImportEntry,
    tarPath: string,
    tmpRoot: string,
    d: BackupDetection,
    opts: { project?: (root: string, cleanupDir: string) => Promise<void> } = {},
  ): Promise<void> {
    const plan = planBackupRoute(entry, d.kind);
    if (plan.action === 'unknown') {
      await this.removeTmpDir(tmpRoot);
      appState.pushMessage(BACKUP_IMPORT_TEXT.unknownKind);
      return;
    }
    if ((d.kind === 'full' || d.kind === 'folder') && !this.guardManifestVersion(d.manifest)) {
      await this.removeTmpDir(tmpRoot);
      return;
    }
    if (plan.notice) appState.pushMessage(plan.notice);
    try {
      if (d.kind === 'full') {
        await this.continueFullBackupImport(d.root, d.manifest, tmpRoot);
      } else if (d.kind === 'folder') {
        await this.restoreFolderBackupFromDir(d.root, d.manifest, tmpRoot);
      } else if (opts.project) {
        await opts.project(d.root, tmpRoot);
      } else {
        await this.importProjectBackupFromDir(d.root, fileStemOf(tarPath), tmpRoot);
      }
    } catch (e) {
      // 각 흐름은 스스로 정리하지만, 예상 밖 예외로 빠져나와도 임시 폴더를 남기지 않는다
      await this.removeTmpDir(tmpRoot);
      throw e;
    }
  }

  // 매니페스트 version 상한 검사 — 초과 시 안내 메시지를 띄우고 false.
  // 호출부는 false 면 임시 디렉터리 정리 후 복원을 중단해야 한다.
  private guardManifestVersion(manifest: any): boolean {
    const v = manifest?.version;
    if (typeof v === 'number' && v > SUPPORTED_MANIFEST_VERSION) {
      appState.pushMessage(
        '이 백업은 더 새로운 버전의 SDStudio에서 만들어졌습니다. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.',
      );
      return false;
    }
    return true;
  }

  // (폴더 백업 매니페스트 판정은 2026-11-22 부터 models/backupKind.isFolderBackupManifest — 같은 기준)

  // 이미 추출된 디렉터리(root)와 매니페스트로 폴더와 하위 프로젝트를 복원한다.
  // (folderBackupImport / 드래그&드롭 임포트가 공용으로 사용)
  // cleanupDir = 끝날 때 지울 임시 폴더(한 겹 벗긴 경우 root 의 바깥, 2026-11-22). 기본 root.
  private async restoreFolderBackupFromDir(root: string, manifest: any, cleanupDir: string = root) {
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
      try { await backend.deleteDir(cleanupDir); } catch (e2) {}
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
      appState.setProgressDialog({ text: '프로젝트 불러오는 중..', done, total });
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
    try { await backend.deleteDir(cleanupDir); } catch (e) {}

    appState.setProgressDialog(undefined);
    appState.pushDialog({
      type: 'yes-only',
      text: `폴더 "${folderName}"(으)로 ${restored}/${total}개 프로젝트를 불러왔습니다.`,
    });
  }

  // ===== 라이브러리 단위 백업/복원 (글로벌 프리셋 · 작가 라이브러리) =====

  private async libraryBackupExport(opts: {
    label: string;
    manifestType: string;
    fileBase: 'global-presets' | 'artist-library' | 'project-templates';
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
    const outPath = 'exports/' + syncFileName(opts.fileBase, new Date(), 'tar');
    try {
      await zipService.zipFiles(entries, outPath);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage(e.message, 'error');
      return;
    }
    appState.setProgressDialog(undefined);
    try {
      await deliverExport(outPath, opts.fileBase, {
        doneText: `${opts.label} 백업이 완료되었습니다.`,
      });
    } catch (e) {}
  }

  // 복원은 공용 불러오기 흐름(importFlow.ts)을 따른다: 파일 고르기 → (동명이 있으면)
  // 정책 선택 → (덮어쓰기면) 확인 1회 → 적용 → 「추가 · 갱신 · 건너뜀」 안내.
  // 내부 병합 규칙(새 id·(2) 접미·덮어쓰기=삭제 후 추가)은 각 서비스 기존 그대로.
  private async libraryBackupImport(opts: {
    label: string;
    // 덮어쓰기 확인 문구의 항목 이름(예: '작가'). 없으면 label.
    itemLabel?: string;
    manifestType: string;
    // 덮어쓰기 확인의 보호 방식 문구. 없으면 「영구 삭제된 뒤 … 교체」(글로벌 프리셋·작가).
    protection?: string;
    // PC 파일 선택기 확장자 필터(선택). Android 선택기는 이미 tar 전용.
    filters?: { name: string; extensions: string[] }[];
    // 압축 해제된 백업의 항목 이름 목록(충돌 개수 계산용). 실패 시 개수 미상으로 묻는다.
    incomingNames: (root: string) => Promise<string[]>;
    existingNames: () => string[];
    restore: (
      root: string,
      policy: ImportPolicy,
    ) => Promise<{ added: number; skipped: number; overwritten: number }>;
    // 이미 고른 파일(드라이브에서 받은 tar 등, 절대 경로). 있으면 파일 선택기를 건너뛴다(드라이브 API ③).
    pickedPath?: string;
  }) {
    let tarPath = opts.pickedPath;
    if (!tarPath) {
      // PC 는 드라이브 동기화 폴더가 설정돼 있으면 그 폴더에서 선택기를 연다(모바일 무시).
      const syncFolder = await getSyncFolder();
      const selectOptions = {
        ...(syncFolder ? { defaultPath: syncFolder } : {}),
        ...(opts.filters ? { filters: opts.filters } : {}),
      };
      tarPath = await backend.selectFile(
        Object.keys(selectOptions).length ? selectOptions : undefined,
      );
    }
    if (!tarPath) return;
    appState.setProgressDialog({ text: '백업을 확인하는 중..', done: 0, total: 1 });
    const root = 'tmp/' + v4();
    try {
      await backend.unzipFiles(tarPath, root);
    } catch (e) {
      console.error('라이브러리 백업 풀기 실패:', e);
      appState.setProgressDialog(undefined);
      await this.removeTmpDir(root); // 풀다 만 임시 폴더를 남기지 않는다(2026-11-22)
      appState.pushMessage(BACKUP_IMPORT_TEXT.unzipFailed);
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
      // 이 라이브러리 백업이 아니어도 전체·폴더·프로젝트 백업이면 안내 한 줄 뒤 그 흐름으로(같은 임시 폴더, 2026-11-22)
      const detection = await detectBackupKind(root, backend);
      if (detection.kind !== 'unknown') {
        await this.routeExtractedBackup('library', tarPath, root, detection);
        return;
      }
      await cleanup();
      appState.pushMessage(`${opts.label} 백업 파일이 아닙니다.`);
      return;
    }
    if (!this.guardManifestVersion(manifest)) {
      await cleanup();
      return;
    }
    let conflictCount: number | undefined;
    try {
      conflictCount = countNameConflicts(
        await opts.incomingNames(root),
        opts.existingNames(),
      );
    } catch (e) {
      conflictCount = undefined; // 개수를 모르면 묻는다(restore 가 형식 오류를 알린다)
    }
    const policy = await askImportPolicyWithConfirm({
      label: opts.label,
      itemLabel: opts.itemLabel,
      conflictCount,
      protection: opts.protection ?? IMPORT_FLOW_TEXT.protection.replaceDeleted,
    });
    if (!policy) {
      await cleanup();
      return;
    }
    appState.setProgressDialog({ text: '백업 불러오는 중..', done: 0, total: 1 });
    let res: { added: number; skipped: number; overwritten: number };
    try {
      res = await opts.restore(root, policy);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      await cleanup();
      appState.pushMessage('백업 불러오기 실패: ' + (e.message || e));
      return;
    }
    appState.setProgressDialog(undefined);
    await cleanup();
    notifyImportDone(opts.label, librarySummary(res));
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

  // 불러오기 출처 선택(드라이브 API ③). pickedPath 가 없고 PC 가 Google 드라이브에 연결돼 있으면
  // [Google 드라이브 / 파일]을 묻는다. 드라이브면 백업 관리 창(고르기)으로 넘기고 false,
  // 파일(또는 미연결·Android)이면 true — 호출부는 기존 파일 흐름을 그대로 계속한다.
  private async continueWithFileSource(
    kind: DriveExportKind,
    opts: LibraryImportOptions,
  ): Promise<boolean> {
    if (opts.pickedPath) return true;
    const source = await chooseImportSource(kind);
    if (source === 'drive') await importFromDrive(kind);
    return source === 'file';
  }

  async globalPresetBackupImport(opts: LibraryImportOptions = {}) {
    if (!(await this.continueWithFileSource('global-presets', opts))) return;
    await this.libraryBackupImport({
      pickedPath: opts.pickedPath,
      label: '글로벌 프리셋',
      manifestType: 'sdstudio-global-presets',
      incomingNames: (root) =>
        readBackupNames(root + '/global_presets.json', 'presets'),
      existingNames: () => globalPresetService.presets.map((p) => p.name),
      // 덮어쓰기의 기존 항목은 휴지통으로(2026-11-24 — 종전 「영구 삭제된 뒤 교체」)
      protection: IMPORT_FLOW_TEXT.protection.trashReplaced,
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

  async artistLibraryBackupImport(opts: LibraryImportOptions = {}) {
    if (!(await this.continueWithFileSource('artist-library', opts))) return;
    await this.libraryBackupImport({
      pickedPath: opts.pickedPath,
      label: '작가 라이브러리',
      itemLabel: '작가',
      manifestType: 'sdstudio-artist-library',
      incomingNames: (root) =>
        readBackupNames(root + '/artist_library.json', 'artists'),
      existingNames: () => artistLibraryService.artists.map((a) => a.name),
      restore: (root, policy) =>
        artistLibraryService.restoreFromBackupDir(root, policy),
    });
  }

  // 프로젝트 템플릿 백업(드라이브 동기화 ④) — 전역 템플릿만 담는다(폴더 전용 로컬
  // 템플릿·배지 색 제외, 형식은 projectTemplateBackup.ts). 저장 파일 대신 메모리 목록을
  // 앱 파일과 같은 형식으로 임시 파일에 써서 담는다(폴더 로컬 항목을 걸러야 하므로).
  async projectTemplateBackupExport() {
    await projectTemplateService.ensureLoaded();
    const { store, imageFiles } = buildTemplateBackupStore(
      projectTemplateService.list(),
    );
    let tmpStore: string | undefined;
    try {
      await this.libraryBackupExport({
        label: PROJECT_TEMPLATE_BACKUP.label,
        manifestType: PROJECT_TEMPLATE_BACKUP.manifestType,
        fileBase: 'project-templates',
        isEmpty: store.templates.length === 0,
        buildEntries: async () => {
          tmpStore = 'tmp/' + v4() + '.json';
          await backend.writeFile(tmpStore, JSON.stringify(store));
          const entries: { path: string; name: string }[] = [
            { path: tmpStore, name: PROJECT_TEMPLATE_BACKUP.storeName },
          ];
          for (const file of imageFiles) {
            const p = projectTemplateService.getImagePath(file);
            try {
              if (await backend.existFile(p)) {
                entries.push({
                  path: p,
                  name: PROJECT_TEMPLATE_BACKUP.imageDir + '/' + file,
                });
              }
            } catch (e) {}
          }
          return entries;
        },
      });
    } finally {
      if (tmpStore) {
        try {
          await backend.deleteFile(tmpStore);
        } catch (e) {}
      }
    }
  }

  // 덮어쓰기 = 같은 이름 전역 템플릿의 id 를 유지한 채 내용만 갱신(폴더 기본 템플릿
  // 지정·적용 기록 참조 보존 — ProjectTemplateService.restoreFromBackupDir).
  async projectTemplateBackupImport(opts: LibraryImportOptions = {}) {
    if (!(await this.continueWithFileSource('project-templates', opts))) return;
    await projectTemplateService.ensureLoaded();
    await this.libraryBackupImport({
      pickedPath: opts.pickedPath,
      label: PROJECT_TEMPLATE_BACKUP.label,
      manifestType: PROJECT_TEMPLATE_BACKUP.manifestType,
      protection: IMPORT_FLOW_TEXT.protection.keepId,
      filters: [{ name: 'SDStudio 백업 (tar)', extensions: ['tar'] }],
      incomingNames: async (root) =>
        readBackupTemplates(
          JSON.parse(
            await backend.readFile(root + '/' + PROJECT_TEMPLATE_BACKUP.storeName),
          ),
        ).map((t) => t.name),
      existingNames: () => globalTemplateNames(projectTemplateService.list()),
      restore: (root, policy) =>
        projectTemplateService.restoreFromBackupDir(root, policy),
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
      const ok = await appState.confirmAsync(
        `이미지를 포함한 전체 백업의 예상 용량은 약 ${fmt(bytes)} 입니다.\n용량이 클 수 있으니 저장 공간을 확인하세요.\n계속할까요?`,
        '계속 진행',
      );
      if (!ok) return;
    }

    const entries: { path: string; name: string }[] = [];
    const projects: { name: string; folder: string | null }[] = [];
    // 빠진 것 알리기(P3): 읽지 못해 빠진 프로젝트 / 이미지 폴더 목록을 읽지 못한 프로젝트
    const skipped: string[] = [];
    const imagesUnread: string[] = [];

    if (mode !== 'settings') {
      appState.setProgressDialog({
        text: '백업 생성중..',
        done: 0,
        total: allNames.length,
      });
      // 저장 대기 중인 프로젝트 편집을 먼저 디스크에(아래는 디스크 project.json 을 그대로 담는다 — 3-7).
      await this.flushProjectsBeforeBackup(allNames);
      let done = 0;
      for (const name of allNames) {
        try {
          const session = await sessionService.get(name);
          if (session) {
            let listFailed = false;
            let projEntries = await sessionService.buildSessionDeepEntries(
              session,
              name + '/',
              {
                // 이미지 제외 모드는 생성 이미지(outs/inpaints) 목록 실패를 셀 필요가 없다(담지 않음).
                onListError: (kind) => {
                  if (mode === 'noimg' && (kind === 'outs' || kind === 'inpaints')) return;
                  listFailed = true;
                },
              },
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
            if (listFailed) imagesUnread.push(name);
          } else {
            skipped.push(name);
          }
        } catch (e) {
          console.error('전체 백업: 프로젝트를 읽지 못해 건너뜀:', name, e);
          skipped.push(name);
        }
        appState.setProgressDialog({
          text: '백업 생성중..',
          done: ++done,
          total: allNames.length,
        });
      }
    }

    // 전역 설정 (모든 모드 포함)
    appState.setProgressDialog({ text: '설정 수집중..', done: 0, total: 1 });
    // 저장 대기 중인 편집(디바운스 2초 등)을 먼저 디스크에 — 아래는 디스크 파일을 그대로 담는다(2026-11-18 T1).
    // 바뀐 것만 쓰고, 읽지 않은(프로젝트 템플릿 등)·읽기 실패로 막힌 저장소는 쓰지 않아 디스크 파일이 그대로 정본이다.
    try {
      await flushGlobalStoresNow();
    } catch (e) {
      console.error('전체 백업 전 글로벌 저장소 저장 실패(디스크 파일 그대로 담음):', e);
    }
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
      appState.pushMessage(e.message, 'error');
      return;
    }
    appState.setProgressDialog(undefined);
    // 완료 창은 옮기기(다운로드 폴더)가 끝난 뒤에 — 예전에는 먼저 띄우고 옮기기 오류를 삼켰다(P1).
    await this.publishThenShowDone(
      outPath,
      buildBackupDoneText({
        kind: 'full',
        mode,
        includedCount: projects.length,
        skipped,
        imagesUnread,
      }),
    );
  }

  // 백업 담기 직전, 저장 대기 중인 프로젝트 편집을 디스크에 반영한다(2026-11-22 호환 3-7).
  // 대상 = 저장 대기(dirty) + 지금 열린 프로젝트만 — 바뀌지 않은 프로젝트는 다시 쓰지 않는다
  // (앱 종료 flush 와 같은 범위). 쓰기는 flushProjectNow(= writeResource 단일 지점·손실 가드 +
  // persistService.flushPath)로만, withLock 은 잡지 않는다. 실패는 담기를 막지 않는다(디스크 파일 그대로 — 종전과 같음).
  private async flushProjectsBeforeBackup(names: string[]) {
    const wanted = new Set(names);
    const targets = new Set<string>();
    try {
      for (const n of sessionService.dirtyNames()) if (wanted.has(n)) targets.add(n);
      const cur = appState.curSession?.name;
      if (cur && wanted.has(cur) && sessionService.isLoaded(cur)) targets.add(cur);
    } catch (e) {
      return;
    }
    for (const n of targets) {
      try {
        await sessionService.flushProjectNow(n);
      } catch (e) {
        console.error('백업 전 프로젝트 저장 실패(디스크 파일 그대로 담음):', n, e);
      }
    }
  }

  // 내보내기 산출물을 다운로드 폴더(또는 플랫폼의 기본 목적지)로 옮긴 뒤 완료 창을 띄운다.
  // 옮기기 실패: Android 의 크기 확인 실패는 backend 가 이미 창으로 알렸으므로 다시 알리지 않는다.
  // 그 밖의 오류는 사유를 알린다. 어느 쪽이든 백업 내용 안내(빠진 것 등)는 띄우지 않는다 —
  // 파일이 사용자 손에 닿지 않았으므로 다시 만들 때 다시 보게 된다.
  private async publishThenShowDone(outPath: string, doneText: string) {
    try {
      await backend.publishExport(outPath);
    } catch (e: any) {
      if (!isNotifiedExportTransferError(e)) {
        console.error('백업 파일 옮기기 실패:', e);
        appState.pushDialog({
          type: 'yes-only',
          text: BACKUP_EXPORT_TEXT.moveFailed(e?.message ? String(e.message) : ''),
        });
      }
      return;
    }
    appState.pushDialog({ type: 'yes-only', text: doneText });
  }

  // 전역 설정 파일 + 글로벌 이미지 디렉터리를 __settings__/ 네임스페이스 엔트리로.
  private async buildSettingsEntries(): Promise<
    { path: string; name: string }[]
  > {
    const entries: { path: string; name: string }[] = [];
    for (const file of fullBackupSettingsFiles()) {
      try {
        if (await backend.existFile(file)) {
          entries.push({ path: file, name: '__settings__/' + file });
        }
      } catch (e) {}
    }
    for (const dir of fullBackupSettingsImageDirs()) {
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

  // 2026-11-22: 한 번 풀어 종류를 가린다(models/backupKind.ts) — 폴더·프로젝트 백업이면 안내 한 줄 뒤 그 흐름으로.
  // 전체 백업은 어느 경로로 들어오든 아래 continueFullBackupImport 의 확인 단계를 거친다.
  async fullBackupImport() {
    const tarPath = await backend.selectFile();
    if (!tarPath) return;
    const ex = await this.extractBackupArchive(tarPath, '백업을 확인하는 중입니다...');
    if (!ex) return;
    await this.routeExtractedBackup('full', tarPath, ex.tmpRoot, ex.detection);
  }

  // 판정·version 검사를 마친 전체 백업(root = 매니페스트가 있는 뿌리)의 확인 창·정책 선택 → 복원.
  // cleanupDir = 끝날 때 지울 임시 폴더(한 겹 벗긴 경우 root 의 바깥). 기본 root.
  private async continueFullBackupImport(root: string, manifest: any, cleanupDir: string = root) {
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
        await backend.deleteDir(cleanupDir);
      } catch (e) {}
    };

    // 설정만 모드: 충돌 정책 불필요 — 병합만.
    if (mode === 'settings') {
      const ok = await appState.confirmAsync(
        '설정 백업을 불러옵니다.\n현재 데이터는 보존되며, 백업의 설정이 병합됩니다(덮어쓰지 않음).\n계속할까요?',
        '계속 진행',
      );
      if (!ok) {
        await cleanup();
        return;
      }
      await this.restoreFullBackupFromDir(root, manifest, mode, 'rename', cleanupDir);
      return;
    }

    // 전체/이미지제외: 동명 프로젝트 처리 방식 선택.
    // 단, 이미지 없는 백업(noimg)은 덮어쓰기 금지 — 기존 이미지가 사라지고
    // 이미지 없는 버전으로 대체돼 순손실이 되기 때문.
    const policyItems: DialogItem[] = [
      { text: '동명은 새 이름 (2)로 불러오기 (권장)', value: 'rename' },
      { text: '동명은 건너뛰기', value: 'skip' },
    ];
    if (mode !== 'noimg') {
      policyItems.push({
        text: '⚠️ 동명을 덮어쓰기 (기존 영구 삭제)',
        value: 'overwrite',
        danger: true,
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
    if (!choice) {
      await cleanup();
      return;
    }
    const policy = choice as 'rename' | 'skip' | 'overwrite';

    // 덮어쓰기는 파괴적 — 빨강 선택지(위) + 영구 삭제 확인 1회(Enter 로 확정하지 않음, 2026-10-03 D1).
    // 예전의 1항목 선택 창 2연속을 하나로 줄였다(영구 삭제 전 명시 확인 1회는 유지).
    if (policy === 'overwrite') {
      const ok = await appState.confirmAsync({
        text:
          '⚠️ 덮어쓰기: 이름이 같은 기존 프로젝트와 그 이미지가 영구 삭제되고 백업으로 대체됩니다.\n' +
          '이 작업은 되돌릴 수 없습니다. 정말로 진행할까요?',
        confirmText: '덮어쓰기',
        danger: 'permanent',
      });
      if (!ok) {
        await cleanup();
        return;
      }
    }

    await this.restoreFullBackupFromDir(root, manifest, mode, policy, cleanupDir);
  }

  private async restoreFullBackupFromDir(
    root: string,
    manifest: any,
    mode: 'full' | 'noimg' | 'settings',
    policy: 'rename' | 'skip' | 'overwrite',
    cleanupDir: string = root,
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
        // 덮어쓰기에서 기존 프로젝트를 지우지 못해 건너뛴 이름(2026-10-02 S4)
        const overwriteBlocked: string[] = [];
        // 가져오기 실패한 이름 — 덮어쓰기에서 지운 뒤 실패한 것은 따로(2026-11-22 결과 창 안내. 지우는 순서는 그대로)
        const failed: string[] = [];
        const overwriteFailed: string[] = [];
        // 씬 템플릿 지정 되살리기용(2026-11-18 T1): 실제로 들어온 프로젝트(원래 이름 → 최종 이름)와 덮어쓰기 전 지정 상태
        const incoming: FullBackupIncomingProject[] = [];
        const preOverwrite: Record<string, PreOverwriteDesignation> = {};
        for (const p of projects) {
          const origName = typeof p === 'string' ? p : p.name;
          const folder = typeof p === 'string' ? null : p.folder ?? null;
          if (!origName) {
            done++;
            continue;
          }
          appState.setProgressDialog({ text: '프로젝트 불러오는 중..', done, total });
          let pname = origName;
          let kind: FullBackupIncomingProject['kind'] = 'added';
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
              // 삭제가 확인(목록에서 사라짐)된 뒤에만 가져온다 — 다른 창 잠금·불러오기 실패로
              // 지워지지 않았는데 가져오면 살아 있는 프로젝트에 병합되고, 복사 실패 롤백이
              // 그 폴더를 지울 수 있다(2026-10-02 S4, models/fullBackupOverwrite.ts).
              // 지우기 전 지정 상태를 떠 둔다(읽기만) — 지정 정보가 없는 예전 백업이면 이 상태로 되살린다(2026-11-18 T1)
              let pre: PreOverwriteDesignation | null = null;
              try {
                pre = await templateService.designationOf(origName);
              } catch (e) {
                pre = null;
              }
              const cleared = await clearForFullBackupOverwrite(origName, {
                listNames: () => sessionService.list(),
                beforeRemove: (name) => {
                  if (appState.curSession?.name === name) {
                    appState.curSession = undefined;
                  }
                },
                // 휴지통 관문(projectDeleteFlow — 닫기는 위 beforeRemove 가 이미 함)
                remove: async (name) => {
                  await deleteProjectForReplaceFlow(name);
                },
                purge: (name) => trashService.permanentlyDeleteProject(name),
              });
              if (cleared.kind === 'blocked') {
                overwriteBlocked.push(origName);
                done++;
                continue;
              }
              // 「덮어씀」은 가져오기까지 성공한 것만 센다(아래, 2026-11-22)
              pname = origName;
              kind = 'overwritten';
              if (pre) preOverwrite[origName] = pre;
            } else {
              // rename: 빈 이름이 나올 때까지 (n) 부여
              let j = 2;
              while (sessionService.list().includes(pname)) {
                pname = `${origName} (${j})`;
                j++;
              }
              kind = 'renamed';
            }
          }
          try {
            await sessionService.importSessionDeepFromDir(
              root + '/' + origName,
              pname,
            );
            incoming.push({ origName, finalName: pname, kind });
            if (folder && sessionService.listFolders().includes(folder)) {
              try {
                await sessionService.moveToFolder(pname, folder);
              } catch (e) {}
            }
            restored++;
            if (kind === 'overwritten') overwritten++;
          } catch (e) {
            console.error('백업 프로젝트 복원 실패:', origName, e);
            if (kind === 'overwritten') overwriteFailed.push(origName);
            else failed.push(origName);
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
        const merged = await this.mergeSettingsFromDir(
          root + '/__settings__',
          incoming.filter((p) => p.kind === 'renamed').map((p) => p.origName),
        );
        const templates = await this.restoreTemplatesFromDir(
          root + '/__settings__',
          mode,
          incoming,
          preOverwrite,
        );
        appState.setProgressDialog(undefined);
        appState.pushDialog({
          type: 'yes-only',
          text: fullBackupResultText({
            settingsOnly: false,
            total,
            restored,
            skipped,
            overwritten,
            overwriteBlocked,
            failed,
            overwriteFailed,
            renamedWithMarks: merged.renamedWithMarks,
            libraries: [...merged.libraries, ...templates.libraries],
            templateNote: templates.note,
          }),
        });
      } else {
        appState.setProgressDialog({ text: '설정 병합중..', done: 0, total: 1 });
        const merged = await this.mergeSettingsFromDir(root + '/__settings__', []);
        const templates = await this.restoreTemplatesFromDir(
          root + '/__settings__',
          mode,
          [],
          {},
        );
        appState.setProgressDialog(undefined);
        appState.pushDialog({
          type: 'yes-only',
          text: fullBackupResultText({
            settingsOnly: true,
            total: 0,
            restored: 0,
            skipped: 0,
            overwritten: 0,
            overwriteBlocked: [],
            failed: [],
            overwriteFailed: [],
            renamedWithMarks: 0,
            libraries: [...merged.libraries, ...templates.libraries],
            templateNote: templates.note,
          }),
        });
      }
    } finally {
      try {
        await backend.deleteDir(cleanupDir);
      } catch (e) {}
    }
  }

  // 설정 병합: 디스크 실데이터가 진실. 현재 값을 덮어쓰지 않고(union/fill),
  // 실재하지 않는 프로젝트/폴더 참조는 버린다(prune). trash.json/folderOrder는 제외.
  // 반환(2026-11-22 결과 창 안내 — 병합 동작은 그대로):
  //  · libraries = 글로벌 라이브러리 받음/받지 않음(adoptGlobalsIfEmpty)
  //  · renamedWithMarks = renamedOrigNames(새 이름 「이름 (2)」로 들어온 프로젝트의 백업 쪽 원래 이름) 중 백업에
  //    즐겨찾기·썸네일·북마크 표시가 있던 수 — 이 병합은 원래 이름 기준이라 새 이름 쪽으로는 옮겨지지 않는다(조사 P8)
  private async mergeSettingsFromDir(
    dir: string,
    renamedOrigNames: readonly string[] = [],
  ): Promise<{ libraries: FullBackupLibraryOutcome[]; renamedWithMarks: number }> {
    const readJson = async (name: string): Promise<any | null> => {
      try {
        return JSON.parse(await backend.readFile(dir + '/' + name));
      } catch (e) {
        return null;
      }
    };
    const existingProjects = new Set(sessionService.list());
    const existingFolders = new Set(sessionService.listFolders());
    const renamed = new Set(renamedOrigNames);
    const marked = new Set<string>();
    const markIfRenamed = (proj: unknown) => {
      if (typeof proj === 'string' && renamed.has(proj)) marked.add(proj);
    };

    // 즐겨찾기: 존재하는 프로젝트만 union
    try {
      const fav = await readJson('favorites.json');
      if (Array.isArray(fav)) {
        fav.forEach(markIfRenamed);
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
          if (ref) markIfRenamed(proj);
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
          if (b) markIfRenamed(proj);
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
          if (filename) markIfRenamed(proj);
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
    const libraries = await this.adoptGlobalsIfEmpty(dir);

    // trash.json, folderOrder.json: 설정 병합에서 의도적으로 제외
    return { libraries, renamedWithMarks: marked.size };
  }

  /**
   * 프로젝트 템플릿(받는 쪽이 비어 있을 때만 통째 채택) → 씬 템플릿 지정·숨김·퀵 생성·폴더 기본 템플릿·적용 기록(받는 쪽에
   * 합치기) 순서로 되살린다(2026-11-18 T1). 템플릿 id 실존 판단이 채택 뒤 목록을 쓰므로 순서를 바꾸지 않는다.
   * 새 파일이 없는 예전 백업은 그 부분만 건너뛴다. 반환 note = 완료 창에 덧붙일 줄(없으면 빈 배열), libraries = 받는 쪽에
   * 이미 있어 받지 않은 프로젝트 템플릿(2026-11-22 — 받음·막힘은 note 가 알린다). 던지지 않는다.
   */
  private async restoreTemplatesFromDir(
    dir: string,
    mode: 'full' | 'noimg' | 'settings',
    incoming: FullBackupIncomingProject[],
    preOverwrite: Record<string, PreOverwriteDesignation>,
  ): Promise<{ note: string[]; libraries: FullBackupLibraryOutcome[] }> {
    let adopt: FullBackupTemplateAdoptOutcome = { kind: 'none' };
    try {
      adopt = await projectTemplateService.adoptFromFullBackupIfEmpty(dir);
    } catch (e) {
      console.error('전체 백업 프로젝트 템플릿 복원 실패:', e);
    }
    let backupText: string | null = null;
    try {
      if (await backend.existFile(dir + '/' + TEMPLATES_SIDECAR_FILE)) {
        backupText = await backend.readFile(dir + '/' + TEMPLATES_SIDECAR_FILE);
      }
    } catch (e) {
      backupText = null; // 못 읽으면 지정 정보 없는 예전 백업처럼(덮어쓴 프로젝트는 덮어쓰기 전 상태 유지)
    }
    let designation: FullBackupTemplatesOutcome = { kind: 'none' };
    try {
      designation = await templateService.restoreFromFullBackup({
        backupText,
        mode,
        incoming,
        preOverwrite,
      });
    } catch (e) {
      console.error('전체 백업 씬 템플릿 지정 복원 실패:', e);
    }
    const note = fullBackupTemplateNote({
      sceneTemplates: designation.kind === 'applied' ? designation.counts.sceneTemplates : 0,
      projectTemplates: adopt.kind === 'adopted' ? adopt.count : 0,
      designationSkipped: designation.kind === 'blocked',
      projectTemplatesSkipped: adopt.kind === 'blocked',
    });
    const libraries: FullBackupLibraryOutcome[] =
      adopt.kind === 'kept' ? [{ kind: 'projectTemplates', result: 'kept', count: adopt.count }] : [];
    return { note, libraries };
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
    // 채택 규칙은 종전 그대로(받는 쪽이 정상으로 읽은 빈 목록일 때만 통째로 — 「비어 있음」이 읽기 실패 때문이면(loadFailed)
    // 본 파일을 덮지 않는다, storeFile 묶음 1). 2026-11-22: 결과 창 안내용으로 종류별 결과와 백업 쪽 항목 수를 돌려준다
    // (백업에 그 파일이 없으면 결과 없음).
    const outcomes: FullBackupLibraryOutcome[] = [];
    const adoptOne = async (o: {
      kind: Exclude<FullBackupLibraryKind, 'projectTemplates'>;
      file: string;
      imagesDir?: string;
      loadFailed: () => boolean;
      isEmpty: () => boolean;
      load: () => Promise<void>;
    }) => {
      let count: number | undefined;
      try {
        if (!(await backend.existFile(dir + '/' + o.file))) return;
        try {
          count = countBackupLibraryItems(o.kind, await backend.readFile(dir + '/' + o.file));
        } catch (e) {
          count = undefined;
        }
        if (o.loadFailed()) {
          outcomes.push({ kind: o.kind, result: 'blocked', count });
          return;
        }
        if (!o.isEmpty()) {
          outcomes.push({ kind: o.kind, result: 'kept', count });
          return;
        }
        if (o.imagesDir) await copyImages(o.imagesDir);
        await backend.copyFile(dir + '/' + o.file, o.file);
        await o.load();
        outcomes.push({ kind: o.kind, result: 'adopted', count });
      } catch (e) {
        console.error('전체 백업 글로벌 라이브러리 받기 실패:', o.file, e);
        outcomes.push({ kind: o.kind, result: 'error', count });
      }
    };
    // 글로벌 프리셋
    await adoptOne({
      kind: 'globalPresets',
      file: 'global_presets.json',
      imagesDir: 'global_vibes',
      loadFailed: () => globalPresetService.loadFailed,
      // 휴지통에 남은 항목이 있으면 비어 있지 않다(2026-11-24) — 파일을 통째로 받으면 지금 휴지통이 지워진다
      isEmpty: () => globalPresetService.list().length === 0 && globalPresetService.trash.length === 0,
      load: () => globalPresetService.load(),
    });
    // 글로벌 프롬프트 조각
    await adoptOne({
      kind: 'globalPieces',
      file: 'global_pieces.json',
      loadFailed: () => globalPieceService.loadFailed,
      isEmpty: () => globalPieceService.library.size === 0,
      load: () => globalPieceService.load(),
    });
    // 글로벌 캐릭터 프리셋
    await adoptOne({
      kind: 'globalCharacterPresets',
      file: 'global_character_presets.json',
      imagesDir: 'global_char_images',
      loadFailed: () => globalCharacterPresetService.loadFailed,
      // 휴지통에 남은 항목이 있으면 비어 있지 않다(2026-11-24)
      isEmpty: () =>
        globalCharacterPresetService.presets.length === 0 &&
        globalCharacterPresetService.trash.length === 0,
      load: () => globalCharacterPresetService.load(),
    });
    return outcomes;
  }

  async folderImportDeep(folder: string) {
    const inputValue = await promptName({
      title: '새로운 프로젝트 이름을 입력해주세요',
      ...projectNameRules(sessionService),
    });
    if (!inputValue) return;
    const tarPath = await backend.selectFile();
    if (!tarPath) return;
    // 2026-11-22: 한 번 풀어 종류를 가린다(models/backupKind.ts). 프로젝트 백업이면 종전처럼 받은 이름으로 이 폴더에,
    // 폴더·전체 백업이면 안내 한 줄 뒤 그 흐름으로(받은 이름은 쓰지 않음), 알 수 없으면 원시 오류 대신 안내.
    const progressText = '프로젝트 백업을 불러오는 중입니다...';
    const ex = await this.extractBackupArchive(tarPath, progressText);
    if (!ex) return;
    await this.routeExtractedBackup('folderDeep', tarPath, ex.tmpRoot, ex.detection, {
      project: async (root, cleanupDir) => {
        appState.setProgressDialog({ text: progressText, done: 0, total: 1 });
        try {
          await sessionService.importSessionDeepFromDir(root, inputValue);
        } catch (e: any) {
          appState.setProgressDialog(undefined);
          appState.pushMessage(nameErrorMessage(e, 'project', inputValue), 'error');
          return;
        } finally {
          // 복사 방식이므로 성공/실패와 무관하게 임시 추출물을 정리한다(종전 importSessionDeep 과 같음)
          await this.removeTmpDir(cleanupDir);
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

  // 폴더 일괄 이미지 내보내기: 프로젝트별 이미지를 프로젝트별 하위 폴더(프로젝트 이름)로 나눠 한 결과로
  // (압축파일 하나 또는 출력 폴더 하나). 옵션은 폴더당 1회만 입력(프리셋 지원).
  // 2026-11-16 M5 묶음 b-2: 프로젝트마다 프로젝트 이미지 내보내기와 같은 단계 함수
  // (exportPresetService.buildExportImageList → optimizeExportImages → deliverExportImages)를 같은 옵션으로 부른다 —
  // 파일명 패턴·출력 형태·목표 폴더·화질·스테가노그래피 보존·특수문자 자동 변환·재최적화 정책, 캐릭터 접두/접미사는
  // 각 프로젝트의 적용 캐릭터 프리셋 기준(종전 = 지금 열린 프로젝트 기준으로 모든 프로젝트에 붙던 결함).
  async folderExportImages(folder: string) {
    const names = sessionService.getProjectsInFolder(folder);
    if (names.length === 0) {
      appState.pushMessage('폴더에 프로젝트가 없습니다.');
      return;
    }
    // 폴더 내 모든 프로젝트의 씬 이름(생성·변형) — 특수문자 변환 질의·머리 안내 개수용. 직접 설정 폼은 창 안에서
    // 고르므로 그 경로에서만 먼저 모으고, 프리셋 경로는 종전처럼 옵션을 고른 뒤 모은다(한 번만 계산).
    let sceneNamesCache: FolderSceneNames | undefined;
    const sceneNames = async (): Promise<FolderSceneNames> => {
      if (sceneNamesCache) return sceneNamesCache;
      const out: FolderSceneNames = { scene: [], inpaint: [] };
      for (const name of names) {
        try {
          const session = await sessionService.get(name);
          if (session) {
            for (const s of session.getScenes('scene')) out.scene.push(s.name);
            for (const s of session.getScenes('inpaint')) out.inpaint.push(s.name);
          }
        } catch (e) {}
      }
      sceneNamesCache = out;
      return out;
    };
    const picked = await this.askFolderImageOptions(folder, names.length, sceneNames);
    if (!picked) return;
    const run = exportRunOptionsFromPreset(picked.preset, picked.askedName);
    // 「대상」(2026-11-17 M5 묶음 b-3): 직접 설정 폼에서만 고른다 — 저장 프리셋 경로는 생성 씬만(프리셋 형식 불변)
    const sceneTypes = folderExportSceneTypes(picked.folderTarget);

    // 직접 설정 폼은 변환할 특수문자를 창 안에서 받는다. 프리셋은 프로젝트 내보내기처럼
    // 「특수문자 자동 변환」이 켜져 있으면 묻지 않고, 꺼져 있으면 한 번 질의.
    const charsToReplace = picked.charsToReplace ??
      await appState.detectSpecialCharsFromNames(
        (await sceneNames()).scene,
        run.separator,
        picked.preset.autoConvertSeparator === true,
      );
    if (charsToReplace === undefined) return; // 취소

    if (zipService.isZipping) {
      appState.pushMessage('이미 내보내기 작업이 진행중입니다.');
      return;
    }
    // 목표 폴더 — 「프로젝트 폴더 경로로 하위 폴더 생성」의 기준은 이 폴더 경로. 모바일은 null(기본 위치).
    const targetFolder = await exportPresetService.resolveExportTargetFolderAt(picked.preset, folder);
    const allEntries: ExportImageItem[] = [];
    // 재최적화 'ask'(구 프리셋)는 이미 최적화된 이미지가 처음 나온 프로젝트에서 한 번만 묻고 그 답을 이어 쓴다.
    let reoptimize = run.reoptimize;
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
          // 생성 씬 → `프로젝트/…`, 변형 씬 → `프로젝트/변형/…`. 같은 단계 함수·같은 옵션이라 프로젝트 탭별 내보내기와
          // 같은 이름·변환(미러 씬 잘라내기·변형 씬 mains 기준 「즐겨찾기만」 포함 — 씬 객체의 type 으로 판정).
          // 두 종류를 한 목록으로 합쳐 최적화해 재최적화 질문도 프로젝트당 한 번(그리고 폴더 전체에서 처음 한 번)만.
          const imageOptions = {
            ...run,
            charsToReplace,
            characterAffix: run.applyCharacterAffix ? characterFilenameAffixOf(session) : null,
          };
          let entries: ExportImageItem[] = [];
          for (const type of sceneTypes) {
            const built = await exportPresetService.buildExportImageList(
              session,
              session.getScenes(type),
              imageOptions,
            );
            const sub = type === 'inpaint' ? FOLDER_EXPORT_VARIANT_DIR + '/' : '';
            for (const e of built) entries.push({ path: e.path, name: sub + e.name });
          }
          if (run.opt !== 'original') {
            const optimized = await exportPresetService.optimizeExportImages(entries, { ...run, reoptimize });
            // 재최적화 확인 창 취소 = 이 프로젝트만 건너뜀(종전 그대로)
            entries = optimized?.paths ?? [];
            if (optimized) reoptimize = optimized.reoptimize;
          }
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
    const stamp = Date.now();
    await exportPresetService.deliverExportImages(allEntries, {
      outputMode: run.outputMode,
      targetFolder,
      archivePath:
        'exports/' + folder + '_images_' + stamp + (run.outputMode === 'zip' ? '.zip' : '.tar'),
      filesDirName: sanitizeFilenamePart(sessionService.folderLeafName(folder)) + '_images_' + stamp,
      // 기본 위치 압축파일은 종전 폴더 완료 안내(장 수 포함). 목표 폴더·개별 파일은 프로젝트 내보내기 규칙(완료 위젯·폴더 열기).
      onArchiveDone: () =>
        appState.pushDialog({
          type: 'yes-only',
          text: `폴더 "${folder}" 이미지 내보내기가 완료되었습니다. (${allEntries.length}장)`,
        }),
    });
  }

  // 이미지 내보내기 옵션을 한 번 입력 받는다 (프리셋 또는 직접 설정).
  // 직접 설정은 프로젝트 이미지 내보내기와 같은 폼 한 창(DirectExportDialog, scope 'folder' —
  // 2026-11-16 M5 묶음 b P8, 종전 연속 질문 6~7개).
  // 반환: preset = 저장된 프리셋 또는 폼 결과, askedName = 「이름 직접 입력」 형식에서 받은 이름(그 밖 ''),
  // charsToReplace = 직접 설정 폼에서 고른 변환 문자(프리셋 경로는 undefined — 호출부가 따로 정한다).
  private async askFolderImageOptions(
    folder: string,
    projectCount: number,
    sceneNames: () => Promise<FolderSceneNames>,
  ): Promise<{
    preset: ExportPreset;
    askedName: string;
    charsToReplace?: Set<string>;
    folderTarget?: FolderExportTarget;
  } | undefined> {
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
      const askedName = await exportPresetService.askPresetCharacterName(ep);
      if (askedName === undefined) return undefined;
      return { preset: ep, askedName };
    }
    // 직접 설정 — 폼 한 창
    const names = await sceneNames();
    const result = await appState.requestDirectExport({
      projectName: folder,
      projectCount,
      sceneNames: names.scene,
      variantSceneNames: names.inpaint,
      scope: 'folder',
    });
    if (!result) return undefined;
    return {
      preset: result.preset,
      askedName: '',
      charsToReplace: new Set(result.charsToReplace),
      folderTarget: result.folderTarget ?? DEFAULT_FOLDER_EXPORT_TARGET,
    };
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
    // tar 내용을 한 번 추출해 백업 종류를 정확히 구분한다(models/backupKind.ts, 2026-11-22 — 전체 백업 추가).
    // (드래그&드롭·프로젝트 백업 불러오기·드라이브로 들어온 tar 가 폴더·프로젝트·전체 백업 어느 것일 수도 있음)
    // 전체 백업이면 안내 한 줄 뒤 「전체 백업 불러오기」와 같은 확인 창·선택지로 이어진다.
    const ex = await this.extractBackupArchive(tarPath, '백업 파일을 확인하는 중...');
    if (!ex) return;
    await this.routeExtractedBackup('tar', tarPath, ex.tmpRoot, ex.detection);
  }

  // 압축 해제된 프로젝트 백업(root/project.json + 이미지 6루트)을 §0 순서로 불러온다
  // (드라이브 동기화 ⑤). cleanupDir(기본 root — 한 겹 벗긴 경우 그 바깥)는 이 함수가 끝날 때 항상 정리한다.
  private async importProjectBackupFromDir(
    root: string,
    fileStem?: string,
    cleanupDir: string = root,
  ): Promise<void> {
    const cleanup = async () => {
      try {
        await backend.deleteDir(cleanupDir);
      } catch (e) {}
    };
    let json: any;
    try {
      json = JSON.parse(await backend.readFile(root + '/project.json'));
    } catch (e) {
      await cleanup();
      appState.pushMessage(PROJECT_IMPORT_TEXT.readFailed);
      return;
    }
    const suggested = suggestProjectName(json?.name, fileStem);
    const plan = planProjectImport({
      suggested,
      existing: sessionService.list(),
      hasImages: await this.dirHasProjectImages(root),
    });

    let policy: ImportPolicy = 'rename';
    if (plan.conflict) {
      const chosen = await askImportPolicy({
        label: PROJECT_IMPORT_LABEL,
        conflictCount: 1,
        allow: { overwrite: plan.allowOverwrite },
      });
      if (!chosen) {
        await cleanup();
        return;
      }
      policy = chosen;
    }

    if (policy === 'skip') {
      await cleanup();
      notifyImportDone(PROJECT_IMPORT_LABEL, projectImportSummary('skip'));
      return;
    }

    if (policy === 'overwrite') {
      try {
        await this.overwriteProjectFromDir(root, suggested);
      } finally {
        await cleanup();
      }
      return;
    }

    // 새 이름으로 추가 — 백업 이름(충돌 시 「이름 (n)」)을 기본값으로 제시.
    // 이름 규칙·중복은 입력 창 안에서 검사(실패해도 창 유지 — D2). 가져오기는 목록에 없는 이름만 넘긴다(§8-3).
    const name = await promptName({
      title: PROJECT_IMPORT_TEXT.namePrompt,
      initial: plan.renameDefault,
      ...projectNameRules(sessionService),
    });
    if (!name) {
      await cleanup();
      return;
    }
    appState.setProgressDialog({
      text: PROJECT_IMPORT_TEXT.importing,
      done: 0,
      total: 1,
    });
    try {
      await sessionService.importSessionDeepFromDir(root, name);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      await cleanup();
      appState.pushMessage(
        PROJECT_IMPORT_TEXT.importFailed(e?.message || String(e)),
      );
      return;
    }
    await cleanup();
    appState.setProgressDialog(undefined);
    notifyImportDone(PROJECT_IMPORT_LABEL, projectImportSummary('rename'));
    const sess = await sessionService.get(name);
    if (sess) appState.curSession = sess;
  }

  // 백업에 이미지(6루트 중 하나라도 파일)가 있는지 — 없으면 덮어쓰기를 숨긴다(§0-2).
  private async dirHasProjectImages(root: string): Promise<boolean> {
    for (const r of PROJECT_IMAGE_ROOTS) {
      try {
        const files = await backend.listFiles(root + '/' + r);
        if (files.length > 0) return true;
      } catch (e) {}
    }
    return false;
  }

  // 같은 이름의 기존 프로젝트를 백업 내용으로 덮어쓴다(드라이브 동기화 ⑤ — 플랜 §6,
  // 사용자 결정: 임시 백업 + 휴지통 이관 2중 보호, 영구 삭제 없음). 절차 분기는
  // projectOverwrite.runProjectOverwrite(순수·jest), 여기서는 기존 관문만 연결한다:
  // flush=flushProjectNow, 백업=exportSessionDeep, 가져오기=importSessionDeepFromDir
  // (이미지 선복사→createFrom), 이름변경=renameProject, 휴지통=projectDeleteFlow.deleteProjectForReplaceFlow.
  // 새 lock 을 만들거나 중첩하지 않는다(각 관문이 자기 withLock·flushPath 를 쓴다).
  private async overwriteProjectFromDir(root: string, target: string) {
    // 확인 2회(프로젝트만 — §0-3).
    const ok1 = await confirmOverwrite({
      label: PROJECT_IMPORT_LABEL,
      count: 1,
      protection: IMPORT_FLOW_TEXT.protection.trashWithBackup,
    });
    if (!ok1) return;
    const ok2 = await appState.confirmAsync(
      PROJECT_IMPORT_TEXT.secondConfirm,
      PROJECT_IMPORT_TEXT.secondConfirmButton,
      { danger: true },
    );
    if (!ok2) return;
    if (zipService.isZipping) {
      appState.pushMessage(PROJECT_IMPORT_TEXT.busyZipping);
      return;
    }

    const wasCurrent = appState.curSession?.name === target;
    // delete·rename 은 메모리에 올라온 프로젝트만 처리한다(미로드면 조용히 돌아오거나
    // 오류) → 부르기 전에 로드한다.
    const ensureLoaded = async (name: string) => {
      const s = await sessionService.get(name);
      if (!s) throw new Error('프로젝트를 불러오지 못했습니다: ' + name);
      return s;
    };

    let result;
    try {
      result = await runProjectOverwrite(target, new Date(), {
        listNames: () => sessionService.list(),
        trashedNames: async () =>
          (await trashService.getDeletedProjects()).map((p) => p.name),
        isLockedElsewhere: async (name) =>
          !(await sessionService.guardCrossWindowLock(name, '덮어쓰기')),
        folderOf: (name) => sessionService.getFolderOf(name),
        folderExists: (folder) => sessionService.listFolders().includes(folder),
        flush: async (name) => {
          await ensureLoaded(name);
          await sessionService.flushProjectNow(name);
        },
        exportBackup: async (name, exportsPath) => {
          const s = await ensureLoaded(name);
          await sessionService.exportSessionDeep(s, exportsPath);
        },
        saveBackup: (exportsPath) => saveExportSilently(exportsPath),
        discardStaging: async (exportsPath) => {
          try {
            await backend.deleteFile(exportsPath);
          } catch (e) {}
        },
        importAs: (name) => sessionService.importSessionDeepFromDir(root, name),
        beforeSwap: (name) => {
          if (appState.curSession?.name === name) appState.curSession = undefined;
        },
        rename: async (oldName, newName) => {
          await ensureLoaded(oldName);
          await sessionService.renameProject(oldName, newName);
          // 구 배치 rename 은 인스턴스 name 을 바꾸지 않는다 — 기존 호출부(ProjectDrawer·
          // FindReplaceDialog)와 같이 맞춘다(이미지 경로가 session.name 기준).
          const s = sessionService.getLoaded(newName);
          if (s) s.name = newName;
        },
        // 휴지통 관문(projectDeleteFlow — 닫기·다시 열기는 이 흐름이 beforeSwap·끝 처리로 관리)
        remove: async (name) => {
          await ensureLoaded(name);
          await deleteProjectForReplaceFlow(name);
        },
        moveToFolder: (name, folder) => sessionService.moveToFolder(name, folder),
        onProgress: (stage) =>
          appState.setProgressDialog({
            text: PROJECT_IMPORT_TEXT.progress[stage],
            done: 0,
            total: 1,
          }),
      });
    } finally {
      appState.setProgressDialog(undefined);
    }

    if (!result.ok) {
      appState.pushDialog({ type: 'yes-only', text: overwriteFailureText(result) });
      // 이 창에서 열려 있던 기존 프로젝트가 원래 이름 그대로 남았으면 다시 연다.
      if (
        wasCurrent &&
        !appState.curSession &&
        sessionService.list().includes(target)
      ) {
        const sess = await sessionService.get(target);
        if (sess) appState.curSession = sess;
      }
      return;
    }
    const extraLines = [
      PROJECT_IMPORT_TEXT.doneExtra(result.backupLocation, result.trashName),
    ];
    if (result.folderRestoreFailed) {
      extraLines.push(
        PROJECT_IMPORT_TEXT.folderRestoreFailed(result.folderRestoreFailed),
      );
    }
    notifyImportDone(PROJECT_IMPORT_LABEL, {
      ...projectImportSummary('overwrite'),
      extra: extraLines.join('\n'),
    });
    const sess = await sessionService.get(target);
    if (sess) appState.curSession = sess;
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
        text: `현재 세션의 프리셋으로 불러오기`,
        value: 'session',
      },
    ];
    if (isGlobalSupported) {
      items.push({
        text: '글로벌 프리셋으로 불러오기',
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
      text: `이미지에서 ${presetLabel}프리셋${typeLabel}을(를) 발견했습니다.\n어떻게 불러올까요?`,
      items,
      callback: async (option?: string) => {
        if (!option) return;
        if (option === 'session') {
          // 되돌리기(U3b): 드롭으로 불러온 그림체 + 선택 = 1항목(저장한 대표 이미지 파일은 남김)
          const undoRec = beginPresetListRecord(session, UNDO_TEXT.presetImport(1));
          try {
            const preset = await importPreset(session, base64);
            if (preset) {
              session.selectedWorkflow = {
                workflowType: preset.type,
                presetName: preset.name,
              };
              undoRec.commit();
              appState.pushDialog({
                type: 'yes-only',
                text: `"${preset.name}" 프리셋을 현재 세션으로 불러왔습니다.`,
              });
            } else {
              appState.externalImage = base64;
            }
          } catch (e: any) {
            appState.pushMessage('세션으로 불러오기 실패: ' + (e.message || e));
          }
        } else if (option === 'global') {
          try {
            const entry = await globalPresetService.importFromPng(base64);
            if (entry) {
              appState.pushDialog({
                type: 'yes-only',
                text: `"${entry.name}" 프리셋을 글로벌 프리셋으로 불러왔습니다.`,
              });
            } else {
              appState.pushMessage('글로벌 프리셋으로 불러오기 실패: 유효하지 않은 메타데이터');
            }
          } catch (e: any) {
            appState.pushMessage('글로벌 프리셋으로 불러오기 실패: ' + (e.message || e));
          }
        } else if (option === 'extract') {
          appState.externalImage = base64;
        }
      },
    });
  }
}
