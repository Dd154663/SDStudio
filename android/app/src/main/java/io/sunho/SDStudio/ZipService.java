package io.sunho.SDStudio;

import static androidx.core.content.ContextCompat.startActivity;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.MediaStore;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.*;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream;
import org.json.JSONException;
import org.json.JSONObject;


import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import java.io.*;
import java.util.List;

@CapacitorPlugin(name = "ZipService")
public class ZipService extends Plugin {

  @PluginMethod
  public void zipFiles(PluginCall call) {
    // 원자적 아카이브 쓰기: '.part' 임시 경로에 기록 후 완료 시 rename.
    // 도중 종료 시 불완전 tar 가 최종 경로에 남지 않는다(트랙1 (b) 백업 원자성 §4-0).
    String outPath = call.getString("outPath");
    String tmpPath = outPath + ".part";
    File tmpFile = new File(tmpPath);
    try {
      List<JSONObject> files = call.getArray("files").toList();
      FileOutputStream fos = new FileOutputStream(tmpFile);
      BufferedOutputStream bos = new BufferedOutputStream(fos);
      //GzipCompressorOutputStream gzipOut = new GzipCompressorOutputStream(bos);
      TarArchiveOutputStream tarOut = new TarArchiveOutputStream(bos);
      // 엔트리 이름 100바이트 초과(한글 프로젝트/씬 이름이면 흔함) 시 기본 모드
      // (LONGFILE_ERROR)는 RuntimeException 을 던져 미처리로 프로세스가 즉사한다
      // (모바일 백업 완료 직전 튕김의 원인). PAX 확장 헤더로 긴 이름을 기록한다 —
      // PC(tar-stream)·복원(TarArchiveInputStream) 모두 PAX 를 지원해 호환 유지.
      tarOut.setLongFileMode(TarArchiveOutputStream.LONGFILE_POSIX);
      tarOut.setBigNumberMode(TarArchiveOutputStream.BIGNUMBER_POSIX);

      for (JSONObject file : files) {
        String fileName = file.getString("name");
        String filePath = file.getString("path");
        addFileToTar(tarOut, filePath, fileName);
      }

      tarOut.finish();
      tarOut.close();

      File finalFile = new File(outPath);
      if (finalFile.exists()) {
        finalFile.delete();
      }
      if (!tmpFile.renameTo(finalFile)) {
        tmpFile.delete();
        throw new IOException("Failed to finalize archive (rename)");
      }
      call.resolve();
    } catch (Exception e) {
      // IOException/JSONException 외의 런타임 예외(라이브러리가 던지는
      // RuntimeException 등)도 흡수한다 — 플러그인 스레드의 미처리 예외는
      // 앱 프로세스 전체를 죽이므로(실기 크래시 사례) 반드시 reject 로 변환.
      // 불완전 임시 파일 정리 시도
      if (tmpFile.exists()) {
        tmpFile.delete();
      }
      call.reject("Failed to zip files", e);
    }
  }

  // 데이터 루트 볼륨의 실제 여유 공간(bytes) — 마이그레이션 백업 게이트 공간 판정용.
  // 데이터는 Documents/.SDStudio 하위에 있어 외부 저장 볼륨과 동일하므로 그 볼륨의
  // StatFs 를 조회한다. navigator.storage.estimate() 는 WebView 가 캡된 쿼터(≈10GB)를
  // 돌려줘 실제 디스크 여유와 무관하므로 네이티브 StatFs 로 대체한다(트랙1 (b) §4-1).
  @PluginMethod
  public void getFreeSpace(PluginCall call) {
    try {
      File dir = Environment.getExternalStorageDirectory();
      StatFs stat = new StatFs(dir.getAbsolutePath());
      long available = stat.getAvailableBytes();
      JSObject ret = new JSObject();
      ret.put("bytes", available);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Failed to get free space", e);
    }
  }

