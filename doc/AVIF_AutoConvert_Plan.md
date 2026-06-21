# AVIF 자동 변환 기능 구현 계획

> **프로젝트**: SDStudio v4.12.2  
> **목표**: NovelAI 이미지 생성 직후 PNG → AVIF 자동 변환 (메타데이터 보존, 용량 80~90% 감소)  
> **설정 옵션**: `autoConvertAvif` (bool, 기본값 false), `avifQuality` (number, 기본값 75)  
> **기술 스택**: Electron 26 (Chromium 116), sharp ^0.32.6 (이미 dependency), TypeScript

---

## 1. 설계 결정 (Design Decisions)

### 1.1 Hook Point: `write-data-file` IPC Handler (`.avif` 확장자 시그널)

`main.ts`의 `write-data-file` 핸들러에서 **출력 파일명 확장자가 `.avif`인 경우** sharp로 변환을 수행한다.  
별도 IPC 핸들러 없이 확장자 기반으로 판단하므로 기존 `writeDataFile()` 인터페이스 변경이 필요 없다.

```
TaskQueueService.handleTask()
  → const ext = config.autoConvertAvif ? '.avif' : '.png';
  → const outputFilePath = ... + Date.now() + ext;
  → backend.generateImage(arg)           // internally writes PNG base64
    → main.ts write-data-file handler:
      → if filename.endsWith('.avif'):
          sharp(tmpFile).withMetadata().avif({quality}).toFile(finalPath)
      → else:
          fs.rename(tmpFile, finalPath)
```

### 1.2 변환 범위: 생성 이미지 ONLY

- **변환 대상**: NovelAI 생성 이미지 (SD generation), Augment 결과, Remove-bg 결과
- **변환 제외**: Vibe/Reference 이미지, Inpaint Mask/Org, Preset 내보내기, 붙여넣기 이미지 → 계속 PNG 유지
- **이유**: 생성 이미지만 대량 발생하며 용량 이슈의 원인. 나머지는 개수가 적고 다른 목적(API 전송, 편집 등)에 사용됨.

### 1.3 메타데이터 보존 전략

| 메타데이터 | AVIF 변환 후 | 비고 |
|---|---|---|
| **EXIF Comment** (프롬프트 JSON) | 보존 | sharp `.withMetadata()` 가 자동 보존 |
| **EXIF UserComment** | 보존 | 동일 메커니즘 |
| **Alpha-channel Steganography** | 소실 | LSB 기반 인코딩이므로 손실 압축 시 파괴됨 |
| **ICC Profile** | 보존 | sharp `.withMetadata()` 가 자동 보존 |

**스테가노그래피 소실은 수용 가능**: SDStudio는 EXIF Comment를 1순위, 스테가노그래피를 2순위 fallback 으로 사용한다. 동일 프롬프트 데이터가 EXIF Comment에 중복 저장되어 있으므로 기능상 문제없다.

### 1.4 기존 PNG 파일과의 공존

- AVIF 변환은 **생성 시점**에만 적용. 기존 PNG 파일은 그대로 유지
- 확장자 필터를 `.png` → `.png` + `.avif` 로 확장하여 두 형식 모두 표시
- 설정 OFF 시 기존과 완전히 동일한 동작 (완전한 하위 호환)

---

## 2. 파일별 변경 사항

### 2.1 `src/main/config.ts` — Config 타입 확장

```typescript
export interface Config {
  // ... 기존 필드 ...
  autoConvertAvif?: boolean;    // 기본값 false (하위 호환)
  avifQuality?: number;         // 기본값 75 (50~95 권장)
}
```

**변경량**: +2 lines

---

### 2.2 `src/main/main.ts` — 핵심 변환 로직

#### a) `getMimeType()` — AVIF MIME 추가 (line ~76)
```typescript
case '.avif':
  return 'image/avif';
```

