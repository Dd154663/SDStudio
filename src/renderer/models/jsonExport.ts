/** 사람이 읽는 JSON 내보내기 전용. 스키마와 문자열 내용은 바꾸지 않는다. */
export function stringifyExportJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
