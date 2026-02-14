npm run build:renderer

npx cap sync android

cd android
./gradlew assembleDebug

cd ..