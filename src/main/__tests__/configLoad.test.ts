import { backupFailedConfig, loadJsonConfig } from '../configLoad';

describe('loadJsonConfig', () => {
  test('정상 설정 객체를 불러온다', async () => {
    const result = await loadJsonConfig('config.json', async () =>
      JSON.stringify({ saveLocation: 'D:/SDStudio' }),
    );

    expect(result).toEqual({
      kind: 'loaded',
      value: { saveLocation: 'D:/SDStudio' },
    });
  });

  test('파일 부재만 최초 실행으로 취급한다', async () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const result = await loadJsonConfig('config.json', async () => {
      throw error;
    });

    expect(result).toEqual({ kind: 'missing' });
  });

  test('읽기 오류는 부팅 실패 경고로 전달한다', async () => {
    const error = Object.assign(new Error('denied'), { code: 'EACCES' });
    const result = await loadJsonConfig('config.json', async () => {
      throw error;
    });

    expect(result).toEqual({ kind: 'failed', code: 'EACCES' });
  });

  test.each(['{broken', '[]', 'null'])(
    '잘못된 설정 내용 %s 을 실패로 판정한다',
    async (raw) => {
      const result = await loadJsonConfig('config.json', async () => raw);
      expect(result.kind).toBe('failed');
    },
  );
});

describe('backupFailedConfig', () => {
  test('손상된 설정을 같은 폴더의 고유 백업명으로 이동한다', async () => {
    const rename = jest.fn(async () => undefined);
    const backupPath = await backupFailedConfig(
      'C:/data/config.json',
      rename,
      () => 1234567890,
      () => 'fixed-id',
    );

    expect(backupPath).toBe(
      'C:\\data\\config.failed-1234567890-fixed-id.bak',
    );
    expect(rename).toHaveBeenCalledWith(
      'C:/data/config.json',
      'C:\\data\\config.failed-1234567890-fixed-id.bak',
    );
  });
});
