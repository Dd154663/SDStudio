// 아이콘 의미 사전 — 동작 id → 아이콘 단일 출처(SPEC_GUIDE §6 「아이콘 의미 사전」, 2026-10-04 I1).
//
// · 툴바 버튼 id(uiLayout.ts 레지스트리)와 그 밖 공용 동작 키를 같은 표에 둔다. 씬 툴바·프로젝트 바
//   공유 JSX(PortableToolbarButtons)·퀵 메뉴·모바일 V2 칸이 모두 여기서 아이콘을 가져오므로
//   같은 id 는 어느 자리에서든 같은 아이콘이다. 컴포넌트에서 툴바 id 의 아이콘을 다시 정하지 않는다.
// · 각 줄의 주석이 「뜻」이다. 새 동작을 넣을 때는 뜻이 같은 기존 키를 먼저 찾아 재사용한다.
// · 전용 아이콘(다른 뜻에 쓰지 않는다): FaStar=즐겨찾기 · FaPaintBrush=인페인트 · FaCog=환경설정 ·
//   구름(FaCloud*)=드라이브 · FaHeart=작가 즐겨찾기. 같은 툴바 안에서 두 버튼이 같은 아이콘을 쓰지 않는다.
// · 크기·색은 사용처가 정한다(이 모듈은 모양만). react-icons·react 외 의존 금지(서비스·컴포넌트 import 없음).
import { createElement } from 'react';
import type { IconBaseProps, IconType } from 'react-icons';
import {
  FaArrowCircleDown,
  FaArrowCircleUp,
  FaAt,
  FaBolt,
  FaBookmark,
  FaBroom,
  FaBrush,
  FaCheckSquare,
  FaClipboardCheck,
  FaClone,
  FaCog,
  FaCopy,
  FaCrosshairs,
  FaEdit,
  FaEllipsisH,
  FaExchangeAlt,
  FaEyeDropper,
  FaFileArchive,
  FaFileExport,
  FaFileImage,
  FaFileImport,
  FaFilm,
  FaFilter,
  FaFolderMinus,
  FaGoogleDrive,
  FaHeart,
  FaMicrochip,
  FaPaintBrush,
  FaPen,
  FaPlus,
  FaPuzzlePiece,
  FaQuestion,
  FaRegCalendarPlus,
  FaRegCalendarTimes,
  FaRulerCombined,
  FaShare,
  FaSitemap,
  FaSlidersH,
  FaStar,
  FaSwatchbook,
  FaTags,
  FaTasks,
  FaThLarge,
  FaThumbtack,
  FaTrash,
  FaTrashRestore,
  FaTrashRestoreAlt,
  FaDownload,
  FaUserEdit,
  FaUsers,
  FaVectorSquare,
  FaWindowRestore,
} from 'react-icons/fa';

// 합성 아이콘 — 본체 FaFileArchive(백업) 우하단에 본체의 55% 크기 FaShare(내보내기 화살표)를 겹친다.
// 씬 툴바 작가 접두 전환 아이콘과 같은 방식(relative inline-flex + absolute 우하단). 배경 원은 두지 않는다:
// 이 키는 무배경 icon-button·back-gray·btn-ghost·강조(활성 탭) 칩 등 배경이 서로 다른 자리에서 쓰여
// 한 토큰으로 가리면 어딘가에서 얼룩처럼 보인다. 색은 currentColor 를 그대로 따른다.
// size(숫자)에 비례해 작은 화살표 크기·위치를 정하고, 문자열·미지정이면 em 기준(기본 1em)으로 맞춘다.
// className·style 은 감싸는 span(여백·색 클래스가 합성 전체에 적용), 나머지 속성은 본체 아이콘에.
const BACKUP_EXPORT_BADGE_RATIO = 0.55;
export function BackupExportIcon({
  size,
  className,
  style,
  ...rest
}: IconBaseProps) {
  const numeric = typeof size === 'number';
  const badge = numeric
    ? Math.max(6, Math.round(size * BACKUP_EXPORT_BADGE_RATIO))
    : `${BACKUP_EXPORT_BADGE_RATIO}em`;
  const offset = (k: number) =>
    numeric ? -Math.round(size * k) : `-${k}em`;
  return createElement(
    'span',
    {
      className: `relative inline-flex flex-none${className ? ` ${className}` : ''}`,
      style,
    },
    createElement(FaFileArchive, { ...rest, size: size ?? '1em' }),
    createElement(FaShare, {
      size: badge,
      color: rest.color,
      'aria-hidden': true,
      className: 'absolute',
      style: { right: offset(0.3), bottom: offset(0.15) },
    }),
  );
}