#### b) `write-data-file` handler — AVIF 변환 로직 (line ~281)
```typescript
ipcMain.handle('write-data-file', async (event, filename, data) => {
  const binaryData = Buffer.from(data, 'base64');
  const dir = path.dirname(APP_DIR + '/' + filename);
  await fs.mkdir(dir, { recursive: true });
  const finalPath = APP_DIR + '/' + filename;
  const tmpFile = APP_DIR + '/' + uuidv4();
  await fs.writeFile(tmpFile, binaryData);

  if (filename.toLowerCase().endsWith('.avif')) {
    // PNG → AVIF 변환 (EXIF 보존)
    try {
      await sharp(tmpFile)
        .withMetadata()
        .avif({
          quality: (config.avifQuality ?? 75),
          effort: 4,
        })
        .toFile(finalPath);
      await fs.unlink(tmpFile);
    } catch (e) {
      // 변환 실패 시 원본 PNG로 fallback
      console.error('AVIF conversion failed, saving as PNG:', e);
      const pngPath = finalPath.replace(/\.avif$/i, '.png');
      await fs.rename(tmpFile, pngPath);
    }
  } else {
    await fs.rename(tmpFile, finalPath, { recursive: true });
  }
});
```

**변경량**: +15 lines

---

### 2.3 `src/renderer/models/TaskQueueService.ts` — 확장자 결정

#### a) SD Generation `handleTask()` (line ~256)
```typescript
const ext = config.autoConvertAvif ? '.avif' : '.png';
const outputFilePath = task.params.outputPath + '/' + Date.now().toString() + ext;
```

#### b) Remove-bg `handleTask()` (line ~602)
```typescript
const ext = config.autoConvertAvif ? '.avif' : '.png';
const outputFilePath = task.params.outputPath + '/' + Date.now().toString() + ext;
```

#### c) Augment `handleTask()` (line ~657)
```typescript
const ext = config.autoConvertAvif ? '.avif' : '.png';
const outputFilePath = task.params.outputPath + '/' + Date.now().toString() + ext;
```

**변경량**: 3곳, 각 ±3 lines

---

### 2.4 `src/renderer/models/ImageService.ts` — 이미지 로딩/필터링

#### a) `refresh()` 확장자 필터 (line ~559)
```typescript
// Before:
files = files.filter((x: string) => x.endsWith('.png'));

// After:
files = files.filter((x: string) => x.endsWith('.png') || x.endsWith('.avif'));
```

#### b) `base64ToDataUri()` MIME 동적 처리 (line ~691)
```typescript
// Before:
return 'data:image/png;base64,' + data;

// After:
private base64ToDataUri(data: string, filePath?: string): string {
  const ext = filePath ? filePath.split('.').pop()?.toLowerCase() : 'png';
  const mime = ext === 'avif' ? 'image/avif' : 'image/png';
  return `data:${mime};base64,${data}`;
}
```

> 참고: `base64ToDataUri` 의 모든 호출부를 확인하고 필요 시 `filePath` 인자를 추가한다.  
> 내부적으로 `readDataFile` → `readFileAsDataURL` 경로는 `getMimeType()`이 이미 처리하므로,  
> 이 함수는 메모리상의 raw base64 데이터를 다룰 때만 사용된다.

**변경량**: ±10 lines

---

### 2.5 `src/renderer/models/SessionService.ts` — 내보내기 필터

`.endsWith('.png')` → `.endsWith('.png') || .endsWith('.avif')`:
- Line 624: `find()` (첫 번째 출력 이미지 찾기)
- Line 908: Export output images 필터
- Line 916: Export inpaint originals 필터
- Line 923: Export inpaint masks 필터
- Line 931: Export inpaint results 필터
- Line 939: Export vibe files 필터
- Line 946: Export reference files 필터

**변경량**: 7곳, 각 ±1 line

---

### 2.6 `src/renderer/models/TrashService.ts` — 휴지통 필터

Line 132: `.endsWith('.png')` → `.endsWith('.png') || .endsWith('.avif')`

**변경량**: ±1 line

---

### 2.7 `src/renderer/models/GameService.ts` — 게임 이미지 필터

Line 124: `.endsWith('.png')` → `.endsWith('.png') || .endsWith('.avif')`

**변경량**: ±1 line

---

### 2.8 `src/renderer/models/AppService.ts` — 씬 디렉토리 확인

Line 3721: `f.endsWith('.png')` → `f.endsWith('.png') || f.endsWith('.avif')`

**변경량**: ±1 line

---

### 2.9 `src/renderer/models/workflows/SDWorkFlow.ts` — 경로 디스크리미네이터

Line 398: 파일 경로 구분자
```typescript
// Before:
const image = preset.image.endsWith('.png') ? ... : preset.image;

// After:
const image = (preset.image.endsWith('.png') || preset.image.endsWith('.avif')) ? ... : preset.image;
```

