import {
  exportPresetService,
  batchProcessService,
  backupService,
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
import { setAppState } from './appStateRef';
import type { Config, UiToolbarConfig, UiLayoutSlots } from '../../main/config';
import type { GlobalPresetType, IGlobalPresetEntry } from './GlobalPresetService';
import { SUPPORTED_GLOBAL_PRESET_TYPES } from './GlobalPresetService';
import { isOutputImageFile, isImportImageMime } from './imageFormats';
import { projectPath } from './projectPaths';
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

export interface ExportPreset {
  name: string;
  menu: 'fav' | 'all';
  format: 'normal' | 'prefix' | 'prefix_ask';
  prefix: string;
  opt: 'original' | 'lossy' | 'lossless' | 'avif';
  imageSize: number;
  /** 압축 화질(1~100). 미설정 시 기본값(webp 80·avif 50). lossy/avif 만 적용. */
  quality?: number;
  /** NAI 스테가노그래피(알파 워터마크) 보존. webp(lossy/lossless)만 유효. 느려짐. */
  preserveStealth?: boolean;
  separator: string;
  // ── 신규 옵션 (모두 선택적 — 구형 프리셋은 그대로 동작, 마이그레이션 불필요) ──
  /** 파일명 패턴: 'scene'(기본=현행) / 프로젝트명 / 폴더명+프로젝트명 접두 */
  filenamePattern?: 'scene' | 'project.scene' | 'folder.project.scene';
  /** 출력 형태: 'tar'(기본, 압축파일) / 'files'(개별 이미지 파일) */
  outputMode?: 'tar' | 'files';
  /** 캐릭터 프리셋 접두/접미사 적용 여부 (미설정 시 true = 적용) */
  applyCharacterAffix?: boolean;
  /** 켜면 씬 이름 특수문자를 묻지 않고 전부 구분자로 자동 변환 (기본 false) */
  autoConvertSeparator?: boolean;
  /** 데스크톱 전용: 내보내기 목표 폴더(절대경로). 빈값이면 글로벌 기본 폴더 사용 */
  targetFolder?: string;
  /** 데스크톱 전용: 목표 폴더 아래 프로젝트 폴더 경로로 하위 폴더 생성 */
  useProjectRelativePath?: boolean;
  /** ⚡ 빠른 export 버튼이 사용할 기본 프리셋 여부 */
  isDefault?: boolean;
}

export interface SceneSelectorItem {
  type: 'scene' | 'inpaint';
  text: string;
  callback: (scenes: GenericScene[]) => void;
  scenes?: GenericScene[];
}


export class AppState {
  // 부팅 완료 여부 — bootstrapApp() 이 모든 준비(설정·세션 스캔·로컬 데이터 로드)를
  // 마치면 true. App 이 이 값으로 메인 UI 마운트를 게이트해 "준비 전 사용" race 를
  // 원천 차단한다. (부팅이 일부 실패해도 앱은 뜬다 — bootstrap 이 finally 로 보장)
  @observable accessor bootReady: boolean = false;
  // 부팅 대기 화면의 보조 안내 문구 (예: 저장소 권한 대기). 빈 문자열 = 기본 문구.
  @observable accessor bootStatusMessage: string = '';
  @observable accessor curSession: Session | undefined = undefined;
  // 토스트 메시지: 각 항목이 고유 id를 가져 개별 타이머/개별 닫기가 가능하다.
  @observable accessor messages: { id: number; text: string }[] = [];
  private messageIdCounter = 0;
  @observable accessor dialogs: Dialog[] = [];
  @observable accessor samples: number = 1;
  @observable accessor progressDialog: ProgressDialog | undefined = undefined;
  // 이미지 복구 진행 중 재진입 가드(중복 터치로 스캔이 동시에 두 번 도는 것 차단)
  private recovering = false;
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

  // 씬 다중 선택 (Ctrl+클릭 or 드래그)
  @observable accessor selectedScenes: Set<string> = new Set();

  // 모바일 전용: 씬 다중 선택 모드. 켜지면 씬 탭이 이미지 그리드 열기 대신
  // 선택 토글로 동작한다. (PC 는 Ctrl+클릭/드래그/Ctrl+S 로 선택하므로 미사용)
  @observable accessor sceneSelectionMode: boolean = false;

  // 이미지 삭제 확인 건너뛰기 (세션 스코프)
  @observable accessor skipImageDeleteConfirm: boolean = false;

  @action
  toggleSceneSelection(name: string) {
    const next = new Set(this.selectedScenes);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.selectedScenes = next;
  }

  @action
  addScenesToSelection(names: string[]) {
    const next = new Set(this.selectedScenes);
    for (const name of names) next.add(name);
    this.selectedScenes = next;
  }

  @action
  removeScenesFromSelection(names: string[]) {
    const next = new Set(this.selectedScenes);
    for (const name of names) next.delete(name);
    this.selectedScenes = next;
  }

  @action
  clearSceneSelection() {
    this.selectedScenes = new Set();
  }

  // 만료 프로젝트 알림
  @observable accessor pendingExpiredProjects: {name: string, deletedAt: number}[] = [];

  // 씬 카드 디자인 설정
  @observable accessor classicSceneCard: boolean = false;

  // 레거시 프로젝트 모드: true면 기존 드롭다운 선택 UI 유지(드로어/드롭다운/그리드 공존),
  // false(기본)면 드롭다운을 제거하고 드로어 트리거로 전환
  @observable accessor legacyProjectMode: boolean = false;

  // 툴바 버튼 배치 커스터마이징(config.uiToolbar 미러). 빈 객체 = 기본 등급.
  // 배치 해석은 resolveToolbar(uiLayout.ts) 단일 출처.
  @observable accessor uiToolbar: UiToolbarConfig = {};

  // 레이아웃 템플릿 id(config.uiLayoutTemplate 미러). 기본 'classic'.
  // 배치 해석은 resolveLayout(layoutTemplates.ts) 단일 출처.
  @observable accessor uiLayoutTemplate: string = 'classic';

  // PC 전용 플로팅 생성 컨트롤(config.genWidget 미러). 빈 객체 = 부착 상태(기본).
  // detached 여부·위치는 GenControlWidget.tsx 가 조작·저장한다.
  @observable accessor genWidget: NonNullable<Config['genWidget']> = {};

  // 레이아웃 슬롯 개인화(config.uiLayoutSlots 미러). 빈 객체 = 템플릿 기본(기존 동작).
  // 배치 해석은 resolveLayout(layoutTemplates.ts) 단일 출처. 부팅 시 로드는 App.tsx 담당.
  @observable accessor uiLayoutSlots: UiLayoutSlots = {};

  // 창 배치(config.uiFloatViewMode 미러) — FloatView(뷰어 등)가 덮는 영역.
  // 'cover'(기본)=좌우 패널 위로 넓게 / 'center'=중앙 콘텐츠만. 소비는 FloatView.tsx.
  @observable accessor uiFloatViewMode: 'cover' | 'center' = 'cover';

  // 앱 글꼴(config.uiFont 미러) — 'system'(기본) / 'pretendard'.
  // 적용은 App.tsx 가 html 에 font-system 클래스를 토글하는 방식(App.css 참조).
  @observable accessor uiFont: 'pretendard' | 'system' = 'system';

  // 클래식 마감(config.uiClassicFinish 미러) — true 면 심미 개편 전 모양으로 복원.
  // 적용은 App.tsx 가 html 에 finish-classic 클래스를 토글하는 방식(App.css 참조).
  @observable accessor uiClassicFinish = false;

  // 편집 모드(PC 전용): 화면에서 UI 배치 직접 조작. EditModeShell 이 켜져 있는 동안
  // 툴바 버튼은 클릭 대신 드래그 편집 대상이 된다.
  @observable accessor editMode = false;

  // 저장소 접근 불안정 시 자동 저장 일시정지(서킷 브레이커). true(기본)면 보호 활성.
  // ConfigScreen 저장/부팅 시 config.storageWriteGuard 값으로 갱신된다.
  @observable accessor storageWriteGuard: boolean = true;

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
  @observable accessor showSceneCheatsheet: boolean = true;
  @observable accessor showTournamentCheatsheet: boolean = true;

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

  // 우측 히스토리 패널 (PC push). 기본 접힘 — 기존 레이아웃 불변.
  @observable accessor historyPanelCollapsed: boolean = (() => {
    return localStorage.getItem('sdstudio-history-panel-collapsed') !== 'false';
  })();

  // 히스토리 패널 폭 — 접기 스트립 드래그로 조절(프리셋 패널 폭과 동일한 방식/저장).
  @observable accessor historyPanelWidth: number = (() => {
    const saved = localStorage.getItem('sdstudio-history-panel-width');
    return saved ? Math.max(200, Math.min(600, parseInt(saved, 10) || 240)) : 240;
  })();

  @action
  setHistoryPanelWidth(w: number) {
    this.historyPanelWidth = w;
    localStorage.setItem('sdstudio-history-panel-width', String(w));
  }

  @action
  toggleHistoryPanel() {
    this.historyPanelCollapsed = !this.historyPanelCollapsed;
    localStorage.setItem(
      'sdstudio-history-panel-collapsed',
      String(this.historyPanelCollapsed),
    );
  }

  // 히스토리 목록 열 수 (1열=크게 / 2열=조밀). PC 패널·모바일 드로어 공용.
  @observable accessor historyColumns: 1 | 2 = (() => {
    return localStorage.getItem('sdstudio-history-columns') === '1' ? 1 : 2;
  })();

  @action
  toggleHistoryColumns() {
    this.historyColumns = this.historyColumns === 2 ? 1 : 2;
    localStorage.setItem('sdstudio-history-columns', String(this.historyColumns));
  }

  // 모바일 우측 히스토리 드로어 (비영속)
  @observable accessor historyDrawerOpen: boolean = false;

  @action
  addMessage(message: string): void {
    this.messages.push({ id: ++this.messageIdCounter, text: message });
    // 폭주 방지: 최대 8개만 유지(오래된 것부터 제거)
    if (this.messages.length > 8) {
      this.messages.splice(0, this.messages.length - 8);
    }
  }

  @action
  removeMessage(id: number): void {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx >= 0) this.messages.splice(idx, 1);
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
    this.addMessage(msg);
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
        // 원본 확장자 보존(webp/png) — 고정 .png 로 붙여넣으면 내용/확장자 불일치
        const ext = srcPath.split('.').pop() || 'png';
        const filename = Date.now().toString() + '_' + copied + '.' + ext;
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

  // 내보내기 완료 표시. 모바일은 파일 열기/공유 시트가 완료를 알리므로 별도 표시하지
  // 않는다(중복 방지). PC는 우하단 위젯을 "완료"로 전환하고 15초 뒤 자동 소멸시킨다.
  private exportCompleteTimer: any = undefined;
  showExportComplete(text: string = '내보내기 완료') {
    if (isMobile) {
      this.exportProgress = undefined;
      return;
    }
    this.exportProgress = { text, done: 1, total: 1, completed: true };
    if (this.exportCompleteTimer) clearTimeout(this.exportCompleteTimer);
    this.exportCompleteTimer = setTimeout(() => {
      // 그 사이 새 내보내기가 시작됐으면(진행 위젯이면) 건드리지 않는다.
      if (this.exportProgress?.completed) this.exportProgress = undefined;
      this.exportCompleteTimer = undefined;
    }, 15000);
  }
  dismissExportComplete() {
    if (this.exportCompleteTimer) {
      clearTimeout(this.exportCompleteTimer);
      this.exportCompleteTimer = undefined;
    }
    this.exportProgress = undefined;
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
    } else if (isImportImageMime(file.type)) {
      // png/webp/jpeg 등 임포트 가능한 이미지 → 메타데이터 추출 (handlePngImport 가
      // png 가 아니면 readJSONFromPNG 실패 후 externalImage 프롬프트 추출 뷰로 폴백).
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


  // ── 백업/내보내기/가져오기: BackupService 로 분리됨 (UI 호환 위임) ──
  projectBackupMenu() { return backupService.projectBackupMenu(); }
  duplicateProject() { return backupService.duplicateProject(); }
  deleteFolderWithProjects(folder: string) { return backupService.deleteFolderWithProjects(folder); }
  folderBackupMenu(folder: string) { return backupService.folderBackupMenu(folder); }
  fullBackupMenu() { return backupService.fullBackupMenu(); }
  globalPresetBackupExport() { return backupService.globalPresetBackupExport(); }
  globalPresetBackupImport() { return backupService.globalPresetBackupImport(); }
  artistLibraryBackupExport() { return backupService.artistLibraryBackupExport(); }
  artistLibraryBackupImport() { return backupService.artistLibraryBackupImport(); }
  handleTarImport(tarPath: string) { return backupService.handleTarImport(tarPath); }
  handlePngImport(base64: string) { return backupService.handlePngImport(base64); }



  // ── 내보내기 프리셋/패키지: ExportPresetService 로 분리됨 (UI 호환 위임) ──
  initExportPresets() { return exportPresetService.initExportPresets(); }
  loadExportPresets() { return exportPresetService.loadExportPresets(); }
  saveExportPresets(presets: ExportPreset[]) { return exportPresetService.saveExportPresets(presets); }
  detectSpecialCharsFromNames(sceneNames: string[], separator: string, autoConvert = false) { return exportPresetService.detectSpecialCharsFromNames(sceneNames, separator, autoConvert); }
  exportPackage(type: 'scene' | 'inpaint', selected?: GenericScene[]) { return exportPresetService.exportPackage(type, selected); }
  quickExportPackage(type: 'scene' | 'inpaint', selected?: GenericScene[]) { return exportPresetService.quickExportPackage(type, selected); }
  exportPreset(session: Session, preset: any) { return exportPresetService.exportPreset(session, preset); }



  // ---------------- 이미지 → 글로벌 프리셋 / 작가 라이브러리 저장 ----------------

  // 생성 이미지 우클릭 → "글로벌 프리셋으로 저장": 이름 입력 후 메타데이터 추출해 저장.
  async saveImageAsGlobalPreset(path: string): Promise<void> {
    try {
      const dataUri = await backend.readDataFile(path);
      if (!dataUri) {
        this.pushMessage('이미지를 읽을 수 없습니다.');
        return;
      }
      const base64 = dataUriToBase64(dataUri);
      const name = await this.pushDialogAsync({
        type: 'input-confirm',
        text: '글로벌 프리셋 이름을 입력하세요',
      });
      if (!name) return;
      const entry = await globalPresetService.addImageAsPreset(base64, name);
      this.pushDialog({
        type: 'yes-only',
        text: `"${entry.name}" 글로벌 프리셋으로 저장했습니다.`,
      });
    } catch (e: any) {
      this.pushMessage('글로벌 프리셋 저장 실패: ' + (e.message || e));
    }
  }

  // 생성 이미지 우클릭 → "작가 라이브러리에 저장": 새 작가 / 기존 작가 선택.
  async saveImageToArtistLibrary(path: string): Promise<void> {
    try {
      const dataUri = await backend.readDataFile(path);
      if (!dataUri) {
        this.pushMessage('이미지를 읽을 수 없습니다.');
        return;
      }
      const base64 = dataUriToBase64(dataUri);
      const hasArtists = artistLibraryService.artists.length > 0;
      const mode = await this.pushDialogAsync({
        type: 'select',
        text: '작가 라이브러리에 어떻게 저장할까요?',
        items: [
          { text: '새 작가로 추가', value: 'new' },
          ...(hasArtists
            ? [{ text: '기존 작가에 이미지 추가', value: 'existing' }]
            : []),
        ],
      });
      if (!mode || mode === 'cancel') return;

      let artistId: string | undefined;
      let artistName = '';
      if (mode === 'new') {
        const name = await this.pushDialogAsync({
          type: 'input-confirm',
          text: '작가 이름을 입력하세요 (예: suko mugi)',
        });
        if (!name) return;
        const a = artistLibraryService.createArtist(name);
        if (!a) {
          this.pushMessage('작가 생성에 실패했습니다.');
          return;
        }
        artistId = a.id;
        artistName = a.name;
      } else {
        const id = await this.pushDialogAsync({
          type: 'select',
          text: '어느 작가에 이미지를 추가할까요?',
          items: artistLibraryService.artists.map((a) => ({
            text: `${a.name} (${a.images.length}장)`,
            value: a.id,
          })),
        });
        if (!id || id === 'cancel') return;
        const a = artistLibraryService.getArtist(id);
        if (!a) {
          this.pushMessage('작가를 찾을 수 없습니다.');
          return;
        }
        artistId = a.id;
        artistName = a.name;
      }
      await artistLibraryService.addImage(artistId!, base64);
      this.pushDialog({
        type: 'yes-only',
        text: `"${artistName}"에 이미지를 추가했습니다.`,
      });
    } catch (e: any) {
      this.pushMessage('작가 라이브러리 저장 실패: ' + (e.message || e));
    }
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
    targetType?: GlobalPresetType,
  ): Promise<void> {
    try {
      const preset = await globalPresetService.instantiateIntoSession(
        session,
        globalId,
        targetType,
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
        // 통합: 어떤 글로벌 프리셋이든 현재 모드(workflowType)로 변환해 적용
        await this.importGlobalPresetIntoSession(session, id, workflowType);
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


  // ── 배치 처리: BatchProcessService 로 분리됨 (UI 호환 위임) ──
  openBatchProcessMenu(type: 'scene' | 'inpaint', setSceneSelector: (item: SceneSelectorItem | undefined) => void) { return batchProcessService.openBatchProcessMenu(type, setSceneSelector); }
  openChangeResolutionMenu(type: 'scene' | 'inpaint', setSceneSelector: (item: SceneSelectorItem | undefined) => void) { return batchProcessService.openChangeResolutionMenu(type, setSceneSelector); }
  openConvertToWebpMenu(type: 'scene' | 'inpaint', setSceneSelector: (item: SceneSelectorItem | undefined) => void) { return batchProcessService.openConvertToWebpMenu(type, setSceneSelector); }


  @action
  async emptyProjectImageTrashWithConfirm() {
    if (!this.curSession) return;
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
    // 중복 터치 차단: 첫 await 이전에 동기적으로 가드를 세워, 스캔이 두 번 도는 것을 막는다.
    if (this.recovering) return;
    if (!this.curSession) return;
    const session = this.curSession;
    this.recovering = true;
    // 전체화면 차단 오버레이(progressDialog)를 띄워 스캔/로딩 중 다른 입력을 막는다.
    this.setProgressDialog({ text: '이미지 복구 준비 중...', done: 0, total: 1 });

    let resultText: string;
    try {
      // outs/<세션명>/ 디렉토리에서 씬 폴더 목록 조회
      let sceneDirs: string[] = [];
      try {
        const entries = await backend.listFiles(projectPath('outs', session.name));
        // 디렉토리만 필터링 (확장자 없는 항목 = 디렉토리)
        sceneDirs = entries.filter((e: string) => !e.includes('.'));
      } catch {
        // outs 디렉토리 자체가 없으면 복구할 것 없음
      }

      if (sceneDirs.length === 0) {
        resultText = '파일시스템에서 복구할 이미지 폴더를 찾지 못했습니다.';
      } else {
        // 현재 세션에 없는 씬 폴더 찾기
        let recoveredScenes = 0;
        let recoveredImages = 0;

        this.setProgressDialog({
          text: '이미지 복구 중...',
          done: 0,
          total: sceneDirs.length,
        });
        for (let i = 0; i < sceneDirs.length; i++) {
          const dirName = sceneDirs[i];
          // 해당 폴더에 PNG 파일이 있는지 확인
          let pngFiles: string[] = [];
          try {
            const files = await backend.listFiles(
              projectPath('outs', session.name, dirName),
            );
            pngFiles = files.filter(isOutputImageFile);
          } catch {
            this.setProgressDialog({
              text: '이미지 복구 중...',
              done: i + 1,
              total: sceneDirs.length,
            });
            continue;
          }
          if (pngFiles.length === 0) {
            this.setProgressDialog({
              text: '이미지 복구 중...',
              done: i + 1,
              total: sceneDirs.length,
            });
            continue;
          }

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
          this.setProgressDialog({
            text: '이미지 복구 중...',
            done: i + 1,
            total: sceneDirs.length,
          });
        }

        // refreshBatch로 모든 씬의 imageMap 갱신 (파일시스템에서 재발견)
        this.setProgressDialog({
          text: '이미지 재연결 중...',
          done: sceneDirs.length,
          total: sceneDirs.length,
        });
        await imageService.refreshBatch(session);

        // 결과 메시지 구성
        if (recoveredScenes === 0 && recoveredImages === 0) {
          resultText = '모든 씬의 이미지가 정상입니다. 복구할 항목이 없습니다.';
        } else {
          const parts: string[] = [];
          if (recoveredScenes > 0) parts.push(`${recoveredScenes}개 씬 복원`);
          if (recoveredImages > 0) parts.push(`${recoveredImages}개 이미지 재연결`);
          resultText = `복구 완료: ${parts.join(', ')}`;
        }
      }
    } catch (e) {
      resultText = '복구 중 오류가 발생했습니다.';
    } finally {
      // 오버레이를 먼저 닫고(입력 차단 해제) 가드를 푼다.
      this.setProgressDialog(undefined);
      this.recovering = false;
    }

    // 결과는 오버레이가 닫힌 뒤 표시한다.
    this.pushDialog({ type: 'yes-only', text: resultText });
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
// 순환 import 게이트에 자기 등록 — 서비스들은 getAppState() 로 접근한다
setAppState(appState);
