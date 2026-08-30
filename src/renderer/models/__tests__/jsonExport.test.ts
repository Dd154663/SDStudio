import { stringifyExportJson } from '../jsonExport';

describe('읽기 쉬운 JSON 내보내기', () => {
  const data = {
    version: 1,
    name: '테스트 프로젝트',
    presets: [{ prompt: 'artist:aaa, 1girl\n배경', seed: 4294967295 }],
    scenes: { default: { enabled: true, seed: null } },
    imageData: 'data:image/png;base64,AAABBB/CCC==',
    escaped: '"따옴표" \\ 경로\t탭',
    omitted: undefined,
  };

  it('객체와 배열을 줄바꿈 및 2칸 들여쓰기로 출력한다', () => {
    const text = stringifyExportJson(data);
    expect(text).toContain('\n  "version": 1,');
    expect(text).toContain('\n  "presets": [\n    {');
  });

  it.each(['compact', 'LF', 'CRLF'])(
    '%s 파일은 기존 JSON.parse만으로 동일한 데이터를 복원한다',
    (format) => {
      const pretty = stringifyExportJson(data);
      const text = format === 'compact'
        ? JSON.stringify(data)
        : format === 'CRLF' ? pretty.replace(/\n/g, '\r\n') : pretty;
      expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(data)));
    },
  );

  it('프롬프트 내부 개행·이스케이프·이미지 문자열과 버전을 보존한다', () => {
    const text = stringifyExportJson(data);
    const restored = JSON.parse(text);
    expect(restored.presets[0].prompt).toBe(data.presets[0].prompt);
    expect(restored.escaped).toBe(data.escaped);
    expect(restored.imageData).toBe(data.imageData);
    expect(restored.version).toBe(data.version);
    expect(text).toContain('artist:aaa, 1girl\\n배경');
    expect(text).toContain(data.imageData);
  });
});
