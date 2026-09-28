// Google 드라이브 연동 — refresh token 보관 (드라이브 API ①, 2026-09-28)
//
// 위치: app.getPath('userData')/google-drive-auth.json — SDStudio 데이터 루트(userData/SDStudio
// 또는 사용자 지정 저장 경로) 밖이라 백업·동기화·내보내기 대상이 아니다. 1회성 유일 경로라
// PersistenceService 를 거치지 않고 main 에서 직접 쓴다(tmp → rename 원자 쓰기).
//
// 암호화: electron safeStorage(Windows DPAPI 등). isEncryptionAvailable() 이 false 면
// 디스크에 쓰지 않는다(호출부가 메모리만 유지하고 상태에 persistent:false 표시).
// 파일 내용·토큰 값은 로그에 남기지 않는다.

import path from 'path';
import { promises as fs } from 'fs';
import { app, safeStorage } from 'electron';
import log from 'electron-log';
import { decodeAuthFile, DriveAuthRecord, encodeAuthFile } from './authFile';

const AUTH_FILE_NAME = 'google-drive-auth.json';

function authFilePath(): string {
  return path.join(app.getPath('userData'), AUTH_FILE_NAME);
}

export function isPersistentStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export async function deleteAuthFile(): Promise<void> {
  try {
    await fs.rm(authFilePath(), { force: true });
  } catch (e: any) {
    log.warn('[googleDrive] 인증 파일 삭제 실패', e?.code || 'unknown');
  }
}

// 저장된 인증 정보를 읽는다. 없음·암호화 불가 = null.
// 해석·복호화 실패·클라이언트 불일치 = 파일을 삭제하고 null(「연결 안 됨」).
export async function loadAuthRecord(expectedClientId: string): Promise<DriveAuthRecord | null> {
  let text: string;
  try {
    text = await fs.readFile(authFilePath(), 'utf-8');
  } catch (e: any) {
    if (e?.code !== 'ENOENT') log.warn('[googleDrive] 인증 파일 읽기 실패', e?.code || 'unknown');
    return null;
  }
  // 이번 실행에서 복호화할 수 없는 환경(키링 없음 등)이면 읽지 않고 연결 안 됨으로 둔다.
  // 파일은 복호화 가능 여부를 판정할 수 없으므로 지우지 않는다(다음 연결 시 덮어씀·해제 시 삭제).
  if (!isPersistentStorageAvailable()) {
    log.warn('[googleDrive] 암호화 저장소를 사용할 수 없어 저장된 인증 정보를 읽지 않습니다');
    return null;
  }
  const res = decodeAuthFile(
    text,
    (cipher) => safeStorage.decryptString(cipher),
    expectedClientId,
  );
  if (!res.ok) {
    log.warn('[googleDrive] 저장된 인증 정보를 사용할 수 없어 삭제합니다', res.reason);
    await deleteAuthFile();
    return null;
  }
  return res.record;
}

// 저장 성공 = true. 암호화 불가·쓰기 실패 = false(호출부는 메모리만 유지).
export async function saveAuthRecord(record: DriveAuthRecord): Promise<boolean> {
  if (!isPersistentStorageAvailable()) return false;
  const target = authFilePath();
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    const text = encodeAuthFile(record, (plain) => safeStorage.encryptString(plain));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, text, 'utf-8');
    await fs.rename(tmp, target);
    return true;
  } catch (e: any) {
    log.warn('[googleDrive] 인증 파일 저장 실패', e?.code || 'unknown');
    await fs.rm(tmp, { force: true }).catch(() => {});
    return false;
  }
}
