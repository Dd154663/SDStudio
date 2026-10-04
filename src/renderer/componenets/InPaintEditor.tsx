import { useContext, useEffect, useRef, useState } from 'react';
import Tooltip from './Tooltip';
import BrushTool, {
  BrushToolRef,
  base64ToDataUri,
  getImageDimensions,
} from './BrushTool';
import { DropdownSelect, TabComponent } from './UtilComponents';
import { Resolution, resolutionMap } from '../backends/imageGen';
import {
  FaArrowLeft,
  FaArrowsAlt,
  FaPlay,
  FaStop,
  FaUndo,
  FaImages,
  FaPuzzlePiece,
} from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import {
  isMobile,
  imageService,
  workFlowService,
  taskQueueService,
} from '../models';
import { dataUriToBase64 } from '../models/ImageService';
import { InpaintScene, PromptPiece, Scene } from '../models/types';
import { COMBO_EDITOR_TEXT, COMBO_EMPTY_TEXT, variantComboMode } from '../models/comboMode';
import {
  combinationMiddlePrompt,
  enumerateCombinations,
} from '../models/PromptService';
import { extractPromptDataFromBase64 } from '../models/util';
import { appState } from '../models/AppService';
import {
  checkInpaintSceneRename,
  DELETE_RESULT_TEXT,
  deleteConfirmText,
  runTrashDelete,
} from '../models/deleteFlowRules';
import { SCENE_RETENTION_DAYS } from '../models/TrashService';
import { promptCustomResolution } from '../models/customResolutionPrompt';
import { renameInpaintScene } from '../models/SessionService';
import { observer } from 'mobx-react-lite';
import { InnerPreSetEditor } from './PreSetEdtior';
import { reaction, runInAction } from 'mobx';
import { FloatView } from './FloatView';
import { TaskProgressBar } from './TaskQueueControl';
import {
  lowerResolution,
  queueI2IWorkflow,
  queueMirrorWorkflow,
} from '../models/TaskQueueService';
import {
  applyImageResolution,
  IMAGE_RESOLUTION_TEXT,
  ImageResolution,
  imageResolutionMismatch,
  paidResolutionNotice,
  resolutionFromImage,
  workflowUsesImageResolution,
} from '../models/inpaintResolution';
import { prepareMirrorCanvas, SDI2IComboUI } from '../models/workflows/SDWorkFlow';
import PromptEditTextArea from './PromptEditTextArea';
import { SlotEditor } from './SceneEditor';
import { v4 as uuidv4 } from 'uuid';
import FocusAreaOverlay from './FocusAreaOverlay';
import {
  FOCUS_CONTEXT_MAX,
  FOCUS_CONTEXT_MIN,
  FOCUS_GRID,
  normalizeFocusContext,
} from '../models/focusedInpaint';
import {
  FOCUS_EDITOR_TEXT,
  FocusDragResult,
  focusRectPresetPatch,
  focusRequestLabel,
  inpaintPointerTarget,
  presetFocusRect,
  presetSupportsFocus,
  reconcileFocusRect,
} from '../models/focusedInpaintEditor';

interface Props {
  editingScene: InpaintScene;
  onConfirm: () => void;
  onDelete: () => void;
}

let brushSizeSaved = 10;

