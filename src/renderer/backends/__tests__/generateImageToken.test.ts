/**
 * 부스트 모드 B0(2026-10-29) — PC backend.generateImage 요청별 토큰 옵션.
 * 옵션이 없으면 TOKEN.txt(read-global-file)를 읽고, 옵션 토큰이 있으면 그 토큰으로 벤더를 부르며
 * 토큰은 ImageGenInput(arg)에 실리지 않는다.
 */
const invoke = jest.fn(async (channel: string, ...args: any[]) => {
  if (channel === 'read-global-file' && args[0] === 'TOKEN.txt') return 'stored-token';
  return undefined;
});
(window as any).electron = { ipcRenderer: { invoke, on: jest.fn(), removeListener: jest.fn() } };

const vendorGenerate = jest.fn(async (_token: string, _arg: any) => 'BASE64');
jest.mock('../genVendors/nai', () => ({
  NovelAiImageGenService: jest.fn().mockImplementation(() => ({
    generateImage: vendorGenerate,
  })),
}));

import { ElectornBackend } from '../electronBackend';

beforeEach(() => jest.clearAllMocks());

function arg() {
  return { outputFilePath: 'outs/p/s/1.png', prompt: 'girl' } as any;
}

test('옵션 없음 = 저장된 TOKEN.txt 로 요청(종전)', async () => {
  const be = new ElectornBackend();
  await be.generateImage(arg());
  expect(invoke).toHaveBeenCalledWith('read-global-file', 'TOKEN.txt');
  expect(vendorGenerate.mock.calls[0][0]).toBe('stored-token');
});

test('옵션 토큰 = 그 토큰으로 요청, TOKEN.txt 를 읽지 않고 arg 에 토큰을 싣지 않는다', async () => {
  const be = new ElectornBackend();
  const a = arg();
  await be.generateImage(a, { token: 'account-b' });
  expect(invoke).not.toHaveBeenCalledWith('read-global-file', 'TOKEN.txt');
  expect(vendorGenerate.mock.calls[0][0]).toBe('account-b');
  expect(JSON.stringify(vendorGenerate.mock.calls[0][1])).not.toContain('account-b');
  expect(JSON.stringify(a)).not.toContain('account-b');
});
