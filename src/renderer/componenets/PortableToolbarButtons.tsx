// portable 툴바 버튼 공유 JSX — 크로스 영역 렌더용.
// 여기 추가하려면 버튼이 appState/전역 서비스만 의존해야 하며
// uiLayout.ts 레지스트리의 portable: true와 짝을 이뤄야 한다.
//
// 스타일 적응(2026-07-06 피드백): 씬 툴바는 round-button(배경형), 프로젝트 바는
// icon-button(무배경형)으로 버튼 언어가 달라, 크로스 배치 시 배경·크기가 어긋난다.
// 그래서 각 버튼은 "홈 영역에서는 원본 모습 그대로", 타 영역에서는 그 영역의
// 표준 스타일로 렌더한다(variant = 표시 영역).
import { ReactNode, Fragment } from 'react';
// 아이콘은 아이콘 의미 사전(models/iconDictionary.ts) 단일 출처 — 같은 id 는 씬 툴바·퀵 메뉴·V2 칸과 같은 아이콘.
import Tooltip from './Tooltip';
import { ActionIcon } from './ActionIcon';
import { appState } from '../models/AppService';
import { CompanionButtonSlot } from './CompanionDnd';
import { toolbarLabelOf } from '../models/uiLayout';

// 렌더 컨텍스트: variant = 이 버튼이 실제로 표시되는 영역(스타일 적응 기준).
// mobileIcon = 씬 툴바의 모바일 아이콘 축약 여부(현재 이관 버튼은 미사용이나 계약 유지).
// observer 컴포넌트의 렌더 중에 호출되는 일반 함수 — appState observable 접근이
// 호출한 observer에 추적된다.
export interface PortableButtonsContext {
  mobileIcon: boolean;
  // 표시 영역(스타일 적응 기준). companion = 프리셋 에디터 호스트 행 옆 동반 슬롯
  // (round-button h-8 로 호스트 버튼 높이에 정렬되는 아이콘 버튼+툴팁).
  variant: 'scene' | 'project' | 'companion';
  // 아이콘 축약 강제 — 프로젝트 사이드 바(w-12 세로 스택)나 동반 슬롯처럼 텍스트 버튼이
  // 물리적으로 안 들어가는 표시 영역용. 텍스트 포함 버튼(piece-editor)만 영향.
  iconOnly?: boolean;
  // PC 프로젝트 바 라벨 병행(2026-11-10 묶음 1, SPEC_GUIDE §6 「프로젝트 바 라벨 병행」) — variant 'project' 이고
  // iconOnly 가 아닐 때만 뜻이 있다. 'show' = 아이콘 옆에 짧은 글자(uiLayout label)를 보인다(① 단계),
  // 'measure' = 모습은 아이콘만(②·③ 단계)이고 폭 측정용 보이지 않는 글자만 둔다. 없으면 종전 렌더 그대로
  // (⋯ 메뉴 행·모바일·사이드 바·동반 슬롯).
  labels?: 'show' | 'measure';
}

// 프로젝트 바 글자 단계의 버튼 클래스 덧붙임 — 높이는 그대로(아이콘 18px + p-1), 오른쪽만 pr-2 로 숨통.
// 글자 왼쪽 ml-1.5 와 함께 models/projectBarStage.ts PROJECT_BAR_LABEL_SPACING_PX(10px)와 짝.
const LABELED_BUTTON_CLASS = ' inline-flex items-center pr-2';

// 아이콘 단추 공통 — 표시 영역의 표준 클래스로 감싼다.
// 씬: round-button back-gray(배경형, 씬 아이콘 버튼 표준) / 프로젝트: icon-button mx-1(무배경형)
// 동반: round-button back-gray h-8(호스트 행 높이 정렬, 아이콘+툴팁).
// label: 프로젝트 바 라벨(projectLabel 결과 — ctx.labels 가 있고 variant 'project' 일 때만 값이 있다).
const iconButton = (
  variant: 'scene' | 'project' | 'companion',
  tooltip: string,
  icon: ReactNode,
  onClick: () => void,
  label?: ProjectLabel,
): ReactNode => (
  <Tooltip content={tooltip}>
    <button
      className={
        variant === 'project'
          ? 'icon-button touch-hit relative mx-1' + (label?.shown ? LABELED_BUTTON_CLASS : '')
          : variant === 'companion'
            ? 'round-button icon-only back-gray h-8'
            : 'round-button icon-only back-gray'
      }
      onClick={onClick}
    >
      {icon}
      {label?.node}
    </button>
  </Tooltip>
);

// 프로젝트 바 버튼 하나의 라벨 상태 — shown=글자 단계(버튼 클래스에 LABELED_BUTTON_CLASS), node=글자 노드.
interface ProjectLabel {
  shown: boolean;
  node: ReactNode;
}