**변경량**: ±1 line

---

### 2.10 `src/renderer/componenets/ConfigScreen.tsx` — 설정 UI

#### a) Import 확장
```typescript
import { Config, ImageEditor, RemoveBgQuality } from '../../main/config';
```
→ 이미 import 되어 있으므로 변경 불필요

#### b) State 추가 (line ~690 영역)
```typescript
const [autoConvertAvif, setAutoConvertAvif] = useState(false);
const [avifQuality, setAvifQuality] = useState(75);
```

#### c) useEffect 로드 (line ~699 영역)
```typescript
setAutoConvertAvif(config.autoConvertAvif ?? false);
setAvifQuality(config.avifQuality ?? 75);
```

#### d) StorageTab Props 확장 및 UI 추가 (line ~139)
```tsx
const StorageTab = ({
  saveLocation, selectFolder, clearImageCache,
  refreshImage, setRefreshImage,
  autoConvertAvif, setAutoConvertAvif,   // new
  avifQuality, setAvifQuality,           // new
}: any) => (
  <div className="space-y-4">
    {/* 기존 저장경로 UI ... */}
    <hr className="border-gray-200 dark:border-slate-600" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgAvif" checked={autoConvertAvif}
        onChange={(e) => setAutoConvertAvif(e.target.checked)} />
      <label htmlFor="cfgAvif" className="text-sm gray-label">
        생성 이미지 AVIF 자동 변환 (PNG → AVIF, 용량 80~90% 감소)
      </label>
    </div>
    {autoConvertAvif && (
      <div className="ml-6 flex items-center gap-2">
        <label className="text-xs gray-label">품질:</label>
        <input type="range" min="30" max="100" value={avifQuality}
          onChange={(e) => setAvifQuality(parseInt(e.target.value))}
          className="flex-1" />
        <span className="text-xs gray-label w-8">{avifQuality}</span>
      </div>
    )}
    {/* 기타 UI ... */}
  </div>
);
```

#### e) `getTabContent()` StorageTab 호출 (line ~853)
```tsx
<StorageTab {...{ saveLocation, selectFolder, clearImageCache, refreshImage, setRefreshImage, autoConvertAvif, setAutoConvertAvif, avifQuality, setAvifQuality }} />
```

#### f) `handleSave()` config 저장 (line ~808)
```typescript
const config: Config = {
  ...old,
  // ... 기존 필드 ...
  autoConvertAvif: autoConvertAvif,
  avifQuality: avifQuality,
};
```

**변경량**: ±25 lines

---

### 2.11 `src/renderer/componenets/Tournament.tsx` — 토너먼트 필터

Line 204: `.endsWith('.png')` → `.endsWith('.png') || .endsWith('.avif')`

**변경량**: ±1 line

---

### 2.12 `src/renderer/backends/androidBackend.ts` — Android MIME (선택)

Line 55-56: MIME 타입 매핑에 AVIF 추가
```typescript
case 'avif':
  return 'image/avif';
```

> Android 백엔드는 AVIF 변환을 구현하지 않는다 (sharp 는 Node.js 전용).  
> 모바일 환경에서 `autoConvertAvif` 설정은 무시된다.

**변경량**: ±2 lines

---

## 3. 변경 제외 대상 (DO NOT CHANGE)

| 파일 | 코드 | 이유 |
|---|---|---|
| `canvas.toDataURL('image/png')` (6곳) | 중간 처리용 Canvas 출력 | 브라우저 Canvas는 AVIF를 지원하지 않거나 인코딩이 느림. 중간 데이터이므로 용량 문제 없음. |
| `ImageService.storeVibeImage()` | `.png` 확장자 | Vibe 이미지는 API 전송용이며 개수 제한적 |
| `ImageService.storeReferenceImage()` | `.png` 확장자 | Reference 이미지도 개수 제한적 |
| `SessionService` inpaint paths | `.png` 확장자 | Mask/Org 는 편집용으로 소수 |
| `AppService.ts` paste/export paths | `.png` 확장자 | 내보내기는 이미 format 선택 지원함 |
| `type.d.ts` | `declare module '*.png'` | 번들 에셋용 선언 |
| `DownloadDialog.tsx` | `.png` 확장자 | Export dialog — 이미 포맷 선택 지원 |
| `data:image/png;base64,...` hardcoded (7곳) | 중간 데이터 URI | Canvas/manipulation 중간 결과물 |

