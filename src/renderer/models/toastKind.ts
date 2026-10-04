// 토스트 종류 추론 — 순수 함수(2026-10-03 U1·X7, jest toastKind.test.ts).
//
// 예전 토스트는 항상 빨강이라 성공 알림도 오류처럼 보였다. pushMessage(msg, kind?) 의 kind 를 생략하면
// 문구로 종류를 고른다(호출부 500여 곳을 모두 고치지 않기 위함). **오류 판정이 먼저**다 — 「내보내기는
// 완료됐지만 …하지 못했습니다」 같은 문구는 오류로 본다. 판정이 애매하면 info(중립색)로 둔다(빨강으로
// 겁주지 않되 성공처럼 보이지도 않게). 오류인데 문구로 알 수 없는 호출부(예: 예외 메시지만 그대로 띄움)는
// 호출부에서 kind 를 'error' 로 명시한다.

export type ToastKind = 'info' | 'success' | 'error';

// 오류·거부·전제 조건 미충족(「먼저 …해주세요」, 「…이 없습니다」 포함 — 요청한 동작이 일어나지 않았음)
const ERROR_PATTERNS: RegExp[] = [
  /실패/,
  /오류/,
  /에러/,
  /없습니다|없어요|없음(?![가-힣])/,
  /수 없|수없/,
  /못\s?했|못\s?하|못 \S+습니다|지 못/,
  /불가/,
  /잘못/,
  /거부/,
  /차단/,
  /중단|중지/,
  /않았|않습니다|않음/,
  /올바르지|올바른 .*아닙니다|아닙니다/,
  /이미 .*(존재|있|진행|열려|사용 중)/,
  /존재합니다/,
  /비어\s?있습니다/,
  /되었거나|했거나/,
  /만 지원|에서만 .*수 있|최대 .*까지/,
  /진행\s?중입니다/,
  /주세요|먼저 /,
  /야 합니다|여야|이어야/,
  /필요합니다/,
  /미지원|지원하지/,
  /초과|부족/,
  /\b(error|errors|failed|failure|fail|denied|invalid|cannot|can't|unable|refused|timeout|timed out|not found|no such|forbidden|unauthorized)\b/i,
  /\b(ENOENT|EACCES|EPERM|EBUSY|EEXIST|ENOTDIR|EISDIR|ENOSPC)\b/,
  /\b[45]\d\d\b.*(error|status)|status\s*[45]\d\d/i,
];

// 취소는 실패도 성공도 아닌 중립 안내. 예약 제거(2026-10-04 E3 — 예전 「예약 취소」 문구를 「예약 제거」로
// 통일)도 예전처럼 중립으로 둔다.
const INFO_OVERRIDE_PATTERNS: RegExp[] = [/취소/, /예약[이을]?\s?(일괄\s?)?제거/];

const SUCCESS_PATTERNS: RegExp[] = [
  /완료/,
  /성공/,
  /했습니다|했어요/,
  /되었습니다|됐습니다|었습니다|았습니다|였습니다/,
  /복사됨|저장됨|예약됨|추가됨|삭제됨|적용됨|완료됨|\S+됨$/,
  /복사|저장|추가:/,
  /불러왔|내보냈|가져왔/,
];

// 「…ㅆ습니다」(했·었·았·웠·썼·냈·졌 등 받침 ㅆ 과거형) — 완료된 동작의 알림
function hasPastTenseEnding(text: string): boolean {
  let i = text.indexOf('습니다');
  while (i > 0) {
    const code = text.charCodeAt(i - 1) - 0xac00;
    if (code >= 0 && code < 11172 && code % 28 === 20) return true;
    i = text.indexOf('습니다', i + 1);
  }
  return false;
}

export function inferToastKind(message: string): ToastKind {
  const text = (message ?? '').trim();
  if (!text) return 'info';
  if (ERROR_PATTERNS.some((re) => re.test(text))) return 'error';
  if (INFO_OVERRIDE_PATTERNS.some((re) => re.test(text))) return 'info';
  if (SUCCESS_PATTERNS.some((re) => re.test(text)) || hasPastTenseEnding(text)) {
    return 'success';
  }
  return 'info';
}

/** 명시한 kind 가 있으면 그것, 없으면 문구로 추론. */
export function resolveToastKind(message: string, kind?: ToastKind): ToastKind {
  return kind ?? inferToastKind(message);
}