// 라벨 노드: 'show' = 보이는 글자, 'measure' = 버튼 안 오른쪽 끝에 겹친 보이지 않는 글자(absolute 라 버튼 폭·줄 배치
// 불변, invisible 이라 클릭·낭독 대상 아님 — 이름은 Tooltip 이 붙이는 aria-label 그대로). 둘 다 [data-pb-label] 로
// 같은 글꼴의 폭을 잰다(useProjectBarStage). right-0 = 바 오른쪽 끝 버튼에서도 화면 밖으로 넘치지 않게 왼쪽으로 편다.
export function projectLabel(
  ctx: PortableButtonsContext,
  id: string,
): ProjectLabel | undefined {
  if (ctx.variant !== 'project' || ctx.iconOnly || !ctx.labels) return undefined;
  const text = toolbarLabelOf(id);
  if (!text) return undefined;
  if (ctx.labels === 'show') {
    return {
      shown: true,
      node: (
        <span data-pb-label="" className="ml-1.5 text-sm leading-none">
          {text}
        </span>
      ),
    };
  }
  return {
    shown: false,
    node: (
      <span
        data-pb-label=""
        aria-hidden="true"
        className="absolute right-0 top-0 invisible pointer-events-none whitespace-nowrap text-sm leading-none"
      >
        {text}
      </span>
    ),
  };
}

// 되돌리기/다시 실행 버튼(2026-11-01 U1 의 undoRedoButton)은 2026-11-03 U6(D19)에서 툴바 레지스트리와 함께 제거 —
// 하단 막대 위 상시 버튼 바 UndoRedoBar.tsx 가 맡는다.

