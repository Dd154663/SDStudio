# SDStudio 3.5.0.b - Claude Build & Deploy Guide

> **Important**: This file is a reference for Claude (AI assistant) to follow
> when building, committing, and exporting SDStudio.
> Context compaction may cause Claude to lose these routines - always check this file first.

---

## 1. PC (Electron) Build

### Step 1: Webpack build (main + renderer)
```bash
cd "C:\Users\ii011\Downloads\SDStudio-3.5.0.b" && npm run build 2>&1
```

### Step 2: Electron app packaging (creates win-unpacked folder)
```bash
cd "C:\Users\ii011\Downloads\SDStudio-3.5.0.b" && npx electron-builder build --publish never --dir 2>&1
```

**Output**: `release/build/win-unpacked/`

---

## 2. Android APK Build

### Prerequisite: Webpack build must be done first (Step 1 above), then:
```bash
cd "C:\Users\ii011\Downloads\SDStudio-3.5.0.b" && npx cap sync android 2>&1
```

### APK Build (Release):
```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" && cd "C:\Users\ii011\Downloads\SDStudio-3.5.0.b" && ./android/gradlew.bat -p android assembleRelease 2>&1
```

### Copy APK to Downloads:
```bash
cp "C:/Users/ii011/Downloads/SDStudio-3.5.0.b/android/app/build/outputs/apk/release/app-release.apk" "C:/Users/ii011/Downloads/SDStudio-3.5.0.b-android.apk" 2>&1
```

**Output**: `SDStudio-3.5.0.b-android.apk` in Downloads folder

---

## 3. Source Code Export

Uses `git archive` to export only tracked files (excludes node_modules, build outputs, .git):
```bash
cd "C:\Users\ii011\Downloads\SDStudio-3.5.0.b" && git archive --format=zip --output="../SDStudio-3.5.0.b-source.zip" HEAD 2>&1
```

**Output**: `SDStudio-3.5.0.b-source.zip` in Downloads folder

---

## 4. Verify All Outputs

```bash
ls -lh "C:/Users/ii011/Downloads/SDStudio-3.5.0.b-source.zip" "C:/Users/ii011/Downloads/SDStudio-3.5.0.b-android.apk" 2>&1 && echo "---" && cd "C:\Users\ii011\Downloads\SDStudio-3.5.0.b" && git log --oneline -6
```

---

## 5. Git Commit Convention

- Commit message in Korean
- 1-line summary + optional detail body
- Always end with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
- Stage specific files (avoid `git add -A`)
- Use HEREDOC format:
```bash
git commit -m "$(cat <<'EOF'
커밋 메시지 요약

상세 설명 (선택사항)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Full Build + Export Sequence

When user asks to "build, commit, and export", run these in order:

1. `git add <files> && git commit` (with HEREDOC)
2. `npm run build` (webpack)
3. `npx electron-builder build --publish never --dir` (PC)
4. `npx cap sync android` (sync web to android)
5. `export JAVA_HOME=... && ./android/gradlew.bat -p android assembleRelease` (APK)
6. `cp ... app-release.apk` (copy APK)
7. `git archive --format=zip --output=... HEAD` (source zip)
8. `ls -lh ...` (verify)

---

## Notes

- **DO NOT** use `npx vite build` - this project uses webpack, not vite
- **DO NOT** use `git add -A` or `git add .` - always stage specific files
- The `webDir` in capacitor.config.ts points to `release/app/dist/renderer` which is the webpack output
- `npx cap sync android` must run after webpack build and before gradle build
- JAVA_HOME must point to Android Studio's bundled JBR
