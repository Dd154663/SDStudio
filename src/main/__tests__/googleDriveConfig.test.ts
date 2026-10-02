/**
 * @jest-environment node
 */
// Google 드라이브 연동 — OAuth 클라이언트 빌드 시 주입(2026-10-02).
// .env 파서(주석·따옴표·기존 변수 미덮어쓰기), isGoogleOAuthConfigured, 설정 없는 빌드의
// 상태·연결·해제 동작(인증 파일을 읽지도 지우지도 않음). 값은 모두 가짜이며 실제 Google 호출 없음.
// jest 는 .env 를 읽지 않는다 — 각 테스트가 process.env 를 직접 정한다.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyDotEnv, loadDotEnv, parseDotEnv } from '../../../.erb/configs/loadDotEnv';
import { buildDriveAuthStatus } from '../googleDrive/status';
import { DRIVE_AUTH_ERROR_TEXT } from '../../shared/googleDriveAuth';

const mockLoadAuthRecord = jest.fn(async (_clientId: string) => null);
const mockDeleteAuthFile = jest.fn(async () => {});
const mockSaveAuthRecord = jest.fn(async () => true);
const mockStartLoopback = jest.fn();
const mockPostForm = jest.fn();
const mockHttpRequest = jest.fn();

jest.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: jest.fn() },
  app: { getPath: () => '/tmp', getVersion: () => '5.4.0' },
  net: {},
}));
jest.mock('electron-log', () => ({ info: jest.fn(), warn: jest.fn() }));
jest.mock('../googleDrive/store', () => ({
  loadAuthRecord: (id: string) => mockLoadAuthRecord(id),
  deleteAuthFile: () => mockDeleteAuthFile(),
  saveAuthRecord: () => mockSaveAuthRecord(),
  isPersistentStorageAvailable: () => true,
}));
jest.mock('../googleDrive/auth', () => ({
  startLoopbackAuthorization: (...a: any[]) => mockStartLoopback(...a),
}));
jest.mock('../googleDrive/http', () => ({
  postForm: (...a: any[]) => mockPostForm(...a),
  httpRequest: (...a: any[]) => mockHttpRequest(...a),
}));

const ID_KEY = 'SDSTUDIO_GOOGLE_CLIENT_ID';
const SECRET_KEY = 'SDSTUDIO_GOOGLE_CLIENT_SECRET';
const saved = { id: process.env[ID_KEY], secret: process.env[SECRET_KEY] };

function setClientEnv(id?: string, secret?: string) {
  if (id === undefined) delete process.env[ID_KEY];
  else process.env[ID_KEY] = id;
  if (secret === undefined) delete process.env[SECRET_KEY];
  else process.env[SECRET_KEY] = secret;
}

// client.ts 는 모듈 평가 시점에 process.env 를 읽으므로 매번 새로 불러온다.
function freshModules(): {
  client: typeof import('../googleDrive/client');
  drive: typeof import('../googleDrive/index');
} {
  let out: any;
  jest.isolateModules(() => {
    out = {
      client: require('../googleDrive/client'),
      drive: require('../googleDrive/index'),
    };
  });
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
  setClientEnv(undefined, undefined);
});

afterAll(() => {
  setClientEnv(saved.id, saved.secret);
});