---

## 4. 테스트 계획

### 4.1 단위 테스트 (수동)

| 테스트 케이스 | 확인 사항 |
|---|---|
| 설정 OFF → 이미지 생성 | `.png` 생성, 기존과 동일 동작 |
| 설정 ON → 이미지 생성 | `.avif` 생성, 파일 크기가 원본 PNG 대비 80~90% 작음 |
| 설정 ON → EXIF 보존 확인 | 생성된 AVIF 파일을 exifreader 로 읽어 Comment 필드에 프롬프트 JSON 존재 확인 |
| 설정 ON → 이미지 표시 | AVIF 이미지가 씬 카드, 뷰어, 썸네일에 정상 표시 |
| PNG + AVIF 혼합 씬 | `.png` 와 `.avif` 가 같은 씬에 공존, 모두 표시 |
| AVIF → 내보내기 | 내보내기 시 AVIF 원본 유지 (또는 사용자 선택에 따라 포맷 변환) |
| 품질 30 / 75 / 100 | 화질 차이 확인, 용량 차이 확인 |
| AVIF 변환 실패 시 | `.png` 로 fallback, 오류 메시지 없이 정상 진행 |

### 4.2 회귀 테스트

| 영역 | 확인 사항 |
|---|---|
| Vibe 생성/저장/로드 | `.png` 확장자 그대로, 기능 변함 없음 |
| Reference 이미지 | `.png` 확장자 그대로 |
| Inpaint (마스크/원본) | `.png` 확장자 그대로 |
| 붙여넣기 이미지 추가 | `.png` 로 저장 |
| Preset 내보내기 | PNG 정상 내보내기 |
| Mirror crop | 정상 동작 |
| 휴지통 복원 | 정상 동작 |
| 세션 Export/Import | AVIF 파일 포함하여 정상 |

---

## 5. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| sharp 0.32.6 + libheif 버전이 EXIF 를 AVIF 에 기록하지 못함 | 메타데이터 소실 → 프롬프트 복원 불가 | 테스트로 확인. 문제 시 `sharp` 버전 업그레이드 검토 (0.33+). |
| AVIF 인코딩 속도가 생성 속도보다 느림 | 태스크 큐 병목 | `effort: 4` (기본값) → `effort: 2` 로 낮춰 속도 향상 (품질 미미하게 하락). |
| Alpha Channel (RGBA 이미지) 손상 | Inpaint/Vibe 이미지의 투명도 손실 | 생성 이미지는 RGB(JPG 압축 스트림)이므로 Alpha 문제 발생 가능성 낮음. 만약 문제 시 `sharp.ensureAlpha()` 로 처리. |
| Android/모바일 미지원 | 모바일에서 설정 무시 | `autoConvertAvif` 설정을 모바일에서 비활성화 또는 무시 처리. |

---

## 6. 구현 순서

```
Phase 4-1: Config 타입 확장       (config.ts, 5분)
Phase 4-2: main.ts 핵심 변환 로직  (main.ts, 30분)
Phase 4-3: TaskQueueService 확장자  (TaskQueueService.ts, 10분)
Phase 4-4: 확장자 필터 일괄 수정   (ImageService, SessionService, TrashService, GameService, AppService, SDWorkFlow, Tournament, 20분)
Phase 4-5: ConfigScreen UI         (ConfigScreen.tsx, 20분)
Phase 4-6: Android MIME 추가       (androidBackend.ts, 5분)
Phase 5: 통합 테스트               (수동, 30분)
```

**예상 총 작업량**: 약 15개 파일, ±70 lines

---

## 7. 참고

- 참조 스크립트: `E:\Risuwork\convert_to_avif.py` — PIL/piexif 기반 AVIF 변환 (메타데이터 보존 로직 참고)
- sharp AVIF 문서: https://sharp.pixelplumbing.com/api-output#avif
- NovelAI 메타데이터 구조: `src/renderer/models/util.ts` (`extractExifFromBase64`, `parseCommentToJob`)
- 기존 AVIF 리사이즈 코드: `src/main/main.ts:646-651` (`resize-image` handler)
