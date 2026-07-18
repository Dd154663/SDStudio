// portable 툴바 버튼 공유 JSX — 크로스 영역 렌더용.
// 여기 추가하려면 버튼이 appState/전역 서비스만 의존해야 하며
// uiLayout.ts 레지스트리의 portable: true와 짝을 이뤄야 한다.
//
// 스타일 적응(2026-07-06 피드백): 씬 툴바는 round-button(배경형), 프로젝트 바는
// icon-button(무배경형)으로 버튼 언어가 달라, 크로스 배치 시 배경·크기가 어긋난다.
// 그래서 각 버튼은 "홈 영역에서는 원본 모습 그대로", 타 영역에서는 그 영역의
// 표준 스타일로 렌더한다(variant = 표시 영역).
import { ReactNode, Fragment } from 'react';
import {
  FaBroom,
  FaExchangeAlt,
  FaFolderMinus,
  FaPaintBrush,
  FaShare,
  FaPuzzlePiece,
  FaThLarge,
  FaTrash,
  FaUsers,
  FaPlus,
  FaTrashRestore,
  FaWindowRestore,
} from 'react-icons/fa';
import Tooltip from './Tooltip';
import { appState } from '../models/AppService';
import { CompanionButtonSlot } from './CompanionDnd';

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
}

// 아이콘 단추 공통 — 표시 영역의 표준 클래스로 감싼다.
// 씬: round-button back-gray(배경형, 씬 아이콘 버튼 표준) / 프로젝트: icon-button mx-1(무배경형)
// 동반: round-button back-gray h-8(호스트 행 높이 정렬, 아이콘+툴팁).
const iconButton = (
  variant: 'scene' | 'project' | 'companion',
  tooltip: string,
  icon: ReactNode,
  onClick: () => void,
): ReactNode => (
  <Tooltip content={tooltip}>
    <button
      className={
        variant === 'project'
          ? 'icon-button mx-1'
          : variant === 'companion'
            ? 'round-button back-gray h-8'
            : 'round-button back-gray'
      }
      onClick={onClick}
    >
      {icon}
    </button>
  </Tooltip>
);

export function portableToolbarButtons(
  ctx: PortableButtonsContext,
): Record<string, ReactNode> {
  const { variant } = ctx;
  return {
    // SessionSelect 로컬 맵에서 이관 — 홈(project)은 원본대로 Tooltip 없는
    // icon-button(FaPlus 18), 씬으로 오면 씬 표준(배경형 18px+툴팁)으로 적응.
    'add-session':
      variant === 'project' ? (
        <button
          className={`icon-button mx-1`}
          onClick={() => appState.addSession()}
        >
          <FaPlus size={18} />
        </button>
      ) : (
        iconButton(
          variant,
          '신규 프로젝트',
          <FaPlus size={18} />,
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
            className={`icon-button mx-1`}
            onClick={() => appState.deleteSession()}
          >
            <FaFolderMinus size={18} />{' '}
          </button>
        </Tooltip>
      ) : (
        iconButton(
          variant,
          '프로젝트 삭제',
          <FaFolderMinus size={18} />,
          () => appState.deleteSession(),
        )
      ),
    // SessionSelect 로컬 맵에서 이관 — 원본이 이미 Tooltip 래핑이라 양쪽 다
    // iconButton(툴팁 유지) 사용: 홈(project)=icon-button, 씬=round-button 적응.
    'project-trash': iconButton(
      variant,
      '프로젝트 휴지통',
      <FaTrashRestore size={18} />,
      () => appState.openProjectTrash(),
    ),
    // SceneQueueControl 로컬 맵에서 이관 — 홈(scene)에서는 원본과 동일 렌더
    'empty-image-trash': iconButton(
      variant,
      '모든 씬 내 삭제한 이미지 일괄 비우기',
      <FaBroom size={18} />,
      () => appState.emptyProjectImageTrashWithConfirm(),
    ),
    'find-replace': iconButton(
      variant,
      '찾기 및 변환 (Ctrl+H)',
      <FaExchangeAlt size={18} />,
      () => appState.openFindReplace(),
    ),
    // SceneQueueControl 로컬 맵에서 이관(B군 승격, 퀵 메뉴 P2) — 홈(scene)에서는
    // 원본과 동일 렌더(배경형 아이콘+툴팁), 모달은 App.tsx 전역 오버레이가 호스트.
    'artist-tag': iconButton(
      variant,
      '아티스트 태깅 (그림체 분석)',
      <FaPaintBrush size={18} />,
      () => appState.openArtistTag(),
    ),
    'scene-trash': iconButton(
      variant,
      '씬 휴지통',
      <FaTrash size={18} />,
      () => appState.openSceneTrash(),
    ),
    // SessionSelect 고정 버튼에서 레지스트리 편입(④ 자유 위치) — 홈(project)은
    // 원본대로 16px, 타 영역은 각 영역 표준 18px 로 적응.
    'project-browser': iconButton(
      variant,
      '프로젝트 탐색',
      <FaThLarge size={variant === 'project' ? 16 : 18} />,
      () => {
        appState.projectBrowserOpen = true;
      },
    ),
    // 새 창(멀티 윈도우 W6) — 데스크톱 전용(레지스트리 pcOnly 로 모바일 미노출).
    // 각 영역 표준 스타일로 적응(iconButton).
    'new-window': iconButton(
      variant,
      '새 창',
      <FaWindowRestore size={18} />,
      () => appState.openNewWindow(),
    ),
    // SessionSelect 로컬 맵에서 이관 — 홈(project)은 원본대로 Tooltip 없는
    // icon-button(FaShare 기본 크기), 씬으로 오면 씬 표준(배경형 18px+툴팁)으로 적응
    'backup-export':
      variant === 'project' ? (
        <button
          className={`icon-button mx-1`}
          onClick={() => {
            appState.projectBackupMenu();
          }}
        >
          <FaShare />
        </button>
      ) : (
        iconButton(
          variant,
          '프로젝트 백업/내보내기',
          <FaShare size={18} />,
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
              ? `round-button ${appState.appliedCharacterPresetNames.length > 0 ? 'back-green' : 'back-gray'}`
              : variant === 'companion'
                ? `round-button h-8 ${appState.appliedCharacterPresetNames.length > 0 ? 'back-green' : 'back-gray'}`
                : `icon-button mx-1 ${appState.appliedCharacterPresetNames.length > 0 ? 'back-green' : ''}`
          }
          onClick={() => appState.openCharacterPresets()}
        >
          {/* FaUserAlt→FaUsers(② A 실기 피드백 2): 하단 아이콘 행에서 캐릭터 프롬프트
              (FaUserAlt)와 동일 아이콘이 한 행에 겹쳐 혼동 — 프리셋 "관리(여럿)" 의미의
              아이콘으로 전역 교체(퀵 메뉴 맵도 동일). */}
          <FaUsers size={18} />
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
              ? 'icon-button back-green mx-1'
              : 'round-button back-green' +
                (variant === 'companion' ? ' h-8' : '')
          }
          onClick={() => appState.openPieceEditor()}
        >
          <FaPuzzlePiece size={18} />
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
        <FaPuzzlePiece size={18} />
        <span className="hidden md:inline">프롬프트조각</span>
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