describe('.env 파서', () => {
  test('주석·빈 줄·따옴표·export·인라인 주석·CRLF·BOM', () => {
    const text =
      '﻿# 주석\r\n' +
      '\r\n' +
      'A=1\r\n' +
      '  B = two words  \r\n' +
      'C="quoted # not comment"\r\n' +
      "D='single'\r\n" +
      'export E=exported\r\n' +
      'F=value # trailing comment\r\n' +
      'G=\r\n' +
      'H=a=b=c\r\n';
    expect(parseDotEnv(text)).toEqual({
      A: '1',
      B: 'two words',
      C: 'quoted # not comment',
      D: 'single',
      E: 'exported',
      F: 'value',
      G: '',
      H: 'a=b=c',
    });
  });

  test('잘못된 줄은 건너뛴다', () => {
    expect(parseDotEnv('=nokey\nno equals\n1BAD=x\nbad-key=y\nOK=z')).toEqual({ OK: 'z' });
  });

  test('짝이 안 맞는 따옴표는 벗기지 않는다', () => {
    expect(parseDotEnv('A="open\nB=\'x"')).toEqual({ A: '"open', B: '\'x"' });
  });

  test('이미 설정된 변수(빈 문자열 포함)는 덮어쓰지 않는다', () => {
    const env: NodeJS.ProcessEnv = { KEEP: 'shell', EMPTY: '' };
    const applied = applyDotEnv({ KEEP: 'file', EMPTY: 'file', NEW: 'file' }, env);
    expect(applied).toEqual(['NEW']);
    expect(env).toEqual({ KEEP: 'shell', EMPTY: '', NEW: 'file' });
  });

  test('loadDotEnv: 파일에서 읽어 채우고, 파일이 없으면 아무것도 하지 않는다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sds-dotenv-'));
    try {
      const file = path.join(dir, '.env');
      fs.writeFileSync(file, 'X_ONE=1\nX_TWO="2"\n');
      const env: NodeJS.ProcessEnv = { X_TWO: 'kept' };
      expect(loadDotEnv(file, env)).toEqual(['X_ONE']);
      expect(env).toEqual({ X_ONE: '1', X_TWO: 'kept' });
      const env2: NodeJS.ProcessEnv = {};
      expect(loadDotEnv(path.join(dir, 'missing.env'), env2)).toEqual([]);
      expect(env2).toEqual({});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('isGoogleOAuthConfigured', () => {
  test('둘 다 있어야 true', () => {
    setClientEnv('fake-id', 'fake-secret');
    expect(freshModules().client.isGoogleOAuthConfigured()).toBe(true);
    setClientEnv('fake-id', undefined);
    expect(freshModules().client.isGoogleOAuthConfigured()).toBe(false);
    setClientEnv(undefined, 'fake-secret');
    expect(freshModules().client.isGoogleOAuthConfigured()).toBe(false);
    setClientEnv('  ', 'fake-secret');
    expect(freshModules().client.isGoogleOAuthConfigured()).toBe(false);
    setClientEnv(undefined, undefined);
    const { client } = freshModules();
    expect(client.isGoogleOAuthConfigured()).toBe(false);
    expect(client.GOOGLE_OAUTH_CLIENT_ID).toBe('');
    expect(client.GOOGLE_OAUTH_CLIENT_SECRET).toBe('');
  });
});

describe('buildDriveAuthStatus — 설정 없음', () => {
  test('세션·오류·연결 중이 있어도 notConfigured 하나로 고정', () => {
    expect(
      buildDriveAuthStatus({
        session: { email: 'a@b.c', persistent: true },
        storageAvailable: true,
        error: '다른 오류',
        connecting: true,
        configured: false,
      }),
    ).toEqual({
      connected: false,
      persistent: true,
      notConfigured: true,
      error: DRIVE_AUTH_ERROR_TEXT['not-configured'],
    });
  });

  test('configured 생략은 기존 동작', () => {
    expect(
      buildDriveAuthStatus({ session: null, storageAvailable: true, connecting: false }),
    ).toEqual({ connected: false, persistent: true });
  });
});

describe('설정 없는 빌드의 main 인증 상태', () => {
  test('상태: 인증 파일을 읽지 않고 notConfigured', async () => {
    const { drive } = freshModules();
    const s = await drive.getStatus();
    expect(s.connected).toBe(false);
    expect(s.notConfigured).toBe(true);
    expect(s.error).toBe(DRIVE_AUTH_ERROR_TEXT['not-configured']);
    expect(await drive.isConnected()).toBe(false);
    expect(mockLoadAuthRecord).not.toHaveBeenCalled();
    expect(mockDeleteAuthFile).not.toHaveBeenCalled();
  });

  test('연결: not-configured 로 거부하고 브라우저를 열지 않는다', async () => {
    const { drive } = freshModules();
    await expect(drive.connect()).rejects.toMatchObject({ code: 'not-configured' });
    expect(await drive.connectForIpc()).toEqual({ ok: false, code: 'not-configured' });
    expect(mockStartLoopback).not.toHaveBeenCalled();
    expect(mockPostForm).not.toHaveBeenCalled();
  });

  test('access token: not-configured', async () => {
    const { drive } = freshModules();
    const err = await drive.getAccessToken().catch((e) => e);
    // isolateModules 로 불러온 모듈의 클래스라 instanceof 대신 이름으로 확인한다.
    expect(err.name).toBe('DriveAuthError');
    expect(err.code).toBe('not-configured');
    expect(mockLoadAuthRecord).not.toHaveBeenCalled();
  });

  test('해제: 남아 있는 인증 파일을 지우지 않는다', async () => {
    const { drive } = freshModules();
    await drive.disconnect();
    expect(mockDeleteAuthFile).not.toHaveBeenCalled();
    expect(mockHttpRequest).not.toHaveBeenCalled();
  });

  test('설정된 빌드는 주입된 클라이언트 ID 로 인증 파일을 읽는다', async () => {
    setClientEnv('fake-id', 'fake-secret');
    const { drive } = freshModules();
    const s = await drive.getStatus();
    expect(s.notConfigured).toBeUndefined();
    expect(s.connected).toBe(false);
    expect(mockLoadAuthRecord).toHaveBeenCalledWith('fake-id');
  });
});