export const ICON_DICTIONARY = {
  // ── 씬 툴바(sceneToolbarRegistry) ──
  'add-scene': FaPlus, // 씬 새로 만들기
  'queue-add': FaRegCalendarPlus, // 예약 추가(씬 카드·하단 바·이미지 상세 공통)
  'export-images': FaFileExport, // 이미지 내보내기(앱→파일)
  'quick-export': FaBolt, // 기본 프리셋으로 한 번에 내보내기(번개 = 「빠른」)
  'batch-process': FaTasks, // 대량 작업 메뉴
  'multi-select': FaCheckSquare, // 선택 모드(켜짐=강조 배경, 같은 아이콘)
  'change-resolution': FaRulerCombined, // 해상도 변경(PC 그룹 툴바는 아이콘, 모바일 클래식 툴바는 글자)
  'webp-convert': FaFileImage, // WebP 변환(툴바는 글자 버튼 — 사전 항목만)
  'import-image': FaEyeDropper, // 이미지에서 프롬프트 추출(메타→설정)
  'artist-tag': FaTags, // 아티스트 태깅(그림체 분석)
  'scene-search': FaFilter, // 씬 검색(목록을 거른다)
  'scene-find': FaCrosshairs, // 씬 찾기(거르지 않고 위치로 이동)
  'image-review': FaClipboardCheck, // 이미지 검수
  'artist-breakdown': FaSitemap, // 작가 분해(태그를 하나씩 나눠 예약)
  'artist-prefix-toggle': FaAt, // 작가 태그 artist: 접두 전환
  'bookmark-jump': FaBookmark, // 북마크된 씬으로 이동(bookmark 와 같은 모양)
  'scene-trash': FaTrashRestore, // 씬 휴지통 열기
  'empty-image-trash': FaBroom, // 삭제 이미지 일괄 비우기
  'find-replace': FaExchangeAlt, // 찾기 및 변환
  'shortcut-help': FaQuestion, // 단축키 도움말
  // ── 프로젝트 바(projectToolbarRegistry) ──
  'project-browser': FaThLarge, // 프로젝트 탐색
  'add-session': FaPlus, // 신규 프로젝트
  'character-presets': FaUsers, // 캐릭터 프리셋 관리(여럿)
  'scene-template': FaFilm, // 씬 템플릿
  'backup-export': BackupExportIcon, // 백업(압축)+내보내기 화살표 합성 — 프로젝트 바 통합 버튼
  'delete-session': FaFolderMinus, // 프로젝트(폴더) 삭제 — 일괄 삭제(FaTrash)와 한 행 혼동 방지로 구분
  'project-trash': FaTrashRestore, // 프로젝트 휴지통 열기
  'piece-editor': FaPuzzlePiece, // 프롬프트조각(자동완성의 조각 표시 포함)
  'new-window': FaWindowRestore, // 새 창(PC)
  // ── 공용 동작 ──
  export: FaFileExport, // 내보내기(앱→파일)
  import: FaFileImport, // 불러오기(파일→앱)
  download: FaDownload, // 다운로드(기기 저장)
  share: FaShare, // 공유(모바일 공유 창에만)
  backup: FaFileArchive, // 백업 파일 만들기(전체·라이브러리·템플릿)
  rename: FaPen, // 이름 변경
  edit: FaEdit, // 편집(내용 수정 창 열기)
  duplicate: FaClone, // 복제(같은 목록에 사본 추가)
  copy: FaCopy, // 복사(클립보드)
  delete: FaTrash, // 삭제
  'trash-open': FaTrashRestore, // 휴지통 열기·삭제한 항목 보기
  restore: FaTrashRestoreAlt, // 휴지통에서 복원
  'queue-remove': FaRegCalendarTimes, // 예약 제거(queue-add 와 짝)
  'select-all': FaCheckSquare, // 선택 모드의 전체 선택(선택 모드와 같은 계열)
  bookmark: FaBookmark, // 북마크 지정·표시(씬·이미지)
  'quick-menu': FaBolt, // 퀵 메뉴(우하단 플로팅 버튼) — quick-export 와 같은 번개(「빠른」)
  more: FaEllipsisH, // 더보기
  favorite: FaStar, // 즐겨찾기 — FaStar 전용
  'artist-favorite': FaHeart, // 작가 즐겨찾기 — FaHeart 전용
  'pin-default': FaThumbtack, // 기본 지정·대표 지정(⭐ 아님)
  'global-presets': FaSwatchbook, // 글로벌 프리셋(탭)
  'copy-to-project': FaArrowCircleDown, // 글로벌·템플릿 → 프로젝트 복사(편집 중인 곳으로 「복사해 오기」 포함)
  'copy-to-global': FaArrowCircleUp, // 프로젝트 → 글로벌·템플릿 복사(현재 씬으로 템플릿 만들기 포함)
  inpaint: FaPaintBrush, // 인페인트 — FaPaintBrush 전용
  brush: FaBrush, // 마스크 브러시 도구
  'focus-area': FaVectorSquare, // 인페인트 Focused 영역 도구(사각형 선택 — 그 안만 확대해 다시 그림)
  artist: FaUserEdit, // 작가(자동완성 작가 태그·작가 라이브러리 칩)
  preferences: FaCog, // 환경설정 — FaCog 전용
  'gen-settings': FaSlidersH, // 생성 설정 적용·고급 설정
  'system-settings': FaMicrochip, // 환경설정 「시스템」 탭(요청 지연·쓰기 보호 등)
  drive: FaGoogleDrive, // Google 드라이브 — 구름 계열도 드라이브 전용
} satisfies Record<string, IconType>;

export type IconId = keyof typeof ICON_DICTIONARY;

// 문자열 id(퀵 메뉴 항목 등 런타임 값)로 아이콘을 찾는다. 사전에 없으면 undefined.
export function iconOf(id: string): IconType | undefined {
  return Object.prototype.hasOwnProperty.call(ICON_DICTIONARY, id)
    ? ICON_DICTIONARY[id as IconId]
    : undefined;
}

// 전용 아이콘 규칙(테스트·문서가 참조) — 이 아이콘들은 표의 지정 키에서만 쓴다.
export const EXCLUSIVE_ICONS: {
  icon: IconType;
  keys: IconId[];
  meaning: string;
}[] = [
  { icon: FaStar, keys: ['favorite'], meaning: '즐겨찾기' },
  { icon: FaPaintBrush, keys: ['inpaint'], meaning: '인페인트' },
  { icon: FaCog, keys: ['preferences'], meaning: '환경설정' },
  { icon: FaHeart, keys: ['artist-favorite'], meaning: '작가 즐겨찾기' },
  // 단독 FaShare 는 share 전용 — backup-export 합성 아이콘(BackupExportIcon) 안의 작은 화살표만 예외.
  { icon: FaShare, keys: ['share'], meaning: '모바일 공유' },
];