const InPaintEditor = observer(
  ({ editingScene, onConfirm, onDelete }: Props) => {
    const [_, rerender] = useState({});
    const editingSceneRef = useRef(editingScene);
    editingSceneRef.current = editingScene;
    useEffect(() => {
      const handleProgress = () => {
        rerender({});
      };
      taskQueueService.addEventListener('start', handleProgress);
      taskQueueService.addEventListener('stop', handleProgress);
      taskQueueService.addEventListener('progress', handleProgress);
      return () => {
        taskQueueService.removeEventListener('start', handleProgress);
        taskQueueService.removeEventListener('stop', handleProgress);
        taskQueueService.removeEventListener('progress', handleProgress);
      };
    });
    const { curSession } = appState;
    const resolutionOptions = Object.entries(resolutionMap)
      .map(([key, value]) => {
        const resolVal =
          (editingScene.resolutionWidth ?? '') +
          'x' +
          (editingScene.resolutionHeight ?? '');
        if (key === 'custom')
          return { label: '커스텀 (' + resolVal + ')', value: key };
        return { label: `${value.width}x${value.height}`, value: key };
      })
      .filter((x) => !x.value.startsWith('small'));

    const [image, setImage] = useState('');
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);
    // 크기를 잰 이미지(같은 이미지일 때만 해상도 불일치 안내 — 씬 전환 직후 옛 크기로 판단하지 않게)
    const [loadedDims, setLoadedDims] = useState<
      { image: string; width: number; height: number } | undefined
    >(undefined);
    const [mask, setMask] = useState<string | undefined>(undefined);
    const [brushSize, setBrushSize] = useState(brushSizeSaved);
    const [eraserMode, setEraserMode] = useState(false);
    const [brushing, setBrushing] = useState(true);
    // Focused 영역 도구(2026-10-04 S2) — 브러시 모드의 하위 도구(지우개처럼). 이동 모드로 바꾸면 쉬고 돌아오면 다시 영역.
    const [focusTool, setFocusTool] = useState(false);
    const [open, setOpen] = useState(false);
    // PC 조합 탭(0=프롬프트 에디터, 1=조합 에디터) — 조합 에디터면 이미지 패널을 숨겨 왼쪽을 넓힌다(모바일 FloatView 무관)
    const [pcComboTab, setPcComboTab] = useState(0);
    const def =workFlowService.getDef(editingScene.workflowType)!;
    const isMirror = editingScene.workflowType === 'SDMirror';
    // 미러 프리셋에는 focus 키가 없다(영역 버튼·오버레이 숨김).
    const supportsFocus = !!def?.hasMask && !isMirror && presetSupportsFocus(editingScene.preset);
    const pointerTarget = inpaintPointerTarget({
      hasMask: !!def?.hasMask,
      brushing,
      focusTool: supportsFocus && focusTool,
    });
    const focusRect = supportsFocus ? presetFocusRect(editingScene.preset) : null;
    const focusEnabled = supportsFocus && editingScene.preset.focusEnabled === true;
    const focusContext = normalizeFocusContext(editingScene.preset.focusContext);
    // 사각형·켜짐 값은 프리셋에 바로 쓴다(다른 프리셋 토글과 같은 경로 — 씬 toJSON reaction → 저장 큐).
    const applyFocusRect = (rect: Parameters<typeof focusRectPresetPatch>[0]) => {
      Object.assign(editingScene.preset, focusRectPresetPatch(rect));
    };
    const commitFocusDrag = (result: FocusDragResult) => {
      if (result.kind === 'set') applyFocusRect(result.rect);
      else if (result.kind === 'clear') applyFocusRect(null);
    };
    const selectFocusTool = () => {
      if (focusTool && brushing) {
        // 켜진 영역 도구를 다시 누르면 Focused 끄기(사각형 값은 보존 — 다시 켜면 복원).
        setFocusTool(false);
        editingScene.preset.focusEnabled = false;
        return;
      }
      setFocusTool(true);
      setBrushing(true);
      editingScene.preset.focusEnabled = true;
    };
    // 조합 에디터 탭(2026-10-04 B4, SPEC §7-4) — 미러('shared') 또는 조합 모드 I2I('shared'·'snapshot').
    // 'shared' 는 상위/하위/전역 네거티브 칸이 현재 사전 세팅에 바로 쓰고(실시간 공유), 'snapshot' 은 씬 프리셋의 고정값.
    const comboMode = variantComboMode(editingScene);
    const isComboI2I = !isMirror && !!comboMode;
    const globalPreset = comboMode === 'shared' && curSession?.selectedWorkflow
      ? curSession.getCommonSetup(curSession.selectedWorkflow)[1]
      : null;
    const showComboTabs = comboMode === 'snapshot' || (comboMode === 'shared' && !!globalPreset);
    // 조합 탭이 사라졌다 다시 생기면 TabComponent 는 0번 탭으로 새로 시작한다 — 상태도 맞춘다
    useEffect(() => {
      if (!showComboTabs) setPcComboTab(0);
    }, [showComboTabs]);
    // PC 조합 에디터 탭: 이미지 패널을 hidden(display:none)으로 숨긴다 — 언마운트하지 않아 마스크 캔버스·붓질 이력·
    // Focused 영역이 그대로 남고, 오버레이 크기는 다시 보일 때 ResizeObserver 가 재측정한다. md 미만(모바일)은 불변.
    const pcComboWide = showComboTabs && pcComboTab === 1;
    // 조합 모드 I2I 는 단일 「프롬프트」 칸이 없는 편집 칸(중간 프롬프트·조합 에디터가 대신한다)
    const presetEditorElement = isComboI2I
      ? SDI2IComboUI
      : workFlowService.getI2IEditor(editingScene.workflowType);
    const getMiddlePrompt = () => {
      if (editingScene.slots.length > 0 && editingScene.slots[0].length > 0) {
        return editingScene.slots[0][0].prompt;
      }
      return editingScene.preset.prompt || '';
    };

    const setMiddlePrompt = (txt: string) => {
      editingScene.preset.prompt = txt;
      if (editingScene.slots.length > 0 && editingScene.slots[0].length > 0) {
        editingScene.slots[0][0].prompt = txt;
      }
    };

    const ensureSlots = () => {
      if (editingScene.slots.length === 0) {
        editingScene.slots = [[
          PromptPiece.fromJSON({
            prompt: editingScene.preset.prompt || '',
            characterPrompts: [],
            enabled: true,
            id: uuidv4(),
          }),
        ]];
      }
    };

    // 「조합 모드 끄기」 — slots 는 남기고 comboMode 만 지운다. 단일 프롬프트 = 첫 조합의 중간 프롬프트.
    const turnOffComboMode = async () => {
      const first = enumerateCombinations(editingScene as unknown as Scene, 1)[0];
      const middle = first ? combinationMiddlePrompt(first) : getMiddlePrompt();
      const ok = await appState.confirmAsync({
        text: COMBO_EDITOR_TEXT.turnOffConfirm(middle),
        confirmText: COMBO_EDITOR_TEXT.turnOff,
      });
      if (!ok) return;
      runInAction(() => {
        editingScene.preset.prompt = middle;
        editingScene.comboMode = undefined;
      });
    };

    // 「프롬프트 에디터」 탭 칸(상위·중간·하위·전역 네거티브) — 모바일 FloatView·PC 오른쪽 패널 공용
    const comboPromptRows: {
      label: string;
      value: string;
      onChange: (v: string) => void;
    }[] =
      comboMode === 'snapshot'
        ? [
            {
              label: COMBO_EDITOR_TEXT.snapshotFront,
              value: editingScene.preset.frontPrompt || '',
              onChange: (v) => { editingScene.preset.frontPrompt = v; },
            },
            { label: COMBO_EDITOR_TEXT.middle, value: getMiddlePrompt(), onChange: setMiddlePrompt },
            {
              label: COMBO_EDITOR_TEXT.snapshotBack,
              value: editingScene.preset.backPrompt || '',
              onChange: (v) => { editingScene.preset.backPrompt = v; },
            },
            {
              label: COMBO_EDITOR_TEXT.snapshotUc,
              value: editingScene.preset.globalUc || '',
              onChange: (v) => { editingScene.preset.globalUc = v; },
            },
          ]
        : globalPreset
          ? [
              {
                label: COMBO_EDITOR_TEXT.sharedFront,
                value: globalPreset.frontPrompt || '',
                onChange: (v) => { globalPreset.frontPrompt = v; },
              },
              { label: COMBO_EDITOR_TEXT.middle, value: getMiddlePrompt(), onChange: setMiddlePrompt },
              {
                label: COMBO_EDITOR_TEXT.sharedBack,
                value: globalPreset.backPrompt || '',
                onChange: (v) => { globalPreset.backPrompt = v; },
              },
              {
                label: COMBO_EDITOR_TEXT.sharedUc,
                value: globalPreset.uc || '',
                onChange: (v) => { globalPreset.uc = v; },
              },
            ]
          : [];

    const comboTabs = (pc: boolean) => [
      {
        label: '프롬프트 에디터',
        emoji: <FaImages />,
        onClick: pc ? () => setPcComboTab(0) : undefined,
        content: (
          <div className={`flex flex-col h-full overflow-auto ${pc ? 'gap-1' : 'p-2 gap-2'}`}>
            {isComboI2I && (
              <div className="flex-none flex flex-wrap items-center gap-2">
                <span className="gray-label text-xs">
                  {comboMode === 'snapshot'
                    ? COMBO_EDITOR_TEXT.modeSnapshot
                    : COMBO_EDITOR_TEXT.modeShared}
                </span>
                <button
                  className="round-button back-gray btn-sm flex-none ml-auto"
                  onClick={turnOffComboMode}
                >
                  {COMBO_EDITOR_TEXT.turnOff}
                </button>
              </div>
            )}
            {comboPromptRows.map((row) => (
              <div key={row.label} className="contents">
                <div className="flex-none font-bold text-sub">{row.label}</div>
                <div className="flex-none h-20">
                  <PromptEditTextArea value={row.value} onChange={row.onChange} />
                </div>
              </div>
            ))}
            {pc ? (
              <div className="flex-1 overflow-hidden min-h-0">
                <InnerPreSetEditor
                  nopad
                  type={editingScene.workflowType}
                  preset={editingScene.preset}
                  shared={undefined}
                  element={presetEditorElement}
                  middlePromptMode={false}
                  onImageUploaded={onImageUploaded}
                />
              </div>
            ) : (
              <InnerPreSetEditor
                type={editingScene.workflowType}
                preset={editingScene.preset}
                shared={undefined}
                element={presetEditorElement}
                middlePromptMode={false}
                onImageUploaded={onImageUploaded}
              />
            )}
          </div>
        ),
      },
      {
        label: '조합 에디터',
        emoji: <FaPuzzlePiece />,
        onClick: pc
          ? () => {
              ensureSlots();
              setPcComboTab(1);
            }
          : ensureSlots,
        content: <SlotEditor scene={editingScene} />,
      },
    ];

    const uploadMirrorImage = async () => {
      // 모드 선택 다이얼로그
      const selectedMode = await appState.pushDialogAsync({
        type: 'select',
        text: '미러 캔버스 모드를 선택해주세요',
        items: [
          { text: '빈 캔버스 (우측 빈 영역에 새로 생성)', value: 'blank' },
          { text: '이미지 복제 (우측에 원본 복제 후 변형)', value: 'duplicate' },
        ],
      });
      if (!selectedMode) return;
      curSession!.mirrorMode = selectedMode as 'blank' | 'duplicate';

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).replace(
            /^data:image\/[^;]+;base64,/,
            '',
          );
          const storedPath = await imageService.storeVibeImage(
            curSession!,
            base64,
          );
          curSession!.mirrorImage = storedPath;
          // 모든 미러 씬의 캔버스/마스크 초기화 (새 이미지로 재생성되도록)
          for (const [, scene] of curSession!.inpaints) {
            if (scene.workflowType === 'SDMirror' && scene !== editingScene) {
              scene.preset.image = '';
              scene.preset.mask = '';
            }
          }
          await refreshMirrorCanvas();
        };
        reader.readAsDataURL(file);
      };
      input.click();
    };

    const refreshMirrorCanvas = async () => {
      if (!curSession?.mirrorImage) return;
      const srcData = await imageService.fetchVibeImage(
        curSession!,
        curSession.mirrorImage,
      );
      if (!srcData) return;
      const srcBase64 = dataUriToBase64(srcData);
      const result = await prepareMirrorCanvas(srcBase64, curSession!.mirrorMode || 'blank');
      if (!editingScene.preset.image) {
        editingScene.preset.image = await imageService.storeVibeImage(
          curSession!,
          result.canvas,
        );
      } else {
        await imageService.writeVibeImage(
          curSession!,
          editingScene.preset.image,
          result.canvas,
        );
      }
      if (!editingScene.preset.mask) {
        editingScene.preset.mask = await imageService.storeVibeImage(
          curSession!,
          result.mask,
        );
      } else {
        await imageService.writeVibeImage(
          curSession!,
          editingScene.preset.mask,
          result.mask,
        );
      }
      editingScene.resolution = 'custom';
      editingScene.resolutionWidth = result.width;
      editingScene.resolutionHeight = result.height;
      editingScene.mirrorCropX = result.cropX;
      setImage(result.canvas);
      setWidth(result.width);
      setHeight(result.height);
    };

    useEffect(() => {
      setFocusTool(false);
      if (isMobile) {
        setBrushing(false);
      }
      if (!editingScene) {
        setImage('');
        setMask(undefined);
        return;
      }
      setImage('');
      setMask(undefined);
      async function loadImage() {
        try {
          const data = await imageService.fetchVibeImage(
            curSession!,
            editingScene.preset.image,
          );
          setImage(dataUriToBase64(data!));
        } catch (e) {
          appState.pushMessage('인페인트 이미지를 불러오는데 실패했습니다.');
        }
      }
      async function loadMask() {
        if (!editingScene.preset.mask) return;
        try {
          const data = await imageService.fetchVibeImage(
            curSession!,
            editingScene.preset.mask,
          );
          if (data) setMask(dataUriToBase64(data));
        } catch (e) {}
      }
      const dispose = reaction(
        () => editingScene.preset.image,
        () => {
          loadImage();
        },
      );
      if (isMirror && !editingScene.preset.image && curSession?.mirrorImage) {
        refreshMirrorCanvas();
      } else {
        loadImage();
      }
      if (def?.hasMask) loadMask();
      else setBrushing(false);
      imageService.addEventListener('image-cache-invalidated', loadImage);
      return () => {
        imageService.removeEventListener('image-cache-invalidated', loadImage);
        dispose();
      };
    }, [editingScene]);
    useEffect(() => {
      // 영역 도구가 포인터를 받는 동안 마스크 캔버스는 칠하지 않는다(오버레이가 위에서 받음 — 이중 차단).
      if (pointerTarget === 'brush') {
        brushTool.current!.startBrushing();
      } else {
        brushTool.current!.stopBrushing();
        if (pointerTarget === 'focus') brushTool.current!.clearPreview();
      }
    }, [pointerTarget]);
    useEffect(() => {
      const scene = editingScene;
      getImageDimensions(image)
        .then(({ width, height }) => {
          setWidth(width);
          setHeight(height);
          if (image) setLoadedDims({ image, width, height });
          // 표시 이미지 크기에 저장된 Focused 사각형을 맞춘다(다른 이미지·작은 이미지 — 무효면 해제).
          // 그사이 다른 씬으로 바뀌었으면 손대지 않는다.
          if (!image || scene !== editingSceneRef.current) return;
          if (!presetSupportsFocus(scene.preset) || scene.workflowType === 'SDMirror') return;
          const r = reconcileFocusRect(presetFocusRect(scene.preset), width, height);
          if (r.kind === 'set') Object.assign(scene.preset, focusRectPresetPatch(r.rect));
          else if (r.kind === 'clear') Object.assign(scene.preset, focusRectPresetPatch(null));
        })
        .catch(() => {});
    }, [image]);

    // 씬 해상도 = 첨부 이미지 크기(R-res, SPEC §7-3) — 업로드·「이미지 크기로 맞추기」 공용.
    const applyResolution = (scene: InpaintScene, r: ImageResolution) => {
      applyImageResolution(scene, r);
      const notice = paidResolutionNotice(r);
      if (notice) appState.pushMessage(notice, 'info');
    };
    // 편집 창 이미지 입력칸에 새 이미지를 올리면(ⓑ) 저장 뒤 씬 해상도를 그 크기로 맞춘다.
    const onImageUploaded = async (field: string, base64: string) => {
      const scene = editingScene;
      if (field !== 'image' || !workflowUsesImageResolution(scene.workflowType)) return;
      const r = await resolutionFromImage(base64);
      if (r) applyResolution(scene, r);
    };
    // 기존 씬 불일치 안내(자동 변경 없음) — 표시 이미지 크기와 요청 해상도(lowerResolution)가 다를 때만.
    const sceneSize =
      editingScene.resolution in resolutionMap
        ? lowerResolution(
            editingScene.resolution as Resolution,
            editingScene.resolutionWidth,
            editingScene.resolutionHeight,
          )
        : { width: undefined, height: undefined };
    const fitTarget =
      image &&
      loadedDims?.image === image &&
      workflowUsesImageResolution(editingScene.workflowType)
        ? imageResolutionMismatch(sceneSize, loadedDims.width, loadedDims.height)
        : undefined;

    const deleteScene = () => {
      appState.pushDialog({
        type: 'confirm',
        ...deleteConfirmText({
          kind: 'inpaintScene',
          name: editingScene.name,
          outcome: { trashDays: SCENE_RETENTION_DAYS },
        }),
        callback: async () => {
          const { trashService } = await import('../models');
          // 휴지통 이동 실패면 씬이 그대로 남는다(2026-10-02 S1) — 알리고 편집 창은 닫지 않는다.
          // 다른 창 잠금으로 조용히 돌아와 씬이 남아 있어도 실패로 센다(SPEC §8, X4).
          const session = curSession!;
          const outcome = await runTrashDelete({
            remove: () => trashService.moveSceneToTrash(session, editingScene!),
            stillExists: () => session.hasScene('inpaint', editingScene.name),
          });
          if (outcome.kind === 'error') {
            appState.pushMessage(outcome.message || '씬을 휴지통으로 옮기지 못했습니다.');
            return;
          }
          if (outcome.kind === 'still-present') {
            appState.pushMessage(DELETE_RESULT_TEXT.sceneStillPresent);
            return;
          }
          // 지운 씬에 닫힐 때 이름 확정이 걸리지 않게 입력값을 원상태로 둔다
          nameDraftRef.current = editingScene.name;
          onConfirm();
          onDelete();
        },
      });
    };

    const brushTool = useRef<BrushToolRef | null>(null);
    // 브러시 스트로크 후 마스크 데이터를 캐싱 (언마운트 시 ref가 null이므로)
    const cachedMaskRef = useRef<string | null>(null);

    const onDrawEnd = () => {
      if (brushTool.current) {
        cachedMaskRef.current = brushTool.current.getMaskBase64();
      }
    };

    const saveMask = async () => {
      if (def?.hasMask && brushTool.current) {
        const mask = brushTool.current.getMaskBase64();
        if (!editingScene.preset.mask) {
          editingScene.preset.mask = await imageService.storeVibeImage(
            curSession!,
            mask,
          );
        } else {
          await imageService.writeVibeImage(
            curSession!,
            editingScene.preset.mask,
            mask,
          );
        }
        cachedMaskRef.current = null; // 이미 저장됨
      }
    };

    // 컴포넌트 언마운트 시 캐싱된 마스크 자동 저장 (ESC로 닫을 때도 마스크 유지)
    useEffect(() => {
      return () => {
        const mask = cachedMaskRef.current;
        const scene = editingScene;
        const session = curSession;
        if (def?.hasMask && session && mask) {
          if (!scene.preset.mask) {
            imageService.storeVibeImage(session, mask).then((path) => {
              scene.preset.mask = path;
            });
          } else {
            imageService.writeVibeImage(session, scene.preset.mask, mask);
          }
        }
      };
    }, [editingScene, def?.hasMask, curSession]);

    // 씬 이름(2026-10-03 X15a): 예전에는 매 키 입력마다 scene.name 만 바꿔 Map 키·inpaints 폴더가
    // 옛 이름에 남았다. 입력은 초안으로만 두고 blur/Enter/닫을 때 확정 — 동명·잘못된 이름 거부,
    // 폴더 이동은 renameInpaintScene(다른 창 잠금·withLock·이동 실패 시 무변경) 관문을 거친다.
    const [nameDraft, setNameDraft] = useState(editingScene.name);
    const nameDraftRef = useRef(editingScene.name);
    const nameCommitRef = useRef<string | null>(null); // 진행 중인 확정 대상(중복 확정 방지)
    const mountedRef = useRef(true);
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);
    useEffect(() => {
      setNameDraft(editingScene.name);
      nameDraftRef.current = editingScene.name;
      nameCommitRef.current = null;
    }, [editingScene]);
    const sceneRef = useRef(editingScene);
    sceneRef.current = editingScene;
    // 확정이 끝났을 때 다른 씬으로 바뀌어 있으면 그 씬의 입력값을 덮지 않는다
    const updateNameDraft = (v: string, forScene = editingScene) => {
      if (sceneRef.current !== forScene) return;
      nameDraftRef.current = v;
      if (mountedRef.current) setNameDraft(v);
    };
    const commitName = async (typed: string) => {
      const session = curSession;
      if (!session) return;
      const scene = editingScene;
      const oldName = scene.name;
      const check = checkInpaintSceneRename(oldName, typed, (n) =>
        session.inpaints.has(n),
      );
      if (check.kind === 'unchanged') return;
      if (check.kind !== 'ok') {
        appState.pushMessage(check.message);
        updateNameDraft(oldName, scene);
        return;
      }
      if (nameCommitRef.current === check.name) return;
      nameCommitRef.current = check.name;
      try {
        if (session.inpaints.get(oldName) === scene) {
          const changed = await renameInpaintScene(session, oldName, check.name);
          if (!changed) {
            updateNameDraft(scene.name, scene);
            return;
          }
        } else {
          // 아직 프로젝트에 등록되지 않은 씬(옮길 폴더 없음) — 이름만 바꾼다
          scene.name = check.name;
        }
        updateNameDraft(scene.name, scene);
      } catch (e: any) {
        appState.pushMessage(e?.message || '씬 이름을 바꾸지 못했습니다.');
        updateNameDraft(scene.name, scene);
      } finally {
        nameCommitRef.current = null;
      }
    };
    // 닫을 때(Esc·저장·바깥) 확정되지 않은 이름이 남아 있으면 확정한다(일반 씬 편집 창과 같음)
    useEffect(() => {
      return () => {
        const draft = nameDraftRef.current;
        if (draft.trimEnd() !== editingScene.name) void commitName(draft);
      };
    }, [editingScene]);

    const confirm = async () => {
      await saveMask();
      onConfirm();
    };
    return (
      <div
        className={`flex flex-col ${pcComboWide ? '' : 'md:flex-row'} py-3 h-full w-full overflow-hidden`}
      >
        <div
          className={`px-3 flex flex-col flex-none ${
            pcComboWide ? 'md:flex-1 md:min-h-0 md:w-full' : 'md:h-auto md:w-1/2 xl:w-1/3'
          } gap-2 overflow-hidden`}
        >
          <div className="flex flex-wrap gap-2">
            <div className="mb-1 flex items-center gap-3 flex-none">
              <label className="gray-label">씬 이름: </label>
              <input
                type="text"
                className="gray-input flex-1"
                value={nameDraft}
                onBlur={(e) => {
                  void commitName(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onChange={(e) => {
                  updateNameDraft(e.target.value);
                }}
              />
              {editingScene && (
                <button
                  className={`round-button back-red`}
                  onClick={deleteScene}
                >
                  삭제
                </button>
              )}
              <button className={`round-button back-sky`} onClick={confirm}>
                저장
              </button>
            </div>
            <div className="flex-none inline-flex md:flex whitespace-nowrap gap-3 items-center">
              {!isMobile && <span className="gray-label">해상도:</span>}
              <div className="w-36">
                <DropdownSelect
                  options={resolutionOptions}
                  menuPlacement="bottom"
                  selectedOption={editingScene.resolution}
                  onSelect={async (opt) => {
                    if (
                      opt.value.startsWith('large') ||
                      opt.value.startsWith('wallpaper')
                    ) {
                      appState.pushDialog({
                        type: 'confirm',
                        text: '해당 해상도는 Anlas를 소모합니다 (유료임) 계속하시겠습니까?',
                        callback: () => {
                          editingScene.resolution = opt.value as Resolution;
                        },
                      });
                    } else if (opt.value === 'custom') {
                      // 숫자 검증·64px 보정은 공용 흐름(빈칸·문자 거부 — 예전에는 0x0 저장, X15c)
                      const size = await promptCustomResolution({
                        width: editingScene.resolutionWidth,
                        height: editingScene.resolutionHeight,
                      });
                      if (!size) return;
                      editingScene.resolution = opt.value as Resolution;
                      editingScene.resolutionWidth = size.width;
                      editingScene.resolutionHeight = size.height;
                    } else {
                      editingScene.resolution = opt.value as Resolution;
                    }
                  }}
                />
              </div>
            </div>
            {fitTarget && loadedDims && (
              <div className="w-full flex flex-wrap items-center gap-2">
                <span className="gray-label text-xs">
                  {IMAGE_RESOLUTION_TEXT.mismatch(loadedDims, sceneSize)}
                </span>
                <button
                  className="round-button back-sky flex-none"
                  onClick={() => applyResolution(editingScene, fitTarget)}
                >
                  {IMAGE_RESOLUTION_TEXT.fitButton}
                </button>
              </div>
            )}
          </div>
          {isMirror && (
            <div className="flex flex-wrap gap-2 mt-1">
              <button
                className="round-button back-sky flex-none"
                onClick={uploadMirrorImage}
              >
                <ActionIcon id="import" className="inline mr-1" />
                미러 이미지 {curSession?.mirrorImage ? '변경' : '업로드'}
              </button>
              {curSession?.mirrorImage && (
                <span className="gray-label text-xs self-center">
                  ✓ {curSession.mirrorMode === 'duplicate' ? '이미지 복제' : '빈 캔버스'} 모드
                </span>
              )}
            </div>
          )}
          {open && (
            <FloatView priority={1} onEscape={() => setOpen(false)}>
              {showComboTabs ? (
                <TabComponent tabs={comboTabs(false)} />
              ) : (
                <InnerPreSetEditor
                  type={editingScene.workflowType}
                  preset={editingScene.preset}
                  shared={undefined}
                  element={workFlowService.getI2IEditor(
                    editingScene.workflowType,
                  )}
                  middlePromptMode={false}
                  onImageUploaded={onImageUploaded}
                />
              )}
            </FloatView>
          )}
          <div className="flex-none md:hidden mb-2">
            <button
              className="round-button back-sky w-full"
              onClick={() => setOpen(true)}
            >
              씬 세팅 열기
            </button>
          </div>
          {showComboTabs ? (
            <div className="flex-1 hidden md:flex flex-col overflow-hidden">
              <TabComponent tabs={comboTabs(true)} />
            </div>
          ) : (
            <div className="flex-1 hidden md:block overflow-hidden">
              <InnerPreSetEditor
                nopad
                type={editingScene.workflowType}
                preset={editingScene.preset}
                shared={undefined}
                element={workFlowService.getI2IEditor(editingScene.workflowType)}
                middlePromptMode={false}
                onImageUploaded={onImageUploaded}
              />
            </div>
          )}
          {def?.hasMask && (
            <div
              className={`flex items-center gap-2 md:gap-4 md:ml-auto pb-2 overflow-hidden w-full ${
                pcComboWide ? 'md:hidden' : ''
              }`}
            >
              {
                <button
                  className={`rounded-full h-8 w-8 back-gray flex-none flex items-center justify-center clickable`}
                  aria-label={brushing ? '이동 모드로 전환' : '브러시 모드로 전환'}
                  onClick={() => {
                    setBrushing(!brushing);
                  }}
                >
                  {brushing ? <FaArrowsAlt /> : <ActionIcon id="brush" />}
                </button>
              }
              <div className="flex-none flex items-center gap-1">
                <button
                  className={`round-button ${eraserMode || focusTool ? 'back-gray' : 'back-sky'}`}
                  onClick={() => {
                    setEraserMode(false);
                    setFocusTool(false);
                    setBrushing(true);
                  }}
                >
                  브러시
                </button>
                <button
                  className={`round-button ${eraserMode && !focusTool ? 'back-red' : 'back-gray'}`}
                  onClick={() => {
                    setEraserMode(true);
                    setFocusTool(false);
                    setBrushing(true);
                  }}
                >
                  지우개
                </button>
                {supportsFocus && (
                  <Tooltip content={FOCUS_EDITOR_TEXT.toolTooltip}>
                    <button
                      className={`round-button icon-only ${focusTool ? 'back-sky' : 'back-gray'}${
                        focusEnabled && !focusTool ? ' ring-2 ring-red-500' : ''
                      }`}
                      aria-label={FOCUS_EDITOR_TEXT.toolLabel}
                      aria-pressed={focusTool}
                      onClick={selectFocusTool}
                    >
                      <ActionIcon id="focus-area" />
                    </button>
                  </Tooltip>
                )}
              </div>
              {isMobile && (
                <Tooltip content="되돌리기">
                <button
                  className={`rounded-full h-8 w-8 back-gray flex-none flex items-center justify-center clickable`}
                  onClick={() => {
                    brushTool.current!.undo();
                  }}
                >
                  <FaUndo />
                </button>
                </Tooltip>
              )}
              {supportsFocus && focusTool ? (
                <>
                  {/* 영역 도구 = 브러시 크기 자리에 「맥락 여백」(공식 Minimum Context Area, 32~96 step 8) */}
                  <Tooltip content={FOCUS_EDITOR_TEXT.contextTooltip}>
                    <label className="flex-none gray-label" htmlFor="focusContext">
                      {isMobile ? '' : FOCUS_EDITOR_TEXT.contextLabel}{' '}
                      <span className="inline-block">{focusContext}px</span>
                    </label>
                  </Tooltip>
                  <input
                    id="focusContext"
                    type="range"
                    min={FOCUS_CONTEXT_MIN}
                    max={FOCUS_CONTEXT_MAX}
                    step={FOCUS_GRID}
                    value={focusContext}
                    className="inline-block flex-1 min-w-[80px] md:min-w-[180px] max-w-[360px]"
                    onChange={(e) => {
                      editingScene.preset.focusContext = normalizeFocusContext(
                        Number(e.target.value),
                      );
                    }}
                  />
                </>
              ) : (
                <>
                  <label className="flex-none gray-label" htmlFor="brushSize">
                    {isMobile
                      ? ''
                      : eraserMode
                        ? '지우개 크기:'
                        : '브러시 크기:'}{' '}
                    <span className="inline-block w-4">{brushSize}</span>
                  </label>
                  <input
                    id="brushSize"
                    type="range"
                    min="1"
                    max="100"
                    value={brushSize}
                    className="inline-block flex-1 min-w-[80px] md:min-w-[180px] max-w-[360px]"
                    onChange={(e: any) => {
                      setBrushSize(e.target.value);
                      brushSizeSaved = e.target.value;
                    }}
                  />
                </>
              )}
              <button
                className={`round-button back-sky flex-none`}
                onClick={() => brushTool.current!.clear()}
              >
                {isMobile ? '' : '마스크'}초기화
              </button>
            </div>
          )}
          {supportsFocus && (focusTool || focusEnabled) && (
            // U4 마스크 규칙 미리보기 — 맥락 띠의 마스크는 요청 때 지워지고, 안쪽이 비면 안쪽 전체를 인페인트.
            <div
              className={`flex-none flex flex-wrap items-center gap-x-2 text-xs text-muted pb-2 ${
                pcComboWide ? 'md:hidden' : ''
              }`}
              data-focus-hint
            >
              <span className="font-bold">
                {!focusEnabled
                  ? 'Focused 꺼짐'
                  : focusRect
                    ? `영역 ${focusRect.w}×${focusRect.h} · ${focusRequestLabel(focusRect, width, height)}`
                    : 'Focused 켜짐'}
              </span>
              <span>{focusRect ? FOCUS_EDITOR_TEXT.maskRule : FOCUS_EDITOR_TEXT.noRect}</span>
              {focusEnabled && (
                <button
                  className="btn-link"
                  onClick={() => {
                    setFocusTool(false);
                    editingScene.preset.focusEnabled = false;
                  }}
                >
                  {FOCUS_EDITOR_TEXT.off}
                </button>
              )}
            </div>
          )}
        </div>
        <div
          className={`flex flex-col flex-1 ${pcComboWide ? 'md:flex-none' : ''} overflow-hidden`}
        >
          {/* PC 조합 에디터 탭: 이미지만 숨기고 아래 생성 바는 남긴다(언마운트 금지 — 마스크·Focused 보존) */}
          <div className={`flex-1 overflow-hidden ${pcComboWide ? 'md:hidden' : ''}`}>
            <TransformWrapper
              disabled={pointerTarget !== 'pan'}
              minScale={0.7}
              initialScale={0.7}
              centerOnInit={true}
            >
              <TransformComponent wrapperClass="wrapper flex-none items-center justify-center">
                <BrushTool
                  brushSize={brushSize}
                  eraserMode={eraserMode}
                  mask={mask ? base64ToDataUri(mask) : undefined}
                  // 씬이 바뀔 때만 캔버스를 mask 로 다시 그린다 — 생성 결과 표시(setImage)로는 붓질 유지
                  resetKey={editingScene}
                  ref={brushTool}
                  image={base64ToDataUri(image)}
                  imageWidth={width}
                  imageHeight={height}
                  onDrawEnd={onDrawEnd}
                  overlay={
                    supportsFocus ? (
                      <FocusAreaOverlay
                        imageWidth={width}
                        imageHeight={height}
                        rect={focusRect}
                        context={focusContext}
                        visible={focusEnabled || focusTool}
                        interactive={pointerTarget === 'focus'}
                        onCommit={commitFocusDrag}
                      />
                    ) : undefined
                  }
                />
              </TransformComponent>
              {!isMobile && def.hasMask && (
                <div className="canvas-tooltip dark:text-white dark:bg-gray-600">
                  ctrl+z 로 실행 취소 가능
                </div>
              )}
            </TransformWrapper>
          </div>
          <div className="flex-none flex ml-auto gap-2 items-center mr-2 mt-2">
            <button
              className={`round-button back-gray h-8 w-16 flex items-center justify-center`}
              aria-label="결과 이미지를 원본으로 적용"
              onClick={async () => {
                if (!image || !editingScene.preset.image) return;
                await imageService.writeVibeImage(
                  curSession!,
                  editingScene.preset.image,
                  image,
                );
              }}
            >
              <FaArrowLeft size={20} />
            </button>
            <TaskProgressBar fast />
            <button
              className={`round-button back-green h-8 w-16 md:w-36 flex items-center justify-center`}
              aria-label="생성"
              onClick={async () => {
                if (isMirror) {
                  if (!curSession?.mirrorImage) {
                    appState.pushMessage('미러 이미지를 먼저 업로드해주세요.');
                    return;
                  }
                  await refreshMirrorCanvas();
                }
                await saveMask();
                const onGenComplete = (path: string) => {
                  (async () => {
                    const data = await imageService.fetchImage(path);
                    setImage(dataUriToBase64(data!));
                  })();
                };
                // 미러·조합 모드 I2I 는 조합 수만큼 예약(활성 조각이 없는 열이 있으면 0 — 생성 경로와 같은 규칙)
                const queued = isMirror
                  ? await queueMirrorWorkflow(
                      curSession!,
                      editingScene.workflowType,
                      editingScene.preset,
                      editingScene,
                      1,
                      onGenComplete,
                    )
                  : await queueI2IWorkflow(
                      curSession!,
                      editingScene.workflowType,
                      editingScene.preset,
                      editingScene,
                      1,
                      onGenComplete,
                    );
                if (queued === 0) {
                  appState.pushMessage(COMBO_EMPTY_TEXT);
                  return;
                }
                taskQueueService.run();
              }}
            >
              <FaPlay size={15} />
            </button>
            {taskQueueService.isRunning() && (
              <Tooltip content="중지">
                <button
                  className={`round-button back-red h-8 w-16 md:w-36 flex items-center justify-center`}
                  onClick={() => {
                    taskQueueService.removeAllTasks();
                    taskQueueService.stop();
                  }}
                >
                  <FaStop size={15} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    );
  },
);

export default InPaintEditor;
