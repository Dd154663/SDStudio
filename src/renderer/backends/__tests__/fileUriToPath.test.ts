import * as fs from 'fs';
import * as path from 'path';
import { fileUriToPath } from '../fileUriToPath';

describe('file:// URI → 실제 경로', () => {
  test('한글·공백·괄호의 퍼센트 인코딩을 푼다', () => {
    const name = '와샌즈 (2)_캡처_20261125_223300.png';
    const uri = 'file:///storage/emulated/0/Download/' + encodeURIComponent(name);
    expect(uri).toContain('%');
    expect(fileUriToPath(uri)).toBe('/storage/emulated/0/Download/' + name);
  });

  test('영문 이름은 그대로, % 글자 자체(%25)도 되돌린다', () => {
    expect(fileUriToPath('file:///storage/emulated/0/Download/default_1.png')).toBe(
      '/storage/emulated/0/Download/default_1.png',
    );
    expect(fileUriToPath('file:///storage/emulated/0/Download/100%25.png')).toBe(
      '/storage/emulated/0/Download/100%.png',
    );
  });

  test('깨진 인코딩이면 접두만 뗀 값을 돌려준다(던지지 않음)', () => {
    expect(fileUriToPath('file:///storage/emulated/0/Download/bad%E0%A4%A.png')).toBe(
      '/storage/emulated/0/Download/bad%E0%A4%A.png',
    );
  });
});

describe('Android 백엔드 소스 계약', () => {
  const src = fs
    .readFileSync(path.join(__dirname, '..', 'androidBackend.ts'), 'utf8')
    .replace(/\r\n/g, '\n');

  test('미디어 스캔에 넘기는 경로는 fileUriToPath 를 거친다(접두만 떼는 코드가 남아 있지 않음)', () => {
    expect(src.match(/fileUriToPath\(uriRes\.uri\)/g)).toHaveLength(2);
    expect(src).not.toMatch(/uriRes\.uri\.replace\(/);
  });

  test('썸네일 인코딩에 toBlob 을 쓰지 않는다(화면이 멈춰 있으면 밀리는 작업)', () => {
    const body = src.slice(src.indexOf('async resizeImage('), src.indexOf('async openImageEditor('));
    expect(body).not.toMatch(/toBlob\(/);
    expect(body).toMatch(/outputCanvas\.toDataURL\('image\/png'/);
  });
});
