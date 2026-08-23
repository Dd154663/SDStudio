import * as fs from 'fs';
import * as path from 'path';

describe('씬 키보드 포커스 표시 회귀 방지', () => {
  test('선택 모드와 무관하게 포커스된 씬의 외곽선을 표시한다', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../componenets/SceneQueueControl.tsx'),
      'utf8',
    );

    expect(source).toMatch(/const focusRing = isFocused\s*\?/);
    expect(source).not.toMatch(
      /const focusRing = isFocused && appState\.sceneSelectionMode/,
    );
  });
});
