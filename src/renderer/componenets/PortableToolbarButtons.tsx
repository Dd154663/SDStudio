// portable 툴바 버튼 공유 JSX — 크로스 영역 렌더용.
// 여기 추가하려면 버튼이 appState/전역 서비스만 의존해야 하며
// uiLayout.ts 레지스트리의 portable: true와 짝을 이뤄야 한다.
//
// 스타일 적응(2026-07-06 피드백): 씬 툴바는 round-button(배경형), 프로젝트 바는
// icon-button(무배경형)으로 버튼 언어가 달라, 크로스 배치 시 배경·크기가 어긋난다.
// 그래서 각 버튼은 "홈 영역에서는 원본 모습 그대로", 타 영역에서는 그 영역의
// 표준 스타일로 렌더한다(variant = 표시 영역).
import { ReactNode } from 'react';
import {
  FaBroom,
  FaExchangeAlt,
  FaShare,
  FaPuzzlePiece,
  FaUserAlt,
} from 'react-icons/fa';
import Tooltip from './Tooltip';
import { appState } from '../models/AppService';

// 렌더 컨텍스트: variant = 이 버튼이 실제로 표시되는 영역(스타일 적응 기준).
// mobileIcon = 씬 툴바의 모바일 아이콘 축약 여부(현재 이관 버튼은 미사용이나 계약 유지).
// observer 컴포넌트의 렌더 중에 호출되는 일반 함수 — appState observable 접근이
// 호출한 observer에 추적된다.
export interface PortableButtonsContext {
  mobileIcon: boolean;
  variant: 'scene' | 'project';
  // 아이콘 축약 강제 — 프로젝트 사이드 바(w-12 세로 스택)처럼 텍스트 버튼이
  // 물리적으로 안 들어가는 표시 영역용. 텍스트 포함 버튼(piece-editor)만 영향.
  iconOnly?: boolean;
}

// 아이콘 단추 공통 — 표시 영역의 표준 클래스로 감싼다.
// 씬: round-button back-gray(배경형, 씬 아이콘 버튼 표준) / 프로젝트: icon-button mx-1(무배경형)
const iconButton = (
  variant: 'scene' | 'project',
  tooltip: string,
  icon: ReactNode,
  onClick: () => void,
): ReactNode => (
  <Tooltip content={tooltip}>
    <button
      className={variant === 'scene' ? 'round-button back-gray' : 'icon-button mx-1'}
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
          appState.appliedCharacterPreset
            ? `프리셋: ${appState.appliedCharacterPreset}`
            : '캐릭터 프리셋 관리'
        }
      >
        <button
          className={
            variant === 'scene'
              ? `round-button ${appState.appliedCharacterPreset ? 'back-green' : 'back-gray'}`
              : `icon-button mx-1 ${appState.appliedCharacterPreset ? 'back-green' : ''}`
          }
          onClick={() => appState.openCharacterPresets()}
        >
          <FaUserAlt size={18} />
        </button>
      </Tooltip>
    ),
    // 텍스트 포함 버튼 — round-button 은 씬 툴바에도 있는 표준이라 양쪽 그대로,
    // 여백만 적응(프로젝트 바는 ml-1 하드마진, 씬 툴바 행은 gap-1 이라 불필요).
    // iconOnly(사이드 바)는 텍스트를 빼고 툴팁으로 대체(색·아이콘은 원본 유지).
    'piece-editor': ctx.iconOnly ? (
      <Tooltip content="프롬프트조각">
        <button
          className="round-button back-green"
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
