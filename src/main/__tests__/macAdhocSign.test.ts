import fs from 'fs';
import os from 'os';
import path from 'path';

// macOS ad-hoc 재서명 afterPack 훅(2026-10-11) — 인자 조립·건너뜀 판정·실행 순서 회귀 테스트.
// 실제 codesign 은 macOS 에만 있으므로 child_process 를 모킹한다.
jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
  spawnSync: jest.fn(),
}));

// eslint-disable-next-line import/first
import * as childProcess from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hook = require('../../../.erb/scripts/macAdhocSign');

const execFileSync = childProcess.execFileSync as unknown as jest.Mock;
const spawnSync = childProcess.spawnSync as unknown as jest.Mock;

const MACHO_64 = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0, 0, 0x01]);
const FAT = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x02]);
const JAVA_CLASS = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34]);

function makeContext(appOutDir: string, platform = 'darwin') {
  return {
    appOutDir,
    electronPlatformName: platform,
    arch: 1,
    packager: { appInfo: { productFilename: 'SDStudio' } },
  };
}

function setPlatform(value: string) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

describe('인자 조립', () => {
  test('앱 경로는 appOutDir/productFilename.app', () => {
    expect(hook.resolveAppPath(makeContext('/out/mac-arm64'))).toBe(
      path.join('/out/mac-arm64', 'SDStudio.app'),
    );
  });

  test('번들 서명은 --deep 포함, runtime·entitlements 없음', () => {
    const args = hook.buildAdhocSignArgs('/x/SDStudio.app', true);
    expect(args).toEqual([
      '--force',
      '--deep',
      '--sign',
      '-',
      '--timestamp=none',
      '/x/SDStudio.app',
    ]);
    expect(args).not.toContain('--options');
    expect(args).not.toContain('--entitlements');
  });

  test('개별 네이티브 파일 서명은 --deep 없음', () => {
    expect(hook.buildAdhocSignArgs('/x/a.node', false)).toEqual([
      '--force',
      '--sign',
      '-',
      '--timestamp=none',
      '/x/a.node',
    ]);
  });

  test('검증은 --deep --strict', () => {
    expect(hook.buildVerifyArgs('/x/S.app')).toEqual([
      '--verify',
      '--deep',
      '--strict',
      '--verbose=2',
      '/x/S.app',
    ]);
  });
});

describe('서명자 판정', () => {
  const devId = [
    'Executable=/x/SDStudio.app/Contents/MacOS/SDStudio',
    'Identifier=io.sunho.SDStudio',
    'Authority=Developer ID Application: Someone (ABCDE12345)',
    'Authority=Developer ID Certification Authority',
    'Authority=Apple Root CA',
  ].join('\n');

  test('Developer ID 서명 인식', () => {
    expect(hook.parseSigningAuthorities(devId)).toHaveLength(3);
    expect(hook.isDeveloperIdSigned(devId)).toBe(true);
  });

  test('ad-hoc·미서명·기타 인증서는 Developer ID 아님', () => {
    expect(
      hook.isDeveloperIdSigned('Signature=adhoc\nTeamIdentifier=not set'),
    ).toBe(false);
    expect(
      hook.isDeveloperIdSigned('/x: code object is not signed at all'),
    ).toBe(false);
    expect(
      hook.isDeveloperIdSigned('Authority=Apple Development: me (X)'),
    ).toBe(false);
    expect(hook.isDeveloperIdSigned('')).toBe(false);
    expect(hook.isDeveloperIdSigned(undefined)).toBe(false);
  });
});

describe('Mach-O 판정', () => {
  test('단일·universal Mach-O', () => {
    expect(hook.isMachOHeader(Buffer.from(MACHO_64))).toBe(true);
    expect(hook.isMachOHeader(Buffer.from([0xfe, 0xed, 0xfa, 0xce]))).toBe(
      true,
    );
    expect(hook.isMachOHeader(Buffer.from(FAT))).toBe(true);
  });

  test('Java class·텍스트·짧은 파일은 제외', () => {
    expect(hook.isMachOHeader(Buffer.from(JAVA_CLASS))).toBe(false);
    expect(hook.isMachOHeader(Buffer.from('#!/usr/bin/perl'))).toBe(false);
    expect(hook.isMachOHeader(Buffer.from([0xcf, 0xfa]))).toBe(false);
  });
});

