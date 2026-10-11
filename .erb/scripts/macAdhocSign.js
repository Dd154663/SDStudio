/*
 * electron-builder afterPack 훅 — macOS 앱 ad-hoc 재서명.
 *
 * 배경: 공개 CI 는 Apple Developer ID 인증서 없이 mac 패키징을 한다
 * (`CSC_IDENTITY_AUTO_DISCOVERY=false` → 서명 단계가 서명 주체를 찾지 못해 건너뜀).
 * electron-builder 24.x 는 이때 ad-hoc 서명도 하지 않아, 패키징 과정(실행 파일 이름 변경·
 * Info.plist 수정·리소스 추가)으로 Electron 원본의 서명이 깨진 앱이 배포된다. 다운로드로
 * 격리 속성이 붙은 이 앱을 Gatekeeper 가 「손상되었기 때문에 열 수 없습니다」로 막고,
 * Apple Silicon 은 서명 없는 코드를 아예 실행하지 않는다.
 *
 * 이 훅은 패키징 직후(DMG·zip 을 만들기 전) 앱 번들을 ad-hoc(`--sign -`) 으로 다시 서명해
 * 서명 구조를 온전하게 만든다. 공증이 없으므로 처음 실행할 때 「확인되지 않은 개발자」 경고는
 * 남지만, 우클릭 → 열기(또는 시스템 설정의 「그래도 열기」)로 실행할 수 있다.
 *
 * 설계 결정:
 * - hardened runtime(`--options runtime`)·entitlements 는 적용하지 않는다. hardened runtime 은
 *   라이브러리 검증을 켜서 「Apple 서명이거나 같은 Team ID 로 서명된 코드」만 불러오게 하는데,
 *   ad-hoc 서명에는 Team ID 가 없어 Electron Framework·네이티브 모듈(.node/.dylib) 로드가
 *   막힐 수 있다. hardened runtime 은 공증에만 필요하므로 공증하지 않는 이 경로에서는 끈다.
 * - `--timestamp=none`: ad-hoc 서명에는 보안 타임스탬프를 받을 수 없다.
 * - `--deep` 은 Contents/Frameworks 등 표준 위치의 중첩 코드만 서명한다. Resources 아래
 *   app.asar.unpacked 의 네이티브 모듈(Mach-O)은 표준 위치가 아니므로 먼저 하나씩 서명한 뒤
 *   번들 전체를 서명한다(안쪽 → 바깥 순서).
 * - 이미 유효한 Developer ID 서명이 있으면 덮어쓰지 않고 건너뛴다(향후 인증서 등록 대비).
 *   인증서를 등록하면 electron-builder 의 정식 서명 단계가 이 훅 **뒤에** `--force` 로 다시
 *   서명하므로, 이 훅의 ad-hoc 서명은 그대로 대체된다.
 * - 서명·검증 실패는 빌드를 실패시킨다(깨진 앱이 조용히 배포되지 않게).
 * - mac 이 아닌 플랫폼(Windows·Linux 패키징)에서는 아무것도 하지 않는다.
 *
 * 외부 의존성 없이 Node 내장 모듈만 쓴다. 명령은 쉘을 거치지 않고 인자 배열로 실행한다.
 */
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const CODESIGN = '/usr/bin/codesign';

/** 패키징된 .app 번들 경로. */
function resolveAppPath(context) {
  const { productFilename } = context.packager.appInfo;
  return path.join(context.appOutDir, `${productFilename}.app`);
}

/** ad-hoc 서명 인자. deep=true 면 번들 안 표준 위치의 중첩 코드까지 서명한다. */
function buildAdhocSignArgs(target, deep) {
  const args = ['--force'];
  if (deep) args.push('--deep');
  args.push('--sign', '-', '--timestamp=none', target);
  return args;
}

/** 서명 검증 인자. 실패하면 codesign 이 0 이 아닌 종료 코드를 낸다. */
function buildVerifyArgs(appPath) {
  return ['--verify', '--deep', '--strict', '--verbose=2', appPath];
}

/** 서명 정보 표시 인자(출력은 stderr). */
function buildDisplayArgs(appPath) {
  return ['-dv', '--verbose=2', appPath];
}

