import {
  backend,
  gameService,
  globalPieceService,
  globalPresetService,
  imageService,
  isMobile,
  localAIService,
  sessionService,
  taskQueueService,
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
  importPresets,
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

export interface ExportPreset {
  name: string;
  menu: 'fav' | 'all';
  format: 'normal' | 'prefix' | 'prefix_ask';
  prefix: string;
  opt: 'original' | 'lossy' | 'lossless' | 'avif';
  imageSize: number;
  separator: string;
}

export interface SceneSelectorItem {
  type: 'scene' | 'inpaint';
  text: string;
  callback: (scenes: GenericScene[]) => void;
  scenes?: GenericScene[];
}

export class AppState {
  @observable accessor curSession: Session | undefined = undefined;
  @observable accessor messages: string[] = [];
  @observable accessor dialogs: Dialog[] = [];
  @observable accessor samples: number = 10;
  @observable accessor progressDialog: ProgressDialog | undefined = undefined;
  @observable accessor externalImage: string | undefined = undefined;
  // 프로젝트 좌측 드로어 / 그리드 탐색기 모달 열림 상태 (앱 전역)
  @observable accessor projectDrawerOpen: boolean = false;
  @observable accessor projectBrowserOpen: boolean = false;
  /** 현재 적용된 캐릭터 프리셋 이름 (shared에서 읽음 — 영속화됨) */
  get appliedCharacterPreset(): string | undefined {
    const session = this.curSession;
    if (!session) return undefined;
    const workflowType = session.selectedWorkflow?.workflowType;
    if (!workflowType) return undefined;
    const shared = session.presetShareds.get(workflowType);
    return shared?._appliedPresetName || undefined;
  }

  // 이미지 클립보드
  @observable accessor imageClipboard: string[] = [];

  // 만료 프로젝트 알림
  @observable accessor pendingExpiredProjects: {name: string, deletedAt: number}[] = [];

  // 씬 카드 디자인 설정
  @observable accessor classicSceneCard: boolean = false;

  // 레거시 프로젝트 모드: true면 기존 드롭다운 선택 UI 유지(드로어/드롭다운/그리드 공존),
  // false(기본)면 드롭다운을 제거하고 드로어 트리거로 전환
  @observable accessor legacyProjectMode: boolean = false;

  // 자동완성 모드: false=커서 왼쪽만(기본), true=콤마 사이 전체 단어
  @observable accessor fullWordAutoComplete: boolean = (() => {
    return localStorage.getItem('sdstudio-full-word-autocomplete') === 'true';
  })();

  // 프롬프트조각 에디터 오버레이
  @observable accessor pieceEditorOpen: boolean = false;

  // 찾기 및 변환 다이얼로그
  @observable accessor findReplaceOpen: boolean = false;
  @observable accessor exportPresetManagerOpen: boolean = false;
  lastExportType: 'scene' | 'inpaint' = 'scene';
  lastExportSelected?: GenericScene[];

  // 모달 오버레이 카운터 (열린 ModalOverlay 수 추적)
  @observable accessor modalOverlayCount: number = 0;

  // 내보내기 진행 상태 (비차단형 — ProgressWindow 대신 플로팅 위젯 사용)
  @observable accessor exportProgress: ProgressDialog | undefined = undefined;

  @action
  incrementModalOverlay() {
    this.modalOverlayCount++;
  }

  @action
  decrementModalOverlay() {
    this.modalOverlayCount = Math.max(0, this.modalOverlayCount - 1);
  }

  // 단축키 시스템용 상태
  @observable accessor floatViewCount: number = 0;
  @observable accessor resultViewerOpen: boolean = false;
  @observable accessor imageGridFocusable: boolean = false;
  @observable accessor configScreenOpen: boolean = false;

  @action
  incrementFloatView() {
    this.floatViewCount++;
  }

  @action
  decrementFloatView() {
    this.floatViewCount = Math.max(0, this.floatViewCount - 1);
  }

  @action
  openPieceEditor() {
    this.pieceEditorOpen = true;
  }

  @action
  closePieceEditor() {
    this.pieceEditorOpen = false;
  }

  @action
  openFindReplace() {
    this.findReplaceOpen = true;
  }

  @action
  closeFindReplace() {
    this.findReplaceOpen = false;
  }

  @action
  openExportPresetManager() {
    this.exportPresetManagerOpen = true;
  }

  @action
  closeExportPresetManager() {
    this.exportPresetManagerOpen = false;
  }

  // 좌측 패널 상태
  @observable accessor leftPanelWidth: number = (() => {
    const saved = localStorage.getItem('sdstudio-left-panel-width');
    return saved ? Math.max(250, Math.min(800, parseInt(saved, 10) || 400)) : 400;
  })();
  @observable accessor leftPanelCollapsed: boolean = (() => {
    return localStorage.getItem('sdstudio-left-panel-collapsed') === 'true';
  })();

  @action
  setLeftPanelWidth(w: number) {
    this.leftPanelWidth = w;
    localStorage.setItem('sdstudio-left-panel-width', String(w));
  }

  @action
  toggleLeftPanel() {
    this.leftPanelCollapsed = !this.leftPanelCollapsed;
    localStorage.setItem('sdstudio-left-panel-collapsed', String(this.leftPanelCollapsed));
  }

  @action
  addMessage(message: string): void {
    this.messages.push(message);
  }

  @action
  addDialog(dialog: Dialog): void {
    this.dialogs.push(dialog);
  }

  @action
  setSamples(samples: number): void {
    this.samples = samples;
  }

  pushMessage(msg: string) {
    this.messages.push(msg);
  }

  pushDialog(dialog: Dialog) {
    this.dialogs.push(dialog);
  }

  copyImagesToClipboard(paths: string[]) {
    this.imageClipboard = [...paths];
    this.pushMessage(paths.length + '장의 이미지가 복사되었습니다.');
  }

  async pasteImagesFromClipboard(session: Session, scene: GenericScene) {
    if (this.imageClipboard.length === 0) {
      this.pushMessage('복사된 이미지가 없습니다.');
      return;
    }
    const targetDir = imageService.getOutputDir(session, scene);
    let copied = 0;
    for (const srcPath of this.imageClipboard) {
      try {
        const filename = Date.now().toString() + '_' + copied + '.png';
        await backend.copyFile(srcPath, targetDir + '/' + filename);
        copied++;
      } catch (e) {
        console.error('이미지 붙여넣기 실패:', srcPath, e);
      }
    }
    await imageService.refresh(session, scene);
    this.pushMessage(copied + '장의 이미지가 붙여넣어졌습니다.');
  }

  pushDialogAsync(dialog: Dialog) {
    return new Promise<string | undefined>((resolve, reject) => {
      dialog.callback = (value?: string, text?: string) => {
        resolve(value);
      };
      dialog.onCancel = () => {
        resolve(undefined);
      };
      this.dialogs.push(dialog);
    });
  }

  setProgressDialog(dialog: ProgressDialog | undefined) {
    this.progressDialog = dialog;
  }

  handleFile(file: File) {
    if (file.name.endsWith('.tar')) {
      // tar 파일 — 프로젝트 백업 불러오기
      const filePath = (file as any).path;
      if (!filePath) {
        this.pushMessage('tar 파일 경로를 가져올 수 없습니다');
        return;
      }
      this.handleTarImport(filePath);
      return;
    }
    if (file.type === 'application/json') {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const json = JSON.parse(e.target.result);
          handleJSONContent(file.name, json);
        } catch (err) {
          console.error(err);
        }
      };
      reader.readAsText(file);
    } else if (file.type === 'image/png') {
      if (!this.curSession) {
        return;
      }
      try {
        const reader = new FileReader();
        reader.onload = async (e: any) => {
          try {
            const base64 = dataUriToBase64(e.target.result);
            await this.handlePngImport(base64);
          } catch (e) {}
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error(err);
      }
    }
    const handleJSONContent = async (name: string, json: any) => {
      if (name.endsWith('.json')) {
        name = name.slice(0, -5);
      }
      const handleAddSession = async (json: any) => {
        const importCool = async () => {
          const sess = await sessionService.get(json.name);
          if (!sess) {
            await sessionService.importSessionShallow(
              json as ISession,
              json.name,
            );
            const newSession = (await sessionService.get(json.name))!;
            this.curSession = newSession;
            this.pushDialog({
              type: 'yes-only',
              text: '프로젝트를 임포트 했습니다',
            });
          } else {
            this.pushDialog({
              type: 'input-confirm',
              text: '프로젝트를 임포트 합니다. 새 프로젝트 이름을 입력하세요.',
              callback: async (value) => {
                if (!value || value === '') {
                  return;
                }
                try {
                  await sessionService.importSessionShallow(
                    json as ISession,
                    value,
                  );
                  const newSession = (await sessionService.get(value))!;
                  this.curSession = newSession;
                } catch (e) {
                  this.pushMessage('이미 존재하는 프로젝트 이름입니다.');
                }
              },
            });
          }
        };
        if (!this.curSession) {
          await importCool();
        } else {
          this.pushDialog({
            type: 'select',
            text: '프로젝트를 임포트 합니다. 원하시는 방식을 선택해주세요.',
            items: [
              {
                text: '새 프로젝트로 임포트',
                value: 'new-project',
              },
              {
                text: '현재 프로젝트에 씬만 임포트 (⚠️! 씬이 덮어씌워짐)',
                value: 'cur-project',
              },
            ],
            callback: async (option?: string) => {
              if (option === 'new-project') {
                await importCool();
              } else if (option === 'cur-project') {
                const cur = this.curSession!;
                const newJson: ISession = await sessionService.migrate(json);
                for (const key of Object.keys(newJson.scenes)) {
                  if (cur.scenes.has(key)) {
                    cur.scenes.get(key)!.slots = newJson.scenes[key].slots.map(
                      (slot: any) =>
                        slot.map((piece: any) => PromptPiece.fromJSON(piece)),
                    );
                    cur.scenes.get(key)!.resolution =
                      newJson.scenes[key].resolution;
                  } else {
                    const scene = newJson.scenes[key];
                    cur.scenes.set(key, Scene.fromJSON(scene));
                    cur.scenes.get(key)!.mains = [];
                    cur.scenes.get(key)!.game = undefined;
                  }
                }
                appState.pushDialog({
                  type: 'yes-only',
                  text: '씬을 임포트 했습니다',
                });
              }
            },
          });
        }
      };
      if (isValidSession(json)) {
        handleAddSession(json);
      } else if (isValidNAISPreset(json)) {
        const pieceNames = extractNAISPieceNames(json.scenes);
        const doConvert = (libraryName?: string) => {
          const converted = convertNAISToSession(json, libraryName);
          if (libraryName && pieceNames.length > 0) {
            converted.library[libraryName] = {
              version: 1,
              name: libraryName,
              pieces: pieceNames.map((pieceName) => ({
                name: pieceName,
                prompt: '',
              })),
            };
          }
          handleAddSession(converted);
        };
        if (pieceNames.length > 0) {
          this.pushDialog({
            type: 'input-confirm',
            text: 'NAIS 프리셋에서 조각이 감지되었습니다 (' + pieceNames.join(', ') + '). 사용할 프롬프트조각 라이브러리 이름을 입력해 주세요.',
            callback: (value) => {
              if (!value || value === '') {
                doConvert();
              } else {
                doConvert(value);
              }
            },
          });
        } else {
          doConvert();
        }
      } else if (isValidPieceLibrary(json)) {
        if (!json.version) {
          json = migratePieceLibrary(json);
        }
        const importToTarget = (targetLibrary: Map<string, PieceLibrary>, scopeLabel: string) => {
          const afterImport = () => {
            if (scopeLabel === '전역') globalPieceService.scheduleSave();
            if (this.curSession) sessionService.reloadPieceLibraryDB(this.curSession);
          };

          if (!targetLibrary.has(json.name)) {
            targetLibrary.set(json.name, PieceLibrary.fromJSON(json));
            afterImport();
            this.pushDialog({
              type: 'yes-only',
              text: `조각모음을 ${scopeLabel}에 임포트 했습니다`,
            });
            return;
          }

          const srcLib = PieceLibrary.fromJSON(json);
          const targetLib = targetLibrary.get(json.name)!;
          const srcNames = new Set(srcLib.pieces.map(p => p.name));
          const tgtNames = new Set(targetLib.pieces.map(p => p.name));
          const overlap = [...srcNames].filter(n => tgtNames.has(n));
          const srcOnly = [...srcNames].filter(n => !tgtNames.has(n));
          const tgtOnly = [...tgtNames].filter(n => !srcNames.has(n));

          let detail = `${scopeLabel}에 "${json.name}" 조각그룹이 이미 존재합니다.\n\n`;
          if (overlap.length > 0) detail += `겹치는 조각(${overlap.length}개): ${overlap.slice(0, 5).join(', ')}${overlap.length > 5 ? ' ...' : ''}\n`;
          if (srcOnly.length > 0) detail += `임포트에만 있는 조각(${srcOnly.length}개): ${srcOnly.slice(0, 5).join(', ')}${srcOnly.length > 5 ? ' ...' : ''}\n`;
          if (tgtOnly.length > 0) detail += `기존에만 있는 조각(${tgtOnly.length}개): ${tgtOnly.slice(0, 5).join(', ')}${tgtOnly.length > 5 ? ' ...' : ''}\n`;

          const items: { text: string; value: string }[] = [];
          if (overlap.length > 0) {
            items.push({ text: '병합 (겹치는 조각 덮어쓰기)', value: 'merge-overwrite' });
            items.push({ text: '병합 (겹치는 조각 건너뛰기)', value: 'merge-skip' });
          } else {
            items.push({ text: '병합 (양쪽 조각 모두 유지)', value: 'merge-skip' });
          }
          items.push({ text: '통째로 덮어쓰기 (기존 조각 모두 교체)', value: 'overwrite' });
          items.push({ text: '새 이름으로 임포트', value: 'rename' });
          items.push({ text: '취소', value: 'cancel' });

          this.pushDialog({
            type: 'select',
            text: detail,
            items,
            callback: (action) => {
              if (!action || action === 'cancel') return;
              if (action === 'merge-overwrite' || action === 'merge-skip') {
                const overwriteDuplicates = action === 'merge-overwrite';
                let added = 0, overwritten = 0, skipped = 0;
                for (const srcPiece of srcLib.pieces) {
                  const existingIdx = targetLib.pieces.findIndex(p => p.name === srcPiece.name);
                  if (existingIdx >= 0) {
                    if (overwriteDuplicates) {
                      targetLib.pieces[existingIdx] = Piece.fromJSON(srcPiece.toJSON());
                      overwritten++;
                    } else {
                      skipped++;
                    }
                  } else {
                    targetLib.pieces.push(Piece.fromJSON(srcPiece.toJSON()));
                    added++;
                  }
                }
                afterImport();
                const parts = [];
                if (added > 0) parts.push(`${added}개 추가`);
                if (overwritten > 0) parts.push(`${overwritten}개 덮어쓰기`);
                if (skipped > 0) parts.push(`${skipped}개 건너뜀`);
                this.pushMessage(`"${json.name}" 병합 완료: ${parts.join(', ')}`);
              } else if (action === 'overwrite') {
                targetLibrary.delete(json.name);
                targetLibrary.set(json.name, srcLib);
                afterImport();
                this.pushMessage(`"${json.name}" 조각그룹을 덮어썼습니다`);
              } else if (action === 'rename') {
                this.pushDialog({
                  type: 'input-confirm',
                  text: '새 조각그룹 이름을 입력하세요',
                  callback: (newName) => {
                    if (!newName) return;
                    if (targetLibrary.has(newName)) {
                      this.pushMessage('이미 존재하는 이름입니다');
                      return;
                    }
                    srcLib.name = newName;
                    targetLibrary.set(newName, srcLib);
                    afterImport();
                    this.pushMessage(`"${newName}" 조각그룹을 ${scopeLabel}에 임포트 했습니다`);
                  },
                });
              }
            },
          });
        };

        // 세션이 없으면 전역으로 바로 임포트
        if (!this.curSession) {
          importToTarget(globalPieceService.library, '전역');
          return;
        }

        // 세션이 있으면 로컬/전역 선택
        this.pushDialog({
          type: 'select',
          text: '조각그룹을 어디에 임포트하시겠습니까?',
          items: [
            { text: '현재 프로젝트 (로컬)', value: 'local' },
            { text: '전역 (모든 프로젝트)', value: 'global' },
          ],
          callback: (scopeValue) => {
            if (!scopeValue) return;
            if (scopeValue === 'local') {
              importToTarget(this.curSession!.library, '로컬');
            } else {
              importToTarget(globalPieceService.library, '전역');
            }
          },
        });
      }
    };
  }

  @action
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
          await appState.folderBackupImport();
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
                  this.curSession = sess;
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
    if (sess) this.curSession = sess;
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
    const names = this.projectsInFolder(folder);
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
        if (value === 'saveFolder') await appState.folderBackupExport(folder);
        else if (value === 'saveImages') await appState.folderExportImages(folder);
        else if (value === 'load') await appState.folderImportFile(folder);
        else if (value === 'loadDeep') appState.folderImportDeep(folder);
        else if (value === 'loadFolder') await appState.folderBackupImport();
      },
    });
  }

  // ===== 폴더 백업 (폴더째 단일 아카이브) =====
  // 내보내기: 폴더 내 모든 프로젝트의 파일을 <프로젝트명>/ 네임스페이스로 하나의 tar에 담고
  //           매니페스트(_folder.json)를 포함해 폴더 백업임을 표시한다.
  async folderBackupExport(folder: string) {
    const names = this.projectsInFolder(folder);
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
      const characterPreset = this.getAppliedCharacterPreset();
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
    const names = this.projectsInFolder(folder);
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
    const charsToReplace = await this.detectSpecialCharsFromNames(
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
    const presets = this.loadExportPresets();
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
      this.openExportPresetManager();
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

  // ── 내보내기 프리셋 헬퍼 ──
  loadExportPresets(): ExportPreset[] {
    try {
      const raw = localStorage.getItem('sdstudio-export-presets');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  saveExportPresets(presets: ExportPreset[]) {
    localStorage.setItem('sdstudio-export-presets', JSON.stringify(presets));
  }

  private formatExportPresetLabel(p: ExportPreset): string {
    const parts: string[] = [p.name];
    const detail: string[] = [];
    detail.push(p.menu === 'fav' ? '즐겨찾기' : '전체');
    if (p.format === 'prefix' && p.prefix) detail.push(`캐릭터: ${p.prefix}`);
    if (p.format === 'prefix_ask') detail.push('캐릭터: 직접 입력');
    if (p.opt !== 'original') detail.push(`${p.opt}·${p.imageSize}px`);
    else detail.push('원본');
    return `${p.name}  (${detail.join(', ')})`;
  }

  private async detectSpecialChars(
    type: 'scene' | 'inpaint',
    selected: GenericScene[] | undefined,
    separator: string,
  ): Promise<Set<string> | undefined> {
    const scenes = selected || this.curSession!.getScenes(type);
    return this.detectSpecialCharsFromNames(scenes.map((s) => s.name), separator);
  }

  // 씬 이름 목록에서 특수문자를 감지하고, 있으면 구분자 변환 여부를 한 번 묻는다.
  // 반환: 변환할 문자 Set (없으면 빈 Set), 사용자가 취소하면 undefined.
  private async detectSpecialCharsFromNames(
    sceneNames: string[],
    separator: string,
  ): Promise<Set<string> | undefined> {
    const specialCharRegex = /[^a-zA-Z0-9가-힣ぁ-んァ-ヶ一-龥　-〿]/g;
    const detectedChars = new Set<string>();
    for (const nm of sceneNames) {
      const matches = nm.match(specialCharRegex);
      if (matches) matches.forEach((c) => detectedChars.add(c));
    }

    let charsToReplace = new Set<string>();
    if (detectedChars.size > 0) {
      const items = Array.from(detectedChars).map((c) => ({
        text: c === ' ' ? '띄어쓰기' : `"${c}"`,
        value: c,
      }));
      const result = await appState.pushDialogAsync({
        type: 'checkbox',
        text: `씬 이름에서 감지된 특수문자입니다.\n"${separator}" 로 변환할 문자를 선택해주세요:`,
        items: items,
      });
      if (result === undefined) return undefined; // 취소
      try {
        charsToReplace = new Set(JSON.parse(result));
      } catch (e) {}
    }
    return charsToReplace;
  }

  async exportPackage(type: 'scene' | 'inpaint', selected?: GenericScene[]) {
    this.lastExportType = type;
    this.lastExportSelected = selected;
    const exportImpl = async (
      prefix: string,
      fav: boolean,
      opt: string,
      imageSize: number,
      separator: string,
      charsToReplace: Set<string>,
    ) => {
      let paths: { path: string; name: string }[] = [];
      await imageService.refreshBatch(this.curSession!);
      const scenes = selected ?? this.curSession!.getScenes(type);
      await Promise.allSettled(scenes.map((s) => gameService.refreshList(this.curSession!, s)));
      for (const scene of scenes) {
        const cands = gameService.getOutputs(this.curSession!, scene);
        const imageMap: any = {};
        cands.forEach((x) => {
          imageMap[x] = true;
        });
        const images = [];
        if (fav) {
          if (scene.mains.length) {
            for (const main of scene.mains) {
              if (imageMap[main]) images.push(main);
            }
          } else {
            if (cands.length) {
              images.push(cands[0]);
            }
          }
        } else {
          for (const cand of cands) {
            images.push(cand);
          }
        }
        // 캐릭터 프리셋 파일명 옵션 적용
        const characterPreset = this.getAppliedCharacterPreset();
        const presetPrefix = characterPreset?.filenamePrefix || '';
        const presetSuffix = characterPreset?.filenameSuffix || '';

        let sceneName = scene.name;
        let finalPrefix = prefix;
        let finalPresetPrefix = presetPrefix ? presetPrefix + separator : '';
        let finalPresetSuffix = presetSuffix ? separator + presetSuffix : '';
        if (charsToReplace.size > 0) {
          const escaped = Array.from(charsToReplace).map(
            (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          ).join('|');
          const regex = new RegExp(`(${escaped})+`, 'g');
          sceneName = sceneName.replace(regex, separator);
          finalPrefix = finalPrefix.replace(regex, separator);
          finalPresetPrefix = finalPresetPrefix.replace(regex, separator);
          finalPresetSuffix = finalPresetSuffix.replace(regex, separator);
        }
        const isMirror = scene.type === 'inpaint' && (scene as InpaintScene).workflowType === 'SDMirror';
        for (let i = 0; i < images.length; i++) {
          let imgPath = imageService.getOutputDir(this.curSession!, scene) + '/' + images[i];
          if (isMirror) {
            const imgData = await imageService.fetchImage(imgPath);
            if (imgData) {
              const cropped = await cropMirrorResultFromDataUri(imgData, (scene as InpaintScene).mirrorCropX);
              const tmpPath = 'tmp/' + v4() + '.png';
              await backend.writeDataFile(tmpPath, cropped);
              imgPath = tmpPath;
            }
          }
          // 파일명: [presetPrefix_][manualPrefix_]sceneName[_presetSuffix][_index].png
          const baseName = finalPresetPrefix + finalPrefix + sceneName + finalPresetSuffix;
          const name = images.length === 1
            ? baseName + '.png'
            : baseName + separator + (i + 1).toString() + '.png';
          paths.push({ path: imgPath, name });
        }
      }
      if (opt !== 'original') {
        const ext = opt === 'avif' ? '.avif' : '.webp';
        const optimizeMethod = opt === 'lossy'
          ? ImageOptimizeMethod.LOSSY
          : opt === 'avif'
            ? ImageOptimizeMethod.AVIF
            : ImageOptimizeMethod.LOSSLESS;
        let done = 0;
        let failCount = 0;
        const config = await backend.getConfig();
        const CONCURRENCY = Math.max(1, Math.min(4, config.exportConcurrency ?? (isMobile ? 2 : 4)));
        const results: (typeof paths[0] | null)[] = new Array(paths.length).fill(null);

        appState.exportProgress = {
          text: '이미지 크기 최적화 중..',
          done: 0,
          total: paths.length,
        };

        // 동시 실행 수 제한 병렬 처리
        const queue = paths.map((item, idx) => ({ item, idx }));
        const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
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
        });
        await Promise.all(workers);

        paths = results.filter((r): r is typeof paths[0] => r !== null);
        if (failCount > 0) {
          appState.pushMessage(`${failCount}개 이미지 최적화 실패 (건너뜀)`);
        }
        if (paths.length === 0) {
          appState.pushMessage('최적화 가능한 이미지가 없습니다');
          appState.exportProgress = undefined;
          return;
        }
      }
      appState.exportProgress = {
        text: '이미지 압축파일 생성중..',
        done: 0,
        total: 1,
      };
      const outFilePath =
        'exports/' +
        this.curSession!.name +
        '_main_images_' +
        Date.now().toString() +
        '.tar';
      if (zipService.isZipping) {
        appState.pushDialog({
          type: 'yes-only',
          text: '이미 다른 이미지 내보내기가 진행중입니다',
        });
        appState.exportProgress = undefined;
        return;
      }
      try {
        await zipService.zipFiles(paths, outFilePath);
      } catch (e: any) {
        appState.pushMessage(e.message);
        appState.exportProgress = undefined;
        return;
      }
      appState.exportProgress = undefined;
      appState.pushMessage('이미지 내보내기가 완료되었습니다');
      await backend.showFile(outFilePath);
    };

    // ── 프리셋 선택 또는 직접 설정 (항상 표시) ──
    const presets = this.loadExportPresets();
    const presetItems: { text: string; value: string }[] = presets.map((p: ExportPreset, i: number) => ({
      text: p.name,
      value: `preset_${i}`,
    }));
    presetItems.push({ text: '⚙️ 프리셋 관리', value: '_manage' });
    presetItems.push({ text: '── 직접 설정으로 내보내기 ──', value: '_manual' });

    const choice = await appState.pushDialogAsync({
      type: 'select',
      text: '내보내기 방법을 선택해주세요',
      items: presetItems,
    });
    if (!choice) return;

    if (choice === '_manage') {
      this.openExportPresetManager();
      return;
    }

    if (choice.startsWith('preset_')) {
      const idx = parseInt(choice.split('_')[1]);
      const ep = presets[idx];
      if (!ep) return;
      const charsToReplace = await this.detectSpecialChars(type, selected, ep.separator);
      if (charsToReplace === undefined) return;
      let epPrefix = '';
      if (ep.format === 'prefix' && ep.prefix) {
        epPrefix = ep.prefix + ep.separator;
      } else if (ep.format === 'prefix_ask') {
        const inputName = await appState.pushDialogAsync({
          type: 'input-confirm',
          text: '캐릭터 이름을 입력해주세요',
        });
        if (!inputName) return;
        epPrefix = inputName + ep.separator;
      }
      await exportImpl(epPrefix, ep.menu === 'fav', ep.opt, ep.imageSize, ep.separator, charsToReplace);
      return;
    }
    // '_manual' → 아래 기존 다이얼로그 체인

    // ── 기존 다이얼로그 체인 (직접 설정) ──
    const menu = await appState.pushDialogAsync({
      type: 'select',
      text: '내보낼 이미지를 선택해주세요',
      items: [
        { text: '즐겨찾기 이미지만 내보내기', value: 'fav' },
        { text: '모든 이미지 전부 내보내기', value: 'all' },
      ],
    });
    if (!menu) return;
    const format = await appState.pushDialogAsync({
      type: 'select',
      text: '파일 이름 형식을 선택해주세요',
      items: [
        { text: '(씬이름).(이미지 번호).png', value: 'normal' },
        { text: '(캐릭터 이름).(씬이름).(이미지 번호)', value: 'prefix' },
      ],
    });
    if (!format) return;

    const optItems = [
      { text: '원본', value: 'original' },
      { text: '저손실 webp 최적화 (에셋용 권장)', value: 'lossy' },
    ];
    if (!isMobile) {
      optItems.push({ text: '무손실 webp 최적화', value: 'lossless' });
    }
    optItems.push({ text: isMobile ? 'AVIF 최적화 (PC 권장)' : 'AVIF 최적화', value: 'avif' });
    const opt = await appState.pushDialogAsync({
      type: 'select',
      text: '이미지 크기 최적화 방법을 선택해주세요',
      items: optItems,
    });
    if (!opt) return;
    let imageSize = 0;
    if (opt !== 'original') {
      const inputImageSize = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '이미지 픽셀 크기를 결정해주세요 (추천값 1024)',
      });
      if (!inputImageSize) return;
      try {
        imageSize = parseInt(inputImageSize);
      } catch (error) {
        return;
      }
    }
    const separatorInput = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '파일명 구분자를 입력해주세요 (기본값: .)',
    });
    if (separatorInput === undefined) return;
    const separator = separatorInput || '.';

    // 특수문자 감지 (공통 헬퍼 사용)
    // 특수문자 감지 (공통 헬퍼 사용)
    const charsToReplace = await this.detectSpecialChars(type, selected, separator);
    if (charsToReplace === undefined) return;

    // 캐릭터 이름 입력 또는 바로 내보내기
    let prefix = '';
    if (format === 'prefix') {
      const inputPrefix = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '캐릭터 이름을 입력해주세요',
      });
      if (!inputPrefix) return;
      prefix = inputPrefix + separator;
    }

    await exportImpl(prefix, menu === 'fav', opt, imageSize, separator, charsToReplace);
  }

  async exportPreset(session: Session, preset: any) {
    try {
      let pngData;
      if (preset.profile) {
        const vibeImage = await imageService.fetchVibeImage(session, preset.profile);
        const base64 = vibeImage ? dataUriToBase64(vibeImage) : null;
        // PNG base64는 반드시 iVBOR로 시작 (PNG 시그니처 89 50 4E 47)
        if (base64 && base64.startsWith('iVBOR')) {
          pngData = base64;
        } else {
          pngData = await createImageWithText(832, 1216, preset.name);
        }
      } else {
        pngData = await createImageWithText(832, 1216, preset.name);
      }
      const newPngData = embedJSONInPNG(pngData, preset);
      const path =
        'exports/' + preset.name + '_' + Date.now().toString() + '.png';
      await backend.writeDataFile(path, newPngData);
      await backend.showFile(path);
    } catch (e: any) {
      appState.pushMessage('프리셋 내보내기 실패: ' + (e.message || e));
    }
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
    this.setProgressDialog({ text: '백업 파일을 확인하는 중...', done: 0, total: 1 });
    try {
      await backend.unzipFiles(tarPath, root);
    } catch (e: any) {
      this.setProgressDialog(undefined);
      this.pushMessage('압축 해제에 실패했습니다.');
      return;
    }
    this.setProgressDialog(undefined);

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
      this.pushMessage('인식할 수 없는 백업 파일입니다.');
      return;
    }

    this.pushDialog({
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
          this.pushMessage('이미 존재하는 프로젝트 이름입니다.');
          try { await backend.deleteDir(root); } catch (e) {}
          return;
        }
        this.setProgressDialog({
          text: '프로젝트 백업을 불러오는 중입니다...',
          done: 0,
          total: 1,
        });
        try {
          await sessionService.importSessionDeepFromDir(root, inputValue);
        } catch (e: any) {
          this.setProgressDialog(undefined);
          this.pushMessage('백업 불러오기 실패: ' + e.message);
          try { await backend.deleteDir(root); } catch (e2) {}
          return;
        }
        try { await backend.deleteDir(root); } catch (e) {}
        this.setProgressDialog(undefined);
        this.pushDialog({
          type: 'yes-only',
          text: '프로젝트 백업을 불러왔습니다.',
        });
        const sess = await sessionService.get(inputValue);
        this.curSession = sess;
      },
    });
  }

  async handlePngImport(base64: string): Promise<void> {
    if (!this.curSession) return;
    const session = this.curSession;

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
      this.externalImage = base64;
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

    this.pushDialog({
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
              this.pushDialog({
                type: 'yes-only',
                text: `"${preset.name}" 프리셋을 현재 세션에 가져왔습니다.`,
              });
            } else {
              this.externalImage = base64;
            }
          } catch (e: any) {
            this.pushMessage('세션 임포트 실패: ' + (e.message || e));
          }
        } else if (option === 'global') {
          try {
            const entry = await globalPresetService.importFromPng(base64);
            if (entry) {
              this.pushDialog({
                type: 'yes-only',
                text: `"${entry.name}" 프리셋을 글로벌 프리셋에 저장했습니다.`,
              });
            } else {
              this.pushMessage('글로벌 프리셋 저장 실패: 유효하지 않은 메타데이터');
            }
          } catch (e: any) {
            this.pushMessage('글로벌 프리셋 저장 실패: ' + (e.message || e));
          }
        } else if (option === 'extract') {
          this.externalImage = base64;
        }
      },
    });
  }

  // ---------------- 글로벌 프리셋 헬퍼 ----------------

  async exportPresetToGlobal(session: Session, preset: any): Promise<void> {
    try {
      const entry = await globalPresetService.addFromSessionPreset(
        session,
        preset,
      );
      this.pushMessage(`글로벌 프리셋에 추가: ${entry.name}`);
    } catch (e: any) {
      this.pushMessage('글로벌로 내보내기 실패: ' + (e.message || e));
    }
  }

  async importGlobalPresetIntoSession(
    session: Session,
    globalId: string,
  ): Promise<void> {
    try {
      const preset = await globalPresetService.instantiateIntoSession(
        session,
        globalId,
      );
      if (preset) {
        session.selectedWorkflow = {
          workflowType: preset.type,
          presetName: preset.name,
        };
        this.pushMessage(`세션에 추가: ${preset.name}`);
      }
    } catch (e: any) {
      this.pushMessage('가져오기 실패: ' + (e.message || e));
    }
  }

  @observable accessor globalPresetPicker:
    | { workflowType: GlobalPresetType; onSelect: (id: string) => void }
    | undefined = undefined;

  @action
  openGlobalPresetPicker(workflowType: GlobalPresetType): void {
    if (!this.curSession) {
      this.pushMessage('세션을 먼저 선택해주세요.');
      return;
    }
    const session = this.curSession;
    this.globalPresetPicker = {
      workflowType,
      onSelect: async (id: string) => {
        this.globalPresetPicker = undefined;
        await this.importGlobalPresetIntoSession(session, id);
      },
    };
  }

  @action
  closeGlobalPresetPicker(): void {
    this.globalPresetPicker = undefined;
  }

  async exportGlobalPresetToPng(entry: IGlobalPresetEntry): Promise<void> {
    try {
      const path =
        'exports/' + entry.name + '_' + Date.now().toString() + '.png';
      await globalPresetService.exportToPng(entry.id, path);
      await backend.showFile(path);
    } catch (e: any) {
      this.pushMessage('내보내기 실패: ' + (e.message || e));
    }
  }

  @action
  openBatchProcessMenu(
    type: 'scene' | 'inpaint',
    setSceneSelector: (item: SceneSelectorItem | undefined) => void,
  ) {
    const removeBg = async (selected: GenericScene[]) => {
      if (!localAIService.ready) {
        appState.pushMessage('환경설정에서 배경 제거 기능을 활성화해주세요');
        return;
      }
      for (const scene of selected) {
        if (scene.mains.length === 0) {
          const images = gameService.getOutputs(this.curSession!, scene);
          if (!images.length) continue;
          let image = await imageService.fetchImage(
            imageService.getOutputDir(this.curSession!, scene) +
              '/' +
              images[0],
          );
          image = dataUriToBase64(image!);
          queueRemoveBg(this.curSession!, scene, image);
        } else {
          const mains = scene.mains;
          for (const main of mains) {
            const path =
              imageService.getOutputDir(this.curSession!, scene) + '/' + main;
            let image = await imageService.fetchImage(path);
            image = dataUriToBase64(image!);
            queueRemoveBg(this.curSession!, scene, image, (newPath: string) => {
              for (let j = 0; scene.mains.length; j++) {
                if (scene.mains[j] === main) {
                  scene.mains[j] = newPath.split('/').pop()!;
                  break;
                }
              }
            });
          }
        }
      }
    };

    const deleteScenes = async (selected: GenericScene[]) => {
      appState.pushDialog({
        type: 'confirm',
        text: `정말로 선택한 ${selected.length}개의 씬을 삭제하시겠습니까? (휴지통으로 이동)`,
        callback: async () => {
          const { trashService } = await import('.');
          for (const scene of selected) {
            await trashService.moveSceneToTrash(this.curSession!, scene);
          }
          appState.pushDialog({
            type: 'yes-only',
            text: `${selected.length}개의 씬이 휴지통으로 이동되었습니다.`,
          });
        },
      });
    };

    const cancelAllReservations = async (selected: GenericScene[]) => {
      let totalCancelled = 0;
      for (const scene of selected) {
        const stats = taskQueueService.statsTasksFromScene(this.curSession!, scene);
        const remaining = stats.total - stats.done;
        totalCancelled += remaining;
        taskQueueService.removeTasksFromScene(scene);
      }
      appState.pushDialog({
        type: 'yes-only',
        text: `${selected.length}개 씬에서 총 ${totalCancelled}개의 예약이 취소되었습니다.`,
      });
    };

    const handleBatchProcess = async (
      value: string,
      selected: GenericScene[],
    ) => {
      const isMain = (scene: GenericScene, path: string) => {
        const filename = path.split('/').pop()!;
        return !!(scene && scene.mains.includes(filename));
      };
      if (value === 'removeImage') {
        appState.pushDialog({
          type: 'select',
          text: '이미지를 삭제합니다. 원하시는 작업을 선택해주세요.',
          items: [
            {
              text: '모든 이미지 삭제',
              value: 'all',
            },
            {
              text: '즐겨찾기 제외 모든 이미지 삭제',
              value: 'fav',
            },
            {
              text: '즐겨찾기 제외 n등 이하 이미지 삭제',
              value: 'n',
            },
          ],
          callback: async (menu) => {
            if (menu === 'all') {
              appState.pushDialog({
                type: 'confirm',
                text: '정말로 모든 이미지를 삭제하시겠습니까?',
                callback: async () => {
                  for (const scene of selected) {
                    const paths = gameService
                      .getOutputs(this.curSession!, scene)
                      .map(
                        (x) =>
                          imageService.getOutputDir(this.curSession!, scene!) +
                          '/' +
                          x,
                      );
                    await deleteImageFiles(this.curSession!, paths, scene);
                  }
                },
              });
            } else if (menu === 'n') {
              appState.pushDialog({
                type: 'input-confirm',
                text: '몇등 이하 이미지를 삭제할지 입력해주세요.',
                callback: async (value) => {
                  if (value) {
                    for (const scene of selected) {
                      const paths = gameService
                        .getOutputs(this.curSession!, scene)
                        .map(
                          (x) =>
                            imageService.getOutputDir(
                              this.curSession!,
                              scene!,
                            ) +
                            '/' +
                            x,
                        );
                      const n = parseInt(value);
                      await deleteImageFiles(
                        this.curSession!,
                        paths.slice(n).filter((x) => !isMain(scene, x)),
                        scene,
                      );
                    }
                  }
                },
              });
            } else if (menu === 'fav') {
              appState.pushDialog({
                type: 'confirm',
                text: '정말로 즐겨찾기 외 모든 이미지를 삭제하시겠습니까?',
                callback: async () => {
                  for (const scene of selected) {
                    const paths = gameService
                      .getOutputs(this.curSession!, scene)
                      .map(
                        (x) =>
                          imageService.getOutputDir(this.curSession!, scene!) +
                          '/' +
                          x,
                      );
                    await deleteImageFiles(
                      this.curSession!,
                      paths.filter((x) => !isMain(scene, x)),
                      scene,
                    );
                  }
                },
              });
            }
          },
        });
      } else if (value === 'removeAllFav') {
        appState.pushDialog({
          type: 'confirm',
          text: '정말로 모든 즐겨찾기를 해제하겠습니까?',
          callback: () => {
            for (const scene of selected) {
              scene.mains = [];
            }
          },
        });
      } else if (value === 'setFav') {
        appState.pushDialog({
          type: 'input-confirm',
          text: '몇등까지 즐겨찾기로 지정할지 입력해주세요',
          callback: async (value) => {
            if (value) {
              const n = parseInt(value);
              for (const scene of selected) {
                const cands = gameService
                  .getOutputs(this.curSession!, scene)
                  .slice(0, n);
                scene.mains = scene.mains
                  .concat(cands)
                  .filter((x, i, self) => self.indexOf(x) === i);
              }
            }
          },
        });
      } else if (value === 'removeBg') {
        removeBg(selected);
      } else if (value === 'deleteScenes') {
        deleteScenes(selected);
      } else if (value === 'cancelReservations') {
        cancelAllReservations(selected);
      } else if (value === 'export') {
        this.exportPackage(type, selected);
      } else if (value === 'transform') {
        const items = oneTimeFlows.map((x) => ({
          text: x.text,
          value: x.text,
        }));
        const menu = await appState.pushDialogAsync({
          text: '이미지 변형 방법을 선택하세요',
          type: 'select',
          items: items,
        });
        if (!menu) return;
        const menuItem = oneTimeFlowMap.get(menu)!;
        const input = menuItem.getInput
          ? await menuItem.getInput(this.curSession!)
          : undefined;
        for (const scene of selected) {
          for (let path of scene.mains) {
            path =
              imageService.getOutputDir(this.curSession!, scene) + '/' + path;
            let image = await imageService.fetchImage(path);
            image = dataUriToBase64(image!);
            const job = await extractPromptDataFromBase64(image);
            oneTimeFlowMap
              .get(menu)!
              .handler(
                appState.curSession!,
                scene,
                image,
                undefined,
                job,
                input,
              );
          }
        }
      } else if (value === 'exportSceneNames') {
        // 씬 이름에서 특수문자 구분자 감지
        const specialCharRegex = /[^a-zA-Z0-9가-힣ぁ-んァ-ヶ一-龥\u3000-\u303F]/g;
        const detectedChars = new Set<string>();
        for (const s of selected) {
          const matches = s.name.match(specialCharRegex);
          if (matches) matches.forEach((c) => detectedChars.add(c));
        }

        let charsToReplace = new Set<string>();
        let replacement = '_';
        if (detectedChars.size > 0) {
          const replacementInput = await appState.pushDialogAsync({
            type: 'input-confirm',
            text: '씬 이름의 특수문자를 변환할 대체 문자를 입력해주세요 (기본값: _)',
          });
          if (replacementInput === undefined) return;
          replacement = replacementInput || '_';

          const items = Array.from(detectedChars).map((c) => ({
            text: c === ' ' ? '띄어쓰기' : `"${c}"`,
            value: c,
          }));
          const result = await appState.pushDialogAsync({
            type: 'checkbox',
            text: `씬 이름에서 감지된 특수문자입니다.\n"${replacement}" 로 변환할 문자를 선택해주세요:`,
            items: items,
          });
          if (result === undefined) return;
          try {
            charsToReplace = new Set(JSON.parse(result));
          } catch (e) {
            // 파싱 실패 시 변환 없음
          }
        }

        let names: string;
        if (charsToReplace.size > 0) {
          const escaped = Array.from(charsToReplace).map(
            (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          ).join('|');
          const regex = new RegExp(`(${escaped})+`, 'g');
          names = selected.map((s) => s.name.replace(regex, replacement)).join(', ');
        } else {
          names = selected.map((s) => s.name).join(', ');
        }
        const path = 'exports/scene_names_' + Date.now().toString() + '.txt';
        await backend.writeFile(path, names);
        await backend.showFile(path);
        appState.pushMessage(`${selected.length}개 씬 이름을 내보냈습니다.`);
      } else if (value === 'sortScenes') {
        const allScenes = this.curSession!.getScenes(type);
        const selectedSet = new Set(selected.map(s => s.name));
        const selectedSorted = [...selected].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        const indices = allScenes
          .map((s, i) => selectedSet.has(s.name) ? i : -1)
          .filter(i => i !== -1);
        for (let i = 0; i < indices.length; i++) {
          this.curSession!.moveScene(selectedSorted[i], indices[i]);
        }
        appState.pushMessage('씬 정렬 완료');
      } else {
        console.log('Not implemented');
      }
    };

    const openMenu = () => {
      let items = [
        { text: '📁 이미지 내보내기', value: 'export' },
        { text: '🔪 즐겨찾기 이미지 배경 제거', value: 'removeBg' },
        { text: '🔄 즐겨찾기 이미지 변형', value: 'transform' },
        { text: '🗑️ 이미지 삭제', value: 'removeImage' },
        { text: '❌ 즐겨찾기 전부 해제', value: 'removeAllFav' },
        { text: '⭐ 상위 n등 즐겨찾기 지정', value: 'setFav' },
        { text: '📋 씬 내용 복제', value: 'copySceneContent' },
        { text: '📦 다른 프로젝트로 씬 복사', value: 'copyToProject' },
        { text: '📝 씬 이름 내보내기', value: 'exportSceneNames' },
        { text: '🗂️ 씬 일괄 삭제', value: 'deleteScenes' },
        { text: '🔤 씬 이름순 정렬', value: 'sortScenes' },
        { text: '⏹️ 예약 일괄 취소', value: 'cancelReservations' },
      ];
      if (type === 'inpaint') {
        items.push({ text: '🪞 이미지생성 탭 씬 이미지미러로 복제', value: 'mirrorDuplicate' });
      }
      if (isMobile) {
        items = items.filter((x) => x.value !== 'removeBg');
      }
      appState.pushDialog({
        type: 'select',
        text: '선택할 씬들에 적용할 대량 작업을 선택해주세요',
        graySelect: true,
        items: items,
        callback: (value, text) => {
          if (value === 'mirrorDuplicate') {
            const imageGenScenes = this.curSession!.getScenes('scene');
            if (imageGenScenes.length === 0) {
              appState.pushMessage('이미지생성 씬이 없습니다.');
              return;
            }
            setSceneSelector({
              type: 'inpaint',
              text: '🪞 미러로 복제할 이미지생성 씬 선택',
              scenes: imageGenScenes,
              callback: (selected) => {
                setSceneSelector(undefined);
                if (selected.length === 0) return;
                appState.pushDialog({
                  type: 'confirm',
                  text: `선택한 ${selected.length}개 씬을 이미지미러 씬으로 복제하시겠습니까?`,
                  callback: () => {
                    let count = 0;
                    for (const scene of selected) {
                      const src = scene as Scene;
                      const srcJSON = src.toJSON();
                      // 이름 충돌 해결
                      let name = src.name;
                      if (this.curSession!.hasScene('inpaint', name)) {
                        let i = 1;
                        while (
                          this.curSession!.hasScene('inpaint', `${name}_${i}`)
                        )
                          i++;
                        name = `${name}_${i}`;
                      }
                      // SDMirror 프리셋 생성 + 중위 프롬프트 동기화
                      const preset =
                        workFlowService.buildPreset('SDMirror');
                      if (
                        srcJSON.slots.length > 0 &&
                        srcJSON.slots[0].length > 0
                      ) {
                        preset.prompt = srcJSON.slots[0][0].prompt;
                      }
                      const newScene = InpaintScene.fromJSON({
                        type: 'inpaint',
                        name,
                        workflowType: 'SDMirror',
                        preset: preset.toJSON(),
                        resolution: 'portrait',
                        mains: [],
                        imageMap: [],
                        round: undefined,
                        game: undefined,
                        slots: srcJSON.slots,
                      });
                      if (newScene) {
                        this.curSession!.addScene(newScene);
                        count++;
                      }
                    }
                    appState.pushMessage(
                      `${count}개 씬이 이미지미러로 복제되었습니다.`,
                    );
                  },
                });
              },
            });
            return;
          }
          if (value === 'copySceneContent') {
            const allScenes = this.curSession!.getScenes(type);
            if (allScenes.length < 2) {
              appState.pushMessage('씬이 2개 이상 필요합니다.');
              return;
            }
            appState.pushDialog({
              type: 'dropdown',
              text: '내용을 복사할 원본 씬을 선택해주세요',
              items: allScenes.map((s) => ({ text: s.name, value: s.name })),
              callback: (sourceName) => {
                if (!sourceName) return;
                const sourceScene = allScenes.find((s) => s.name === sourceName);
                if (!sourceScene) return;
                const targetScenes = allScenes.filter((s) => s.name !== sourceName);
                setSceneSelector({
                  type: type,
                  text: `📋 내용 붙여넣기 (원본: ${sourceName})`,
                  scenes: targetScenes,
                  callback: (selected) => {
                    setSceneSelector(undefined);
                    if (selected.length === 0) return;
                    appState.pushDialog({
                      type: 'confirm',
                      text: `원본 '${sourceName}'의 내용을 선택한 ${selected.length}개 씬에 덮어씌우시겠습니까?`,
                      callback: () => {
                        if (sourceScene.type === 'scene' && type === 'scene') {
                          const src = sourceScene as Scene;
                          const srcJSON = src.toJSON();
                          for (const target of selected) {
                            const t = target as Scene;
                            t.slots = srcJSON.slots.map((slot) =>
                              slot.map((piece) => PromptPiece.fromJSON(piece)),
                            );
                            t.meta = new Map(Object.entries(srcJSON.meta ?? {}));
                            t.sceneCharacterPrompts = (srcJSON.sceneCharacterPrompts || []).map((cp) => ({
                              ...cp,
                              enabled: cp.enabled !== false,
                            }));
                            t.useSceneCharacterPrompts = srcJSON.useSceneCharacterPrompts || false;
                            t.sceneCharacterUC = srcJSON.sceneCharacterUC || '';
                          }
                        } else if (sourceScene.type === 'inpaint' && type === 'inpaint') {
                          const src = sourceScene as InpaintScene;
                          const srcJSON = src.toJSON();
                          for (const target of selected) {
                            const t = target as InpaintScene;
                            t.workflowType = srcJSON.workflowType;
                            t.preset = srcJSON.preset && workFlowService.presetFromJSON(srcJSON.preset);
                          }
                        }
                        appState.pushMessage(`${selected.length}개 씬에 내용이 복제되었습니다.`);
                      },
                    });
                  },
                });
              },
            });
            return;
          }
          if (value === 'copyToProject') {
            const curName = this.curSession!.name;
            const allProjects = sessionService.list().filter((n) => n !== curName);
            if (allProjects.length === 0) {
              appState.pushMessage('복사할 다른 프로젝트가 없습니다');
              return;
            }
            setSceneSelector({
              type: type,
              text: '📦 다른 프로젝트로 복사할 씬 선택',
              callback: (selected) => {
                setSceneSelector(undefined);
                if (selected.length === 0) return;

                appState.pushDialog({
                  text: '씬을 복사할 프로젝트를 선택하세요',
                  type: 'dropdown',
                  items: allProjects.map((n) => ({ text: n, value: n })),
                  callback: (targetName) => {
                    if (!targetName) return;

                    appState.pushDialog({
                      text: '복사 방식을 선택하세요',
                      type: 'select',
                      items: [
                        { text: '설정만 복사 (슬롯, 프롬프트 등)', value: 'config' },
                        { text: '이미지 포함 복사', value: 'with-images' },
                      ],
                      callback: async (mode) => {
                        if (!mode) return;

                        const targetSession = await sessionService.get(targetName);
                        if (!targetSession) {
                          appState.pushMessage('프로젝트를 불러올 수 없습니다');
                          return;
                        }

                        let totalCopied = 0;
                        let totalImages = 0;
                        for (const scene of selected) {
                          const newScene = genericSceneFromJSON(scene.toJSON());
                          let cnt = 0;
                          const baseName = newScene.name;
                          const newNameFn = () => baseName + (cnt === 0 ? '' : '_' + cnt);
                          while (targetSession.hasScene(newScene.type, newNameFn())) {
                            cnt++;
                          }
                          newScene.name = newNameFn();

                          if (mode === 'config') {
                            newScene.imageMap = [];
                            newScene.mains = [];
                          }

                          targetSession.addScene(newScene);

                          if (mode === 'with-images' && scene.imageMap.length > 0) {
                            const srcDir = imageService.getOutputDir(appState.curSession!, scene);
                            const dstDir = imageService.getOutputDir(targetSession, newScene);
                            for (const img of scene.imageMap) {
                              try {
                                await backend.copyFile(srcDir + '/' + img, dstDir + '/' + img);
                                totalImages++;
                              } catch (e) {
                                console.error('이미지 복사 실패:', img, e);
                              }
                            }
                          }
                          totalCopied++;
                        }

                        const msg = mode === 'with-images'
                          ? `${totalCopied}개 씬이 "${targetName}" 프로젝트에 복사되었습니다 (이미지 ${totalImages}장)`
                          : `${totalCopied}개 씬이 "${targetName}" 프로젝트에 복사되었습니다`;
                        appState.pushMessage(msg);
                      },
                    });
                  },
                });
              },
            });
            return;
          }
          setSceneSelector({
            type: type,
            text: text!,
            callback: (selected) => {
              setSceneSelector(undefined);
              handleBatchProcess(value!, selected);
            },
          });
        },
      });
    };
    openMenu();
  }

  @action
  openChangeResolutionMenu(
    type: 'scene' | 'inpaint',
    setSceneSelector: (item: SceneSelectorItem | undefined) => void,
  ) {
    setSceneSelector({
      type: type,
      text: '🖥️ 해상도 변경할 씬 선택',
      callback: async (selected) => {
        setSceneSelector(undefined);
        if (selected.length === 0) return;
        const options = Object.entries(resolutionMap)
          .filter((x) => !x[0].includes('small'))
          .map(([key, value]) => {
            if (key === 'custom')
              return { text: '커스텀 (직접 입력)', value: key };
            return {
              text: `${value.width}x${value.height}`,
              value: key,
            };
          });
        appState.pushDialog({
          type: 'dropdown',
          text: '변경할 해상도를 선택해주세요',
          items: options,
          callback: async (value?: string) => {
            if (!value) return;
            if (value === 'custom') {
              const width = await appState.pushDialogAsync({
                type: 'input-confirm',
                text: '해상도 너비를 입력해주세요',
              });
              if (width == null) return;
              const height = await appState.pushDialogAsync({
                type: 'input-confirm',
                text: '해상도 높이를 입력해주세요',
              });
              if (height == null) return;
              try {
                const w = (parseInt(width) + 63) & ~63;
                const h = (parseInt(height) + 63) & ~63;
                for (const scene of selected) {
                  scene.resolution = 'custom' as Resolution;
                  scene.resolutionWidth = w;
                  scene.resolutionHeight = h;
                }
              } catch (e: any) {
                appState.pushMessage(e.message);
              }
              return;
            }
            const action = () => {
              for (const scene of selected) {
                scene.resolution = value as Resolution;
              }
            };
            if (value.includes('large') || value.includes('wallpaper')) {
              appState.pushDialog({
                text: 'Anlas를 소모하는 해상도 입니다. 계속하겠습니까?',
                type: 'confirm',
                callback: () => {
                  action();
                },
              });
            } else {
              action();
            }
          },
        });
      },
    });
  }

  @action
  async emptyProjectImageTrashWithConfirm() {
    if (!this.curSession) return;
    const { trashService } = await import('.');
    const { totalImages, scenesWithTrash } =
      await trashService.countProjectImageTrash(this.curSession);
    if (totalImages === 0) {
      this.pushMessage('삭제된 이미지가 없습니다.');
      return;
    }
    appState.pushDialog({
      type: 'confirm',
      text:
        `이 프로젝트의 ${scenesWithTrash}개 씬에서 삭제된 이미지 ` +
        `${totalImages}개를 영구 삭제하시겠습니까? (복원 불가)`,
      callback: async () => {
        const deleted = await trashService.emptyProjectImageTrash(
          this.curSession!,
        );
        appState.pushDialog({
          type: 'yes-only',
          text: `${deleted}개의 이미지가 영구 삭제되었습니다.`,
        });
      },
    });
  }

  @action
  async recoverProjectImages() {
    if (!this.curSession) return;
    const session = this.curSession;

    // outs/<세션명>/ 디렉토리에서 씬 폴더 목록 조회
    let sceneDirs: string[] = [];
    try {
      const entries = await backend.listFiles('outs/' + session.name);
      // 디렉토리만 필터링 (확장자 없는 항목 = 디렉토리)
      sceneDirs = entries.filter((e: string) => !e.includes('.'));
    } catch {
      // outs 디렉토리 자체가 없으면 복구할 것 없음
    }

    if (sceneDirs.length === 0) {
      this.pushDialog({
        type: 'yes-only',
        text: '파일시스템에서 복구할 이미지 폴더를 찾지 못했습니다.',
      });
      return;
    }

    // 현재 세션에 없는 씬 폴더 찾기
    let recoveredScenes = 0;
    let recoveredImages = 0;

    for (const dirName of sceneDirs) {
      // 해당 폴더에 PNG 파일이 있는지 확인
      let pngFiles: string[] = [];
      try {
        const files = await backend.listFiles('outs/' + session.name + '/' + dirName);
        pngFiles = files.filter((f: string) => f.endsWith('.png'));
      } catch {
        continue;
      }
      if (pngFiles.length === 0) continue;

      if (!session.scenes.has(dirName)) {
        // 씬이 JSON에서 사라진 경우: 빈 씬 생성
        session.addScene(
          Scene.fromJSON({
            type: 'scene',
            name: dirName,
            resolution: 'portrait',
            slots: [
              [
                {
                  id: v4(),
                  prompt: '',
                  characterPrompts: [],
                  enabled: true,
                },
              ],
            ],
            mains: [],
            imageMap: [],
            meta: {},
          } as any),
        );
        recoveredScenes++;
      }

      // 씬의 imageMap이 비어있지만 파일은 있는 경우도 카운트
      const scene = session.scenes.get(dirName);
      if (scene && scene.imageMap.length === 0 && pngFiles.length > 0) {
        recoveredImages += pngFiles.length;
      }
    }

    // refreshBatch로 모든 씬의 imageMap 갱신 (파일시스템에서 재발견)
    await imageService.refreshBatch(session);

    // 결과 보고
    if (recoveredScenes === 0 && recoveredImages === 0) {
      this.pushDialog({
        type: 'yes-only',
        text: '모든 씬의 이미지가 정상입니다. 복구할 항목이 없습니다.',
      });
    } else {
      const parts: string[] = [];
      if (recoveredScenes > 0) parts.push(`${recoveredScenes}개 씬 복원`);
      if (recoveredImages > 0) parts.push(`${recoveredImages}개 이미지 재연결`);
      this.pushDialog({
        type: 'yes-only',
        text: `복구 완료: ${parts.join(', ')}`,
      });
    }
  }

  closeExternalImage() {
    this.externalImage = undefined;
  }

  @action
  setAppliedCharacterPreset(presetName: string | undefined) {
    const session = this.curSession;
    if (!session) return;
    const workflowType = session.selectedWorkflow?.workflowType;
    if (!workflowType) return;
    const shared = session.presetShareds.get(workflowType);
    if (shared) {
      shared._appliedPresetName = presetName || '';
    }
  }

  @action
  clearAppliedCharacterPreset() {
    if (!this.curSession) return;

    const workflowType = this.curSession.selectedWorkflow?.workflowType;
    if (!workflowType) return;

    const shared = this.curSession.presetShareds.get(workflowType);
    if (!shared) return;

    // 프리셋에서 추가된 항목만 제거 (사용자 직접 추가 항목은 유지)
    shared.vibes = (shared.vibes || []).filter((v: any) => !v.fromPreset);
    shared.characterReferences = (shared.characterReferences || []).filter((r: any) => !r.fromPreset);
    if (shared.characterPrompts) {
      shared.characterPrompts = shared.characterPrompts.filter((cp: any) => !cp.fromPreset);
    }

    if (workflowType === 'SDImageGenEasy') {
      shared.characterPrompt = '';
      shared.backgroundPrompt = '';
      shared.uc = '';
    }

    shared._appliedPresetName = '';
    this.pushMessage('캐릭터 프리셋이 해제되었습니다');
  }

  /**
   * 현재 적용된 캐릭터 프리셋 객체를 가져옵니다.
   * @returns 현재 적용된 CharacterPreset 객체 또는 undefined
   */
  getAppliedCharacterPreset(): CharacterPreset | undefined {
    if (!this.curSession || !this.appliedCharacterPreset) {
      return undefined;
    }
    return this.curSession.getCharacterPreset(this.appliedCharacterPreset);
  }

  /**
   * 프로젝트 로드 시 삭제된 캐릭터 프리셋이 적용 중인 상태를 정리
   */
  cleanupOrphanedPresetApplication() {
    if (!this.curSession) return;

    for (const [, shared] of this.curSession.presetShareds) {
      if (!shared) continue;

      const presetName = shared._appliedPresetName;

      if (presetName && !this.curSession.hasCharacterPreset(presetName)) {
        // 존재하지 않는 프리셋이 적용 중 → 프리셋 태그 항목만 정리
        shared.vibes = (shared.vibes || []).filter((v: any) => !v.fromPreset);
        shared.characterReferences = (shared.characterReferences || []).filter((r: any) => !r.fromPreset);
        if (shared.characterPrompts) {
          shared.characterPrompts = shared.characterPrompts.filter((cp: any) => !cp.fromPreset);
        }
        shared._appliedPresetName = '';
      }

      // 캐릭터 프롬프트 중복 제거 (이전 버전 오염 데이터 정리)
      if (shared.characterPrompts && shared.characterPrompts.length > 1) {
        const seen = new Set<string>();
        shared.characterPrompts = shared.characterPrompts.filter((cp: any) => {
          const key = (cp.prompt || '') + '\0' + (cp.uc || '');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
    }
  }

  /**
   * 여러 그림체 파일을 한번에 가져오기
   */
  async importMultiplePresets() {
    if (!this.curSession) {
      this.pushMessage('세션을 먼저 선택해주세요.');
      return;
    }

    const files = await backend.selectFiles({
      filters: [
        { name: 'PNG 이미지', extensions: ['png'] },
        { name: '모든 파일', extensions: ['*'] },
      ],
    });

    if (!files || files.length === 0) {
      return;
    }

    this.setProgressDialog({
      text: '그림체 가져오는 중...',
      done: 0,
      total: files.length,
    });

    const results = {
      success: 0,
      failed: 0,
      failedNames: [] as string[],
    };

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
      
      try {
        // 파일 읽기
        const base64 = await backend.readBinaryFile(filePath);
        
        // 프리셋 가져오기
        const preset = await importPreset(this.curSession!, base64);
        
        if (preset) {
          results.success++;
        } else {
          results.failed++;
          results.failedNames.push(fileName);
        }
      } catch (e: any) {
        console.error(`Failed to import preset from ${fileName}:`, e);
        results.failed++;
        results.failedNames.push(fileName);
      }

      this.setProgressDialog({
        text: '그림체 가져오는 중...',
        done: i + 1,
        total: files.length,
      });
    }

    this.setProgressDialog(undefined);

    // 결과 메시지 표시
    if (results.success > 0 && results.failed === 0) {
      this.pushDialog({
        type: 'yes-only',
        text: `${results.success}개의 그림체를 성공적으로 가져왔습니다.`,
      });
    } else if (results.success > 0 && results.failed > 0) {
      this.pushDialog({
        type: 'yes-only',
        text: `${results.success}개의 그림체를 가져왔습니다.\n${results.failed}개의 파일은 유효한 그림체 파일이 아닙니다:\n${results.failedNames.slice(0, 5).join('\n')}${results.failedNames.length > 5 ? '\n...' : ''}`,
      });
    } else {
      this.pushDialog({
        type: 'yes-only',
        text: '선택한 파일들 중 유효한 그림체 파일이 없습니다.',
      });
    }

    // 첫 번째로 성공한 그림체 선택
    if (results.success > 0) {
      const presets = this.curSession!.presets.get('SDImageGenEasy');
      if (presets && presets.length > 0) {
        const lastPreset = presets[presets.length - 1];
        this.curSession!.selectedWorkflow = {
          workflowType: lastPreset.type,
          presetName: lastPreset.name,
        };
      }
    }
  }
}

export const appState = new AppState();
