// UI 전역 window 이벤트 이름 — import 순환을 피하려고 의존성 없는 모듈에 둔다.

/** 모바일 V2 하단 시트를 접어 달라(탭 전환 전 등). 보냄=AppService.openArtistInLibrary, 받음=MobilePromptSheet. */
export const V2_SHEET_CLOSE_EVENT = 'sdstudio-v2-sheet-close';