/** `codesign -dv` 출력에서 Authority= 줄(서명자 사슬, 첫 줄이 서명 주체)을 뽑는다. */
function parseSigningAuthorities(displayOutput) {
  return String(displayOutput || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Authority='))
    .map((line) => line.slice('Authority='.length).trim());
}

/** 서명 주체가 Developer ID Application 인증서인지. ad-hoc·미서명은 false. */
function isDeveloperIdSigned(displayOutput) {
  const authorities = parseSigningAuthorities(displayOutput);
  return (
    authorities.length > 0 &&
    authorities[0].startsWith('Developer ID Application:')
  );
}

/**
 * 파일 앞 8바이트가 Mach-O(단일·universal)인지.
 * universal 매직 0xCAFEBABE 는 Java class 파일과 같으므로 아키텍처 개수(작은 수)로 구분한다.
 */
function isMachOHeader(buf) {
  if (!buf || buf.length < 4) return false;
  const be = buf.readUInt32BE(0);
  const thin = [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe];
  if (thin.includes(be)) return true;
  if (be === 0xcafebabe || be === 0xcafebabf) {
    if (buf.length < 8) return false;
    const nfat = buf.readUInt32BE(4);
    return nfat > 0 && nfat < 20;
  }
  return false;
}

function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8);
    const n = fs.readSync(fd, buf, 0, 8, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/** dir 아래(하위 포함)의 Mach-O 일반 파일 목록. 심볼릭 링크는 따라가지 않는다. */
function findMachOFiles(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  const walk = (current) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) return;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && isMachOHeader(readHeader(full))) {
        found.push(full);
      }
    });
  };
  walk(dir);
  return found.sort();
}

function runCodesign(args) {
  childProcess.execFileSync(CODESIGN, args, { stdio: 'inherit' });
}

/** 이미 유효한 Developer ID 서명인지(서명자 확인 + 엄격 검증 통과). */
function hasValidDeveloperIdSignature(appPath) {
  // `codesign -dv` 는 정보를 stderr 로 내고 미서명이면 0 이 아닌 코드로 끝나므로 spawnSync 로 둘 다 받는다.
  const shown = childProcess.spawnSync(CODESIGN, buildDisplayArgs(appPath), {
    encoding: 'utf8',
  });
  const output = `${shown.stdout || ''}\n${shown.stderr || ''}`;
  if (shown.status !== 0 || !isDeveloperIdSigned(output)) return false;
  // 패키징으로 서명이 깨졌어도 -dv 는 원래 서명자를 보여 줄 수 있으므로 검증까지 통과해야 유효로 본다.
  try {
    childProcess.execFileSync(CODESIGN, buildVerifyArgs(appPath), {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function macAdhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = resolveAppPath(context);
  if (process.platform !== 'darwin') {
    // codesign 은 macOS 에만 있다. mac 이 아닌 호스트의 mac 패키징은 서명할 수 없음을 알리고 넘어간다.
    console.warn(
      `[macAdhocSign] macOS 가 아닌 호스트(${process.platform})라 ad-hoc 서명을 건너뜁니다: ${appPath}`,
    );
    return;
  }
  if (!fs.existsSync(appPath)) {
    throw new Error(`[macAdhocSign] 앱 번들을 찾지 못했습니다: ${appPath}`);
  }

  if (hasValidDeveloperIdSignature(appPath)) {
    console.log(
      `[macAdhocSign] 유효한 Developer ID 서명이 있어 ad-hoc 재서명을 건너뜁니다: ${appPath}`,
    );
    return;
  }

  try {
    const resourcesDir = path.join(appPath, 'Contents', 'Resources');
    const nativeFiles = findMachOFiles(resourcesDir);
    nativeFiles.forEach((file) => {
      runCodesign(buildAdhocSignArgs(file, false));
    });
    runCodesign(buildAdhocSignArgs(appPath, true));
    runCodesign(buildVerifyArgs(appPath));
    console.log(
      `[macAdhocSign] ad-hoc 서명·검증 완료(네이티브 ${nativeFiles.length}개 포함): ${appPath}`,
    );
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    throw new Error(`[macAdhocSign] ad-hoc 서명 또는 검증 실패: ${message}`);
  }
}

module.exports = macAdhocSign;
module.exports.default = macAdhocSign;
module.exports.resolveAppPath = resolveAppPath;
module.exports.buildAdhocSignArgs = buildAdhocSignArgs;
module.exports.buildVerifyArgs = buildVerifyArgs;
module.exports.buildDisplayArgs = buildDisplayArgs;
module.exports.parseSigningAuthorities = parseSigningAuthorities;
module.exports.isDeveloperIdSigned = isDeveloperIdSigned;
module.exports.isMachOHeader = isMachOHeader;
module.exports.findMachOFiles = findMachOFiles;
module.exports.hasValidDeveloperIdSignature = hasValidDeveloperIdSignature;