describe('afterPack 실행', () => {
  const realPlatform = process.platform;
  let tmp: string;
  let appPath: string;

  beforeEach(() => {
    execFileSync.mockReset();
    spawnSync.mockReset();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-'));
    appPath = path.join(tmp, 'SDStudio.app');
    const unpacked = path.join(
      appPath,
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
    );
    fs.mkdirSync(path.join(unpacked, 'sharp', 'build'), { recursive: true });
    fs.writeFileSync(
      path.join(unpacked, 'sharp', 'build', 'sharp.node'),
      MACHO_64,
    );
    fs.writeFileSync(path.join(unpacked, 'sharp', 'libvips.dylib'), FAT);
    fs.writeFileSync(
      path.join(unpacked, 'sharp', 'index.js'),
      'module.exports = 1;',
    );
    fs.writeFileSync(path.join(unpacked, 'Foo.class'), JAVA_CLASS);
  });

  afterEach(() => {
    setPlatform(realPlatform);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('darwin 이 아닌 플랫폼은 아무것도 하지 않는다', async () => {
    setPlatform('darwin');
    await hook.default(makeContext(tmp, 'win32'));
    await hook.default(makeContext(tmp, 'linux'));
    await hook.default(makeContext(tmp, 'mas'));
    expect(execFileSync).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  test('macOS 가 아닌 호스트에서는 경고만 하고 건너뛴다', async () => {
    setPlatform('win32');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await hook.default(makeContext(tmp));
    expect(warn).toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('미서명 앱: 네이티브 → 번들 → 검증 순서로 서명', async () => {
    setPlatform('darwin');
    spawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'code object is not signed at all',
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await hook.default(makeContext(tmp));
    log.mockRestore();

    const calls = execFileSync.mock.calls.map((c) => c[1] as string[]);
    expect(
      execFileSync.mock.calls.every((c) => c[0] === '/usr/bin/codesign'),
    ).toBe(true);
    const unpacked = path.join(
      appPath,
      'Contents',
      'Resources',
      'app.asar.unpacked',
      'node_modules',
    );
    expect(calls).toEqual([
      hook.buildAdhocSignArgs(
        path.join(unpacked, 'sharp', 'build', 'sharp.node'),
        false,
      ),
      hook.buildAdhocSignArgs(
        path.join(unpacked, 'sharp', 'libvips.dylib'),
        false,
      ),
      hook.buildAdhocSignArgs(appPath, true),
      hook.buildVerifyArgs(appPath),
    ]);
  });

  test('검증 실패는 빌드를 실패시킨다', async () => {
    setPlatform('darwin');
    spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '' });
    execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === '--verify')
        throw new Error('a sealed resource is missing or invalid');
    });
    await expect(hook.default(makeContext(tmp))).rejects.toThrow(/검증 실패/);
  });

  test('유효한 Developer ID 서명이면 덮어쓰지 않는다', async () => {
    setPlatform('darwin');
    spawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: 'Authority=Developer ID Application: Someone (ABCDE12345)\n',
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await hook.default(makeContext(tmp));
    log.mockRestore();
    // 검증 1회만 실행되고 서명 명령은 없다.
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync.mock.calls[0][1]).toEqual(
      hook.buildVerifyArgs(appPath),
    );
  });

  test('Developer ID 표시는 있지만 검증 실패(패키징으로 깨짐)면 ad-hoc 재서명', async () => {
    setPlatform('darwin');
    spawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: 'Authority=Developer ID Application: Someone (ABCDE12345)\n',
    });
    let verifyCount = 0;
    execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] !== '--verify') return;
      verifyCount += 1;
      // 첫 검증(기존 서명 확인)만 실패, ad-hoc 재서명 뒤 검증은 통과.
      if (verifyCount === 1) throw new Error('invalid');
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await hook.default(makeContext(tmp));
    log.mockRestore();
    const calls = execFileSync.mock.calls.map((c) => c[1] as string[]);
    expect(calls).toContainEqual(hook.buildAdhocSignArgs(appPath, true));
  });

  test('앱 번들이 없으면 실패', async () => {
    setPlatform('darwin');
    await expect(
      hook.default(makeContext(path.join(tmp, 'missing'))),
    ).rejects.toThrow(/찾지 못했습니다/);
  });
});