export function portableToolbarButtons(
  ctx: PortableButtonsContext,
): Record<string, ReactNode> {
  const { variant } = ctx;
  const lab = (id: string) => projectLabel(ctx, id);
  return {
    // SessionSelect 로컬 맵에서 이관 — 홈(project)은 원본대로 Tooltip 없는
    // icon-button(FaPlus 18), 씬으로 오면 씬 표준(배경형 18px+툴팁)으로 적응.
    'add-session':
      variant === 'project' ? (
        <Tooltip content="신규 프로젝트">
          <button
            className={`icon-button touch-hit relative mx-1${lab('add-session')?.shown ? LABELED_BUTTON_CLASS : ''}`}
            aria-label="신규 프로젝트"
            onClick={() => appState.addSession()}
          >
            <ActionIcon id="add-session" size={18} />
            {lab('add-session')?.node}
          </button>
        </Tooltip>
      ) : (
        iconButton(
          variant,
          '신규 프로젝트',
          <ActionIcon id="add-session" size={18} />,
          () => appState.addSession(),
        )
      ),
    // SessionSelect 로컬 맵에서 이관 — 홈(project)은 원본대로 icon-button 무배경.
    // 아이콘 FaTrashAlt→FaFolderMinus(② A 실기 피드백 1): 사전세팅선택 행에 동반 배정
    // 시 일괄삭제(FaTrashAlt)와 동일 아이콘이 한 행에 겹쳐 혼동 — "프로젝트(폴더) 삭제"
    // 의미가 드러나는 아이콘으로 전역 교체(퀵 메뉴 맵도 동일).
    'delete-session':
      variant === 'project' ? (
        <Tooltip content="프로젝트 삭제">
          <button
            className={`icon-button touch-hit relative mx-1${lab('delete-session')?.shown ? LABELED_BUTTON_CLASS : ''}`}
            onClick={() => appState.deleteSession()}
          >
            {/* 뒤 공백은 종전 렌더 그대로(아이콘 단계 폭 불변 — 글자 단계 inline-flex 에서는 무시된다) */}
            <ActionIcon id="delete-session" size={18} />{' '}
            {lab('delete-session')?.node}
          </button>
        </Tooltip>
      ) : (
        iconButton(
          variant,
          '프로젝트 삭제',
          <ActionIcon id="delete-session" size={18} />,
          () => appState.deleteSession(),
        )
      ),
    // SessionSelect 로컬 맵에서 이관 — 원본이 이미 Tooltip 래핑이라 양쪽 다
    // iconButton(툴팁 유지) 사용: 홈(project)=icon-button, 씬=round-button 적응.
    'project-trash': iconButton(
      variant,
      '프로젝트 휴지통',
      <ActionIcon id="project-trash" size={18} />,
      () => appState.openProjectTrash(),
      lab('project-trash'),
    ),
    // SceneQueueControl 로컬 맵에서 이관 — 홈(scene)에서는 원본과 동일 렌더
    'empty-image-trash': iconButton(
      variant,
      '모든 씬 내 삭제한 이미지 일괄 비우기',
      <ActionIcon id="empty-image-trash" size={18} />,
      () => appState.emptyProjectImageTrashWithConfirm(),
      lab('empty-image-trash'),
    ),
    'find-replace': iconButton(
      variant,
      '찾기 및 변환 (Ctrl+H)',
      <ActionIcon id="find-replace" size={18} />,
      () => appState.openFindReplace(),
      lab('find-replace'),
    ),
    // SceneQueueControl 로컬 맵에서 이관(B군 승격, 퀵 메뉴 P2) — 홈(scene)에서는
    // 원본과 동일 렌더(배경형 아이콘+툴팁), 모달은 App.tsx 전역 오버레이가 호스트.
    'artist-tag': iconButton(
      variant,
      '아티스트 태깅 (그림체 분석)',
      <ActionIcon id="artist-tag" size={18} />,
      () => appState.openArtistTag(),
      lab('artist-tag'),
    ),
    'scene-trash': iconButton(
      variant,
      '씬 휴지통',
      <ActionIcon id="scene-trash" size={18} />,
      () => appState.openSceneTrash(),
      lab('scene-trash'),
    ),
    // SessionSelect 고정 버튼에서 레지스트리 편입(④ 자유 위치) — 홈(project)은
    // 원본대로 16px, 타 영역은 각 영역 표준 18px 로 적응.
    'project-browser': iconButton(
      variant,
      '프로젝트 탐색',
      <ActionIcon id="project-browser" size={variant === 'project' ? 16 : 18} />,
      () => {
        appState.projectBrowserOpen = true;
      },
      lab('project-browser'),
    ),
    // 씬 툴바에서 프로젝트 바로 이동(씬 템플릿 개편 2026-07-18 — 매크로 기능 승격).
    // 관리 모달(SceneTemplateManager)을 연다. 아이콘 = FaFilm(씬 프레임): 같은 행의
    // project-browser 가 FaThLarge(그리드)라 기존 아이콘 유지 시 동일 아이콘 혼동
    // (② A 피드백 1·2와 같은 유형) — 정체성 아이콘을 분리(퀵 메뉴 맵도 동일).
    'scene-template': iconButton(
      variant,
      '씬 템플릿',
      <ActionIcon id="scene-template" size={18} />,
      () => {
        appState.sceneTemplateManagerOpen = true;
      },
      lab('scene-template'),
    ),
    // 새 창(멀티 윈도우 W6) — 데스크톱 전용(레지스트리 pcOnly 로 모바일 미노출).
    // 각 영역 표준 스타일로 적응(iconButton).
    'new-window': iconButton(
      variant,
      '새 창',
      <ActionIcon id="new-window" size={18} />,
      () => appState.openNewWindow(),
      lab('new-window'),
    ),
    // SessionSelect 로컬 맵에서 이관 — 홈(project)은 원본대로 icon-button(기본 크기),
    // 씬으로 오면 씬 표준(배경형 18px+툴팁)으로 적응. 아이콘은 사전의 합성 아이콘(백업 본체+작은
    // 내보내기 화살표, 2026-10-04) — 같은 메뉴를 여는 프로젝트 서랍·탐색 버튼과 같은 아이콘.
    'backup-export':
      variant === 'project' ? (
        <Tooltip content="프로젝트 백업/내보내기">
          <button
            className={`icon-button touch-hit relative mx-1${lab('backup-export')?.shown ? LABELED_BUTTON_CLASS : ''}`}
            aria-label="프로젝트 백업/내보내기"
            onClick={() => {
              appState.projectBackupMenu();
            }}
          >
            <ActionIcon id="backup-export" />
            {lab('backup-export')?.node}
          </button>
        </Tooltip>
      ) : (
        iconButton(
          variant,
          '프로젝트 백업/내보내기',
          <ActionIcon id="backup-export" size={18} />,
          () => appState.projectBackupMenu(),
        )
      ),
    // SessionSelect 로컬 맵에서 이관 — 홈(project)은 원본대로 icon-button(무배경,
    // 적용 중이면 back-green)+툴팁, 씬으로 오면 씬 표준(배경형 round-button)으로 적응.
    // 적용 중이면 양쪽 다 back-green 강조. 클릭은 전역 openCharacterPresets()(세션 가드·
    // 모바일 해제 다이얼로그 포함). PC 해제는 프로젝트 바의 적용 칩(FaTimes)이 담당 —
    // 버튼 자체에 long-press 핸들러는 없다("길게 눌러 해제" 잔존 문구는 제거, 2026-07-12).
    'character-presets': (
      <Tooltip
        content={
          appState.appliedCharacterPresetNames.length > 0
            ? `프리셋: ${appState.appliedCharacterPresetNames.join(', ')}`
            : '캐릭터 프리셋 관리'
        }
      >
        <button
          className={
            variant === 'scene'
              ? `round-button icon-only ${appState.appliedCharacterPresetNames.length > 0 ? 'back-green' : 'back-gray'}`
              : variant === 'companion'
                ? `round-button icon-only h-8 ${appState.appliedCharacterPresetNames.length > 0 ? 'back-green' : 'back-gray'}`
                : `icon-button touch-hit relative mx-1 ${appState.appliedCharacterPresetNames.length > 0 ? 'back-green' : ''}${lab('character-presets')?.shown ? LABELED_BUTTON_CLASS : ''}`
          }
          onClick={() => appState.openCharacterPresets()}
        >
          {/* FaUserAlt→FaUsers(② A 실기 피드백 2): 하단 아이콘 행에서 캐릭터 프롬프트
              (FaUserAlt)와 동일 아이콘이 한 행에 겹쳐 혼동 — 프리셋 "관리(여럿)" 의미의
              아이콘으로 전역 교체(퀵 메뉴 맵도 동일). */}
          <ActionIcon id="character-presets" size={18} />
          {lab('character-presets')?.node}
        </button>
      </Tooltip>
    ),
    // 텍스트 포함 버튼 — round-button 은 씬 툴바에도 있는 표준이라 양쪽 그대로,
    // 여백만 적응(프로젝트 바는 ml-1 하드마진, 씬 툴바 행은 gap-1 이라 불필요).
    // iconOnly(사이드 바)는 텍스트를 빼고 툴팁으로 대체(색·아이콘은 원본 유지).
    'piece-editor': ctx.iconOnly ? (
      <Tooltip content="프롬프트조각">
        <button
          className={
            // project(무배경 행 — 사전세팅선택·사전세팅 위·사이드바) 적응: 배경형 녹색
            // 원이 무배경 이웃과 어긋나던 것을 무배경+녹색 전경으로 통일(② A 피드백 3).
            variant === 'project'
              ? 'icon-button touch-hit relative back-green mx-1'
              : 'round-button icon-only back-green' +
                (variant === 'companion' ? ' h-8' : '')
          }
          onClick={() => appState.openPieceEditor()}
        >
          <ActionIcon id="piece-editor" size={18} />
        </button>
      </Tooltip>
    ) : (
      <button
        className={
          'round-button back-green flex items-center gap-1' +
          (variant === 'project' ? ' ml-1' : '')
        }
        onClick={() => appState.openPieceEditor()}
      >
        <ActionIcon id="piece-editor" size={18} />
        {/* 라벨 도입 전부터 글자 버튼 — 단계와 무관하게 같은 모습(글자 = 레지스트리 label 단일 출처) */}
        <span className="hidden md:inline">{toolbarLabelOf('piece-editor') ?? '프롬프트조각'}</span>
      </button>
    ),
  };
}

