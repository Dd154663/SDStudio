; SDStudio NSIS 사용자 정의 스크립트 (electron-builder 가 buildResources 의 installer.nsh 를 자동 포함)
;
; 배경: electron-builder 기본 언인스톨러는 업데이트 설치 때 설치 폴더($INSTDIR) 안의 "모든" 파일을
; 지운다(RMDir /r $INSTDIR). 사용자가 설치 폴더 안에 작업 폴더·저장 경로를 두면 업데이트 한 번에
; 데이터가 통째로 사라진다(실사고). 그래서 두 겹으로 막는다.
;   ① customRemoveFiles — 이 버전부터 설치되는 언인스톨러는 앱이 설치한 항목만 지운다.
;   ② 데이터 흔적 가드 — 설치 관리자는 어떤 삭제(옛 언인스톨러 실행)보다 먼저, 이전 설치 폴더와
;      설치할 폴더에 SDStudio 데이터 흔적이 있으면 설치를 중단한다. 5.5.0 이하에서 올라올 때는
;      옛 언인스톨러(전체 삭제)가 실행되므로 ②가 유일한 방어선이다.
;
; 주의: 이 파일은 installer.nsi 앞부분(헤더)에 포함된다. 매크로 본문은 삽입 위치에서 펼쳐지므로
; common.nsh 의 정의(APP_EXECUTABLE_FILENAME·UNINSTALL_FILENAME·INSTALL_REGISTRY_KEY)를 쓸 수 있다.
; 경고는 오류로 취급되므로(-WX) 쓰지 않는 Function 을 만들지 않는다.

; ─── ② 데이터 흔적 가드 ───
; DIR 폴더에 SDStudio 데이터 흔적이 있으면 설치를 중단한다(레지스트리·파일 무변경).
; KIND: previous = 이전 설치 폴더(업데이트 때 옛 언인스톨러가 정리하는 곳), target = 설치할 폴더.
; 흔적 기준: storage_version.json·config.json 파일, workspace·outs·projects·inpaints·vibes·references
; 폴더(IfFileExists 는 파일·폴더 모두 맞춘다). 설치 폴더가 Electron userData 와 겹친 경우를 위해
; 기본 데이터 루트(하위 SDStudio)의 마커 2종도 본다.
!macro sdsGuardDataDir DIR KIND
  ${If} "${DIR}" != ""
    ${If} ${FileExists} "${DIR}\storage_version.json"
    ${OrIf} ${FileExists} "${DIR}\config.json"
    ${OrIf} ${FileExists} "${DIR}\workspace"
    ${OrIf} ${FileExists} "${DIR}\outs"
    ${OrIf} ${FileExists} "${DIR}\projects"
    ${OrIf} ${FileExists} "${DIR}\inpaints"
    ${OrIf} ${FileExists} "${DIR}\vibes"
    ${OrIf} ${FileExists} "${DIR}\references"
    ${OrIf} ${FileExists} "${DIR}\SDStudio\storage_version.json"
    ${OrIf} ${FileExists} "${DIR}\SDStudio\config.json"
      ${IfNot} ${Silent}
        !if "${KIND}" == "previous"
          MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST|MB_SETFOREGROUND "이전 설치 폴더에 SDStudio 데이터가 있어 업데이트하면 삭제될 수 있습니다. 데이터를 다른 폴더로 옮긴 뒤 설치 프로그램을 다시 실행해 주세요.$\r$\nSDStudio data was found in the previous installation folder and may be deleted by the update. Move the data to another folder and run the installer again.$\r$\n$\r$\n${DIR}"
        !else
          MessageBox MB_OK|MB_ICONSTOP|MB_TOPMOST|MB_SETFOREGROUND "이 폴더에 SDStudio 데이터가 있어 설치하면 삭제될 수 있습니다. 다른 폴더를 고르거나 데이터를 옮긴 뒤 설치 프로그램을 다시 실행해 주세요.$\r$\nSDStudio data was found in this folder and may be deleted by the installation. Choose another folder or move the data, then run the installer again.$\r$\n$\r$\n${DIR}"
        !endif
      ${EndIf}
      ; 무음 설치(/S)는 0 아닌 종료 코드로 실패를 알린다(2 는 언인스톨 실패 코드라 피한다).
      SetErrorLevel 3
      Quit
    ${EndIf}
  ${EndIf}
!macroend

