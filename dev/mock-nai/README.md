# 가짜 NovelAI 서버(개발자용 — 부스트 모드 디버그)

계정이 하나뿐이어도 여러 계정 동시 생성(부스트 모드 A/B), 할당 소진 탈락, 409·429·401, 설정 잠금,
계정 전환 차단, 결과 보기의 「생성 계정」 표식을 앱 화면에서 확인하기 위한 **이 PC 안 전용** 가짜 서버입니다.

- 실제 NovelAI 와 통신하지 않습니다. 이미지는 계정 색 바탕에 대각선 띠가 있는 단색 PNG 입니다.
- 시나리오에 적는 토큰은 `mock-` 로 시작하는 가짜 문자열입니다. **실제 NovelAI 토큰을 시나리오에 넣지 마세요**(서버가 거부합니다).
- **시나리오에 없는 토큰은 아무 문자열이든 `defaults` 값으로 자동 등록**됩니다(앱에 `dddd` 같은 더미를 저장해도 바로 동작). 시나리오 토큰만 받으려면 `"strictTokens": true`. 자동 계정은 `/__mock/reset` 때 지워지고 다음 요청에 다시 만들어집니다.
- 앱은 환경 변수 `SDSTUDIO_NAI_API_BASE` 가 있을 때만 이 서버로 연결합니다. 변수가 없으면 종전과 똑같이
  실제 NovelAI 로 연결합니다. 설정 화면·config 에는 아무것도 추가되지 않습니다. 이 PC 안 주소
  (`localhost`·`127.x.x.x`·`[::1]`)만 받으며 그 밖의 값은 무시합니다. **PC(Electron) 전용** — Android 는 해당 없음.

## 1. 서버 실행

Node(18 이상)만 있으면 됩니다. npm 설치가 필요 없습니다.

```powershell
node dev\mock-nai\server.cjs                # 기본 포트 18080
node dev\mock-nai\server.cjs --port 18081   # 포트 변경(또는 $env:MOCK_NAI_PORT)
node dev\mock-nai\server.cjs --scenario C:\경로\my.json   # 다른 시나리오(또는 $env:MOCK_NAI_SCENARIO)
node dev\mock-nai\server.cjs --selftest     # 자체 점검(임시 포트, 응답·PNG·409·차감 확인 후 종료)
```

창에 요청마다 한 줄씩 기록됩니다(토큰은 앞 6자만).

```
[14:02:11] 가짜 B(곧 소진)(mock-b…) POST /ai/generate-image → 200 generate 832x1216 seed=… #3 free 5% / boost 10% / anlas 0 → free 0% / boost 10% / anlas 0
[14:02:12] 가짜 A(넉넉)(mock-a…) POST /ai/generate-image → 409 동시 생성 잠금
```

종료는 서버 창에서 `Ctrl+C`.

## 2. 시나리오 편집

`scenario.json` 은 샘플입니다. 고쳐 쓰려면 **같은 폴더에 `scenario.local.json` 으로 복사**하세요.
서버는 `scenario.local.json` 이 있으면 그것을 먼저 읽고, 이 파일은 git 에서 제외됩니다.

```powershell
Copy-Item dev\mock-nai\scenario.json dev\mock-nai\scenario.local.json
```

계정 항목(`accounts` 배열, 빠진 값은 `defaults` → 기본값 순):

| 키 | 뜻 | 기본 |
|---|---|---|
| `token` | 가짜 토큰(`mock-` 로 시작, 필수) | — |
| `name` | 로그에 쓰는 이름(앱 프로필 이름과는 별개) | `계정N` |
| `opusSubscribed` | Opus 구독 여부(false = 미구독 — 모든 생성이 Anlas) | true |
| `percent` | 무료 회복형 할당(%) | 100 |
| `purchasedPercent` | 추가 충전(Usage Boost, %) | 0 |
| `isNegative` | 무료·추가 충전 모두 소진 상태 | false |
| `anlas` | Anlas 잔량 | 1000 |
| `delayMs` / `delayJitterMs` | 생성 응답 시간 / ±흔들림 | 1500 / 0 |
| `usagePerImage` | V5 생성 1장당 차감(%) | 5 |
| `anlasPerImage` | Anlas 로 생성할 때 1장당 차감 | 20 |
| `failEvery` | N번째 생성 시도마다 500(0 = 끔) | 0 |
| `rateLimit429Every` | N번째 생성 시도마다 429(0 = 끔) | 0 |
| `conflict409Every` | N번째 생성 시도마다 409 「Concurrent generation is locked」(0 = 끔) | 0 |
| `authFail` | true = 모든 요청 401(만료 토큰) | false |
| `timeUntilNextPercent` | `/user/data` 에 그대로 실림 | 300 |
| `color` | 이미지 바탕색 `#rrggbb`(비우면 이름으로 정함) | — |

서버 동작:

- **동시 생성 잠금**: 같은 토큰으로 생성(생성·증강·업스케일)이 진행 중일 때 또 요청하면
  `409 {"statusCode":409,"message":"Concurrent generation is locked"}` (앱은 「이전 요청 처리 중」 → 30초 뒤 재시도).
- **차감(V5 모델 `nai-diffusion-5*`)**: 무료분(`percent`) 먼저, 0 이면 추가 충전분(`purchasedPercent`).
  차감 뒤 둘 다 0 이면 `isNegative=true` — 그 뒤 생성은 Anlas 를 씁니다. Anlas 가 모자라면
  `402 {"message":"Not enough Anlas to perform this action."}`(문구는 추정, 앱은 「할당량 또는 Anlas 오류」로 분류).
- **V4.5 등**: Opus 구독 + 1MP 이하 + 28스텝 이하면 무료(차감 없음), 아니면 Anlas.
- 무료분의 시간 회복은 흉내 내지 않습니다. 되돌리려면 파일을 고치거나 초기화하세요.
- **파일 감시**: 저장하면 재시작 없이 반영됩니다. 이전 파일과 **값이 달라진 항목만** 현재 상태에 덮습니다
  (생성으로 줄어든 `percent` 는 다른 값을 고쳐 저장해도 그대로). `authFail`·`delayMs` 등 동작 값은 늘 최신 값입니다.
  생성 도중 `authFail: true` 로 저장하면 「실행 중 토큰 만료」를 흉내 낼 수 있습니다.
- **관리 주소**(인증 없음):

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:18080/__mock/reset    # 모든 계정을 시나리오 값으로 초기화
Invoke-RestMethod http://127.0.0.1:18080/__mock/state | ConvertTo-Json -Depth 5   # 현재 상태
```

## 3. 앱 실행(가짜 서버로 연결)

먼저 `npm run build` 후 `npx electron-builder build --publish never --dir` 로 만든 패키징 앱을 씁니다.
**변수는 그 PowerShell 창에서 실행한 앱에만** 적용됩니다(다른 창·바로가기로 연 앱은 실제 NovelAI).

```powershell
$env:SDSTUDIO_NAI_API_BASE = "http://127.0.0.1:18080"
& .\release\build\win-unpacked\SDStudio.exe
```

- 연결 중이면 main 로그(`%APPDATA%\SDStudio\logs\main.log`)와 개발자 도구 콘솔에
  「개발용 가짜 서버로 연결 중」 경고가 한 번씩 남습니다(패키징 앱은 PowerShell 창에는 찍히지 않음).
  서버 창에 `/user/data` 줄이 찍히면 연결된 것입니다.
- 개발 실행(`npm start`)도 같은 방식으로 변수를 주고 실행하면 됩니다.
- 이미 SDStudio 가 떠 있으면 새 창은 기존 프로세스에 합쳐지므로(단일 인스턴스) **먼저 모두 닫고** 실행하세요.

## 4. 가짜 토큰 등록

1. 환경설정 → 로그인 탭의 「저장할 API 토큰을 붙여넣으세요」 칸에 시나리오의 `token` 문자열
   (예 `mock-alpha-0001`)을 넣고 [입력 토큰 저장]. 저장된 프리셋은 이름 바꾸기로 알아보기 쉽게(예 「가짜 A」).
2. 같은 방법으로 2~3개 더 저장. 하나를 [전환] 해 현재 계정으로 둡니다.
3. 할당량 배지·상세 창에 시나리오의 `percent`/`purchasedPercent` 가 보이면 연결 성공입니다.

> 실제 계정 토큰 프로필이 있으면 그것도 가짜 서버로 보내져 401(모르는 토큰)이 됩니다 — 시험하는 동안은
> 가짜 토큰을 현재 계정으로 두세요. 실제 토큰은 이 PC 안 서버로만 가며 밖으로 나가지 않습니다.

## 5. 부스트 확인 절차(예)

1. 로그인 탭 「부스트 모드」 → 켜기 → 경고 창 확인 → 방식 B(나눠 생성), 범위 「무료 할당만」 → 저장.
2. 씬 하나에 예약 12장 → 생성. 서버 창에서 계정 이름이 번갈아 찍히고, 진행 막대에 「부스트 ×W」 가 보이는지.
3. `가짜 B(곧 소진)` 은 몇 장 뒤 소진 → 앱이 그 계정을 빼고 나머지로 계속하는지(로그 「…탈락」).
4. `가짜 D(미구독)`·`가짜 F(만료)` 는 참여 후보에서 빠지는지(범위 「Anlas 까지」 면 D 참여).
5. 방식 A(같은 장 복제)로 바꿔 예약 배지가 ×참여 수로 늘고, 한 계정 실패 시 그 계정 몫만 취소되는지.
6. 생성 중 로그인 탭 [토큰 로그인]·[전환]·[삭제]·할당량 상세 [전환] 이 막히는지, 멈추면 풀리는지.
7. 결과 보기 상세 정보의 「생성 계정: 이름」 표식(이미지 색으로도 계정 구분 가능).
8. 오류 흉내: 409 는 계정에 `"conflict409Every": 3` 처럼 넣고 저장(앱 「이전 요청 처리 중」 → 30초 뒤 재시도),
   429 는 `가짜 C`, 500 은 `가짜 E`, 실행 중 토큰 만료는 생성 도중 `"authFail": true` 로 저장.
   (진짜 동시 잠금 409 는 같은 토큰으로 겹쳐 보낼 때만 나는데, 앱은 같은 토큰 프로필을 한 계정으로 합치므로
   보통 나지 않습니다 — 그래서 흉내 값을 둡니다.)

## 6. 끝낸 뒤

```powershell
Remove-Item Env:SDSTUDIO_NAI_API_BASE   # 이 PowerShell 창의 변수 해제(창을 닫아도 사라짐)
```

- 앱을 다시 실행하면 실제 NovelAI 로 연결됩니다(변수 없음 = 종전).
- 환경설정 → 로그인 탭에서 **가짜 토큰 프로필을 모두 삭제**하고 실제 계정으로 [전환] 하세요
  (가짜 토큰이 현재 계정이면 실제 서버에서 로그인 실패로 보입니다).
- 부스트 모드를 쓰지 않을 거면 꺼 두세요. 가짜 서버 창은 `Ctrl+C` 로 종료.