// 동반 슬롯(프리셋 에디터 호스트 행 옆) 렌더 — portable 공유 JSX(variant 'companion')를
// id 순서대로 ReactNode 배열로 낸다. 미등록 id 는 조용히 건너뛴다(레지스트리와 렌더러가
// 어긋나도 안전). CharacterButton·VibeButton·CharacterReferenceButton·WFRGroup 호스트가
// 공용으로 쓴다 — 하드코딩 맵을 두지 않아 새 portable 추가 시 즉시 슬롯 렌더 가능.
// observer 렌더 중 호출되는 일반 함수 — 내부 appState 접근이 호출한 observer 에 추적된다.
//
// hostKey 를 넘기면(E4) 각 버튼을 CompanionButtonSlot 으로 감싼다 — 편집모드(PC)에서만
// 드래그(재배치·순서 조정·툴바 복귀)가 붙고, 그 외에서는 원본 그대로(fragment). hostKey
// 미지정 호출은 기존과 동일(감싸지 않음) — 시그니처 확장은 옵셔널이라 하위 호환.
// variant(옵셔널, 기본 'companion'): 호스트 행의 이웃 버튼 스타일에 적응 — 사전세팅선택
// 행처럼 무배경 icon-button 이 표준인 행은 'project' 로 무배경 적응(④ 실기 보정).
export function renderCompanionButtons(
  ids: string[],
  hostKey?: string,
  variant: 'companion' | 'project' = 'companion',
): ReactNode[] {
  if (ids.length === 0) return [];
  const nodes = portableToolbarButtons({
    mobileIcon: false,
    variant,
    iconOnly: true, // piece-editor 텍스트 축약(툴팁 대체)
  });
  return ids
    .map((id) => {
      const node = nodes[id];
      if (!node) return null;
      return hostKey ? (
        <CompanionButtonSlot key={id} hostKey={hostKey} id={id}>
          {node}
        </CompanionButtonSlot>
      ) : (
        <Fragment key={id}>{node}</Fragment>
      );
    })
    .filter((n): n is JSX.Element => n !== null);
}