; .onInit 끝(initMultiUser 이후) — GUI·무음·권한 상승 내부 인스턴스 모두 거친다. 설치 섹션의
; uninstallOldVersion 보다 반드시 먼저다.
;  - 이전 설치 폴더(HKCU·HKLM InstallLocation): 업데이트 때 옛 언인스톨러는 새 설치 경로와 무관하게
;    이 폴더를 정리하므로, 사용자가 다른 폴더를 골라도 위험하다 → 모드와 무관하게 여기서 검사.
;  - 설치할 폴더($INSTDIR): 무음 설치는 페이지 콜백이 불리지 않아 여기 값($INSTDIR = 레지스트리 값·
;    기본값·/D)이 최종이다. GUI 는 사용자가 고른 뒤 확정되므로 설치 진행 페이지 표시 때 검사한다.
!macro customInit
  ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro sdsGuardDataDir "$R8" previous
  ReadRegStr $R8 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro sdsGuardDataDir "$R8" previous
  ${If} ${Silent}
    !insertmacro sdsGuardDataDir "$INSTDIR" target
  ${EndIf}
!macroend

; GUI 설치: 템플릿은 이 매크로 바로 뒤에 설치 진행(INSTFILES) 페이지를 넣고, 그 PRE 콜백
; instFilesPre 가 경로에 SDStudio 가 없으면 \SDStudio 를 붙인다. SHOW 콜백은 PRE 다음,
; 설치 섹션(uninstallOldVersion 포함) 실행 전에 불리므로 여기서 최종 $INSTDIR 을 검사한다.
; 디렉터리 페이지를 건너뛰는 갱신 설치(--updated, GUI)도 이 페이지는 거친다.
!macro customPageAfterChangeDir
  Function sdsInstFilesShow
    !insertmacro sdsGuardDataDir "$INSTDIR" target
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW sdsInstFilesShow
!macroend

; ─── ① customRemoveFiles — 앱이 설치한 항목만 지운다 ───
; 설치 결과물 최상위: SDStudio.exe, 언인스톨러, uninstallerIcon.ico, *.dll·*.pak·*.bin·*.dat,
; vk_swiftshader_icd.json, LICENSE.electron.txt, LICENSES.chromium.html, resources\, locales\
; (+ 옛 Electron 의 swiftshader\). 그 밖의 파일·폴더(사용자가 둔 것)는 남기고, 폴더가 비었을
; 때만 $INSTDIR 을 지운다. $INSTDIR 에 대한 RMDir /r 은 쓰지 않는다.
!macro _sdsRemoveAppItems FLAG
  Delete ${FLAG} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  Delete ${FLAG} "$INSTDIR\uninstallerIcon.ico"
  Delete ${FLAG} "$INSTDIR\*.dll"
  Delete ${FLAG} "$INSTDIR\*.pak"
  Delete ${FLAG} "$INSTDIR\*.bin"
  Delete ${FLAG} "$INSTDIR\*.dat"
  Delete ${FLAG} "$INSTDIR\vk_swiftshader_icd.json"
  Delete ${FLAG} "$INSTDIR\LICENSE.electron.txt"
  Delete ${FLAG} "$INSTDIR\LICENSES.chromium.html"
  RMDir /r ${FLAG} "$INSTDIR\resources"
  RMDir /r ${FLAG} "$INSTDIR\locales"
  RMDir /r ${FLAG} "$INSTDIR\swiftshader"
!macroend

!macro customRemoveFiles
  ${If} "$INSTDIR" == ""
    Abort "Installation directory is empty."
  ${EndIf}

  ${If} ${isUpdated}
    ; 업데이트 중에는 /REBOOTOK 을 쓰지 않는다 — 잠긴 파일을 재부팅 때 지우도록 예약하면 곧이어
    ; 설치된 "새" 파일이 재부팅 때 지워진다. 남은 핵심 파일이 있으면 실패로 끝내 설치 관리자가
    ; 재시도·실패 안내를 하게 한다(템플릿의 "File is busy, aborting" 과 같은 취지).
    !insertmacro _sdsRemoveAppItems ""
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${OrIf} ${FileExists} "$INSTDIR\resources\app.asar"
      Abort "File is busy, aborting: $INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${EndIf}
  ${Else}
    !insertmacro _sdsRemoveAppItems "/REBOOTOK"
  ${EndIf}

  ; 언인스톨러 자신은 /REBOOTOK 없이 지운다(같은 이름의 새 언인스톨러가 곧 기록될 수 있다).
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  ; 비어 있을 때만 제거된다(재귀 금지) — 사용자가 둔 파일이 있으면 폴더째 남는다.
  RMDir "$INSTDIR"
!macroend
