package io.sunho.SDStudio;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;

import io.sunho.SDStudio.SDSNative;
import io.sunho.SDStudio.FetchService;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // 과거 원격 스택트레이스 로거(ExceptionHandler.register)가 남긴 크래시 파일 정리.
    // 해당 라이브러리는 앱 시작 시 저장된 크래시 파일을 Apache HttpClient(API 28+에서
    // OS에서 제거됨)로 전송하려다 또 크래시 → 새 크래시 파일 저장 → 무한 크래시 루프를
    // 만들었으므로 제거함. 루프에 빠진 기존 설치본 복구를 위해 잔존 파일도 지운다.
    try {
      java.io.File dir = getApplicationContext().getDir("stacktraces", 0);
      java.io.File[] leftovers = dir.listFiles();
      if (leftovers != null) {
        for (java.io.File f : leftovers) f.delete();
      }
    } catch (Exception e) {
      Logger.error("stacktraces cleanup failed: " + e.getMessage());
    }
    registerPlugin(FetchService.class);
    registerPlugin(ImageResizer.class);
    registerPlugin(ZipService.class);
    registerPlugin(TagDB.class);

    if (Build.VERSION.SDK_INT >= 30) {
      if (!Environment.isExternalStorageManager()) {
        try {
          Uri uri = Uri.parse("package:" + BuildConfig.APPLICATION_ID);
          Intent getpermission = new Intent();
          getpermission.setAction(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
          getpermission.setData(uri);
          startActivity(getpermission);
        } catch (Exception ex) {
          try {
            Logger.error(ex.getMessage());
            Intent intent = new Intent();
            intent.setAction(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
            startActivity(intent);
          } catch (Exception ex2) {
            Logger.error(ex2.getMessage());
          }
        }
      }
    }
    super.onCreate(savedInstanceState);
  }
}