  private void addFileToTar(TarArchiveOutputStream tarOut, String filePath, String entryName) throws IOException {
    File file = new File(filePath);
    TarArchiveEntry tarEntry = new TarArchiveEntry(file, entryName);
    tarEntry.setSize(file.length());
    tarOut.putArchiveEntry(tarEntry);

    BufferedInputStream bis = new BufferedInputStream(new FileInputStream(file));
    byte[] buffer = new byte[1024];
    int read;
    while ((read = bis.read(buffer)) != -1) {
      tarOut.write(buffer, 0, read);
    }
    bis.close();
    tarOut.closeArchiveEntry();
  }

  private InputStream openInputStreamFromUri(Context context, Uri uri) throws IOException {
    if ("file".equalsIgnoreCase(uri.getScheme())) {
      return new FileInputStream(uri.getPath());
    } else if ("content".equalsIgnoreCase(uri.getScheme())) {
      return context.getContentResolver().openInputStream(uri);
    }
    throw new IllegalArgumentException("Unsupported URI scheme: " + uri.getScheme());
  }


  @PluginMethod
  public void unzipFiles(PluginCall call) {

    try {
      String outPath = call.getString("outPath");

      InputStream fis = openInputStreamFromUri(getContext(), Uri.parse(call.getString("zipPath")));
      BufferedInputStream bis = new BufferedInputStream(fis);
      TarArchiveInputStream tarIn = new TarArchiveInputStream(bis);

      TarArchiveEntry entry;
      while ((entry = (TarArchiveEntry) tarIn.getNextEntry()) != null) {
        File destPath = new File(outPath, entry.getName());
        if (entry.isDirectory()) {
          destPath.mkdirs();
        } else {
          destPath.getParentFile().mkdirs();
          OutputStream out = new FileOutputStream(destPath);
          byte[] buffer = new byte[1024];
          int length;
          while ((length = tarIn.read(buffer)) != -1) {
            out.write(buffer, 0, length);
          }
          out.close();
        }
      }
      tarIn.close();
      call.resolve();
    } catch (IOException e) {
      call.reject("Failed to unzip files", e);
    }
  }

  // 다운로드한 파일을 MediaStore에 등록한다. targetSdk 34 + 모든 파일 접근 환경에서
  // Filesystem.copy는 디스크에 직접 쓰기만 하고 MediaStore에 등록하지 않아 갤러리/파일앱에
  // 노출되지 않는다. 명시적 미디어스캔으로 이미지로 등록해 노출시킨다.
  @PluginMethod
  public void scanMedia(PluginCall call) {
    String path = call.getString("path");
    String mime = call.getString("mime", "image/png");
    if (path == null) {
      call.reject("path must be provided");
      return;
    }
    try {
      MediaScannerConnection.scanFile(
        getContext(),
        new String[]{ path },
        new String[]{ mime },
        (scannedPath, uri) -> {
          JSObject ret = new JSObject();
          ret.put("path", scannedPath);
          ret.put("uri", uri != null ? uri.toString() : null);
          call.resolve(ret);
        }
      );
    } catch (Exception e) {
      call.reject("Failed to scan media", e);
    }
  }

  @PluginMethod
  public void showDownloads(PluginCall call) {
    Intent intent=new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS);
    try {
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("Failed to donwloads folder", e);
    }
  }

  @PluginMethod
  public void showFileInFolder(PluginCall call) {
    String filePath = call.getString("filePath");
    if (filePath == null) {
      call.reject("File path must be provided");
      return;
    }

    File file = new File(filePath);
    if (!file.exists()) {
      call.reject("File does not exist");
      return;
    }

    Uri fileUri;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      String authority = getContext().getPackageName() + ".fileprovider";
      fileUri = FileProvider.getUriForFile(getContext(), authority, file);
    } else {
      fileUri = Uri.fromFile(file);
    }

    Intent intent = new Intent(Intent.ACTION_VIEW);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      intent.setDataAndType(fileUri, DocumentsContract.Document.MIME_TYPE_DIR);
    } else {
      intent.setDataAndType(fileUri, "resource/folder");
    }
    intent.putExtra("org.openintents.extra.ABSOLUTE_PATH", filePath);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);


    try {
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      call.reject("Failed to show file in folder", e);
    }
  }
}
