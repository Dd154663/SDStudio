package io.sunho.SDStudio

// Google 드라이브 연동 — Android 네이티브 플러그인 (드라이브 API ④, 2026-10-01)
//
// PC(src/main/googleDrive)와 같은 동작 계약을 Kotlin 으로 옮긴 것이다. 규칙의 원본은
// src/main/googleDrive/driveApi.ts(폴더 표식·appProperties·resumable 청크·응답 분류·백오프·목록·받기·휴지통).
//
// - 인증: Google Identity Services AuthorizationClient(play-services-auth). 범위는 drive.file 하나.
//   access token(1시간)은 이 프로세스 메모리에만 두고 JS 로 보내지 않는다. 만료 추정 55분 또는 401 이면
//   clearToken 뒤 조용한 authorize 로 다시 받는다(이미 허용한 계정은 화면 없이 재발급).
//   refresh token 같은 영속 토큰은 없다 — SharedPreferences(앱 내부 저장소, 데이터 루트 아님)에는
//   연결 여부·계정 이메일·연결 시각만 둔다.
// - Drive 작업: OkHttp(백그라운드 스레드). 올리기는 8 MiB 청크 resumable(파일 구간을 직접 읽어 보냄 —
//   전체를 메모리에 올리지 않음), 받기는 스트리밍 → .part → rename. 401 은 토큰을 버리고 1회 재시도,
//   429·5xx·403(요청 한도)은 지수 백오프(PC 와 같은 1·2·4·8·16s+지터, 최대 32s·5회).
// - 삭제는 files.update {trashed:true}(드라이브 휴지통)만 한다. files.delete(영구 삭제)는 호출하지 않는다.
// - NovelAI 토큰 파일(kind 'token' 또는 파일명 sdstudio-token-…)은 올리지 않고, 앱 안으로 받지 않는다
//   (renderer 의 목적지 제외·라우팅 거부와 2중 방벽).
// - 오류는 PC 와 같은 코드 문자열(src/shared/googleDrive.ts·googleDriveAuth.ts)로 reject 하고,
//   짧은 참고값은 data.detail 에 넣는다. 토큰 값은 로그·오류 어디에도 넣지 않는다.

import android.accounts.Account
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.auth.api.identity.AuthorizationClient
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.RevokeAccessRequest
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import okhttp3.Call
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference

@CapacitorPlugin(name = "GoogleDrive")
class GoogleDrivePlugin : Plugin() {

  companion object {
    private const val TAG = "GoogleDrive"

    const val SCOPE_DRIVE_FILE = "https://www.googleapis.com/auth/drive.file"
    const val DRIVE_API = "https://www.googleapis.com/drive/v3"
    const val DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
    const val FOLDER_MIME = "application/vnd.google-apps.folder"
    const val FOLDER_NAME = "SDStudio"
    const val PROP_KEY = "sdstudio"
    const val PROP_ROOT = "root"
    const val PROP_BACKUP = "backup"
    const val UPLOADED_FILE_FIELDS = "id,name,size,webViewLink"
    const val ROOT_FOLDER_FIELDS = "id,trashed,webViewLink"
    const val BACKUP_LIST_FIELDS =
      "nextPageToken,files(id,name,size,modifiedTime,appProperties,webViewLink)"
    const val DRIVE_WEB_PREFIX = "https://drive.google.com/"
    const val TOKEN_FILE_PREFIX = "sdstudio-token-"

    const val CHUNK_UNIT = 256 * 1024L
    const val UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024L // 256 KiB × 32
    const val MAX_BACKOFF_RETRIES = 5
    const val JSON_NETWORK_RETRIES = 2
    const val DOWNLOAD_MAX_RETRIES = 3
    const val PROGRESS_STEP = 1024 * 1024L
    const val BACKUP_LIST_PAGE_SIZE = 100
    const val MAX_LIST_PAGES = 50
    const val APP_PROPERTY_MAX_BYTES = 124
    const val APP_PROPERTY_MAX_COUNT = 30

    // access token 은 1시간 — 만료 5분 전으로 잡는다(그 사이 401 이면 즉시 다시 받는다).
    const val TOKEN_TTL_MS = 55 * 60 * 1000L
    const val AUTH_TASK_TIMEOUT_MS = 30 * 1000L
    const val REVOKE_TIMEOUT_MS = 20 * 1000L

    const val PREFS_NAME = "sdstudio_google_drive"
    const val PREF_CONNECTED = "connected"
    const val PREF_EMAIL = "email"
    const val PREF_ACCOUNT = "account"
    const val PREF_CONNECTED_AT = "connectedAt"

    private val QUOTA_REASONS = setOf("storageQuotaExceeded", "quotaExceeded", "teamDriveFileLimitExceeded")
    private val RATE_LIMIT_REASONS =
      setOf("rateLimitExceeded", "userRateLimitExceeded", "backendError", "RESOURCE_EXHAUSTED")

    // 세션 URI 에 대한 PUT 에서 driveRequest 가 스스로 재시도하지 않고 돌려줄 상태(재개는 uploadChunks 가 한다).
    private val SESSION_PASS_STATUSES = setOf(403, 404, 410, 429, 500, 502, 503, 504)

    private val FILE_ID_RE = Regex("^[A-Za-z0-9_-]{1,200}$")
    private val WINDOWS_RESERVED = Regex("^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\\..*)?$", RegexOption.IGNORE_CASE)
    private const val MAX_LOCAL_NAME = 150
  }

  // ─── 오류 ───

  class DriveError(val code: String, val detail: String? = null) : Exception(code)

  // 올리는 도중 원본 파일이 잘렸을 때(네트워크 끊김과 구분).
  private class FileChangedException : IOException("size changed")

  // 취소 가능한 작업 하나(올리기·받기). 진행 중 요청을 끊고 대기도 깨운다.
  private class Op {
    @Volatile var cancelled = false
    private val current = AtomicReference<Call?>(null)

    fun attach(call: Call) {
      current.set(call)
      if (cancelled) call.cancel()
    }

    fun detach() {
      current.set(null)
    }

    fun cancel() {
      cancelled = true
      current.get()?.cancel()
    }

    fun check() {
      if (cancelled) throw DriveError("cancelled")
    }

    fun sleep(ms: Long) {
      var left = ms
      while (left > 0) {
        check()
        val step = minOf(left, 100L)
        Thread.sleep(step)
        left -= step
      }
      check()
    }
  }

  private class HttpResult(val status: Int, val bodyText: String, val headers: Headers) {
    fun json(): JSONObject? = parseJson(bodyText)
    fun header(name: String): String? = headers[name]
  }

  private class FolderInfo(val id: String, val webViewLink: String?)

  private sealed class Cls {
    object Ok : Cls()
    object Incomplete : Cls()
    object Auth : Cls()
    class Backoff(val code: String, val detail: String) : Cls()
    class Fail(val code: String, val detail: String) : Cls()
  }

  // ─── 상태 ───

  private val executor = Executors.newCachedThreadPool()
  private val mainHandler = Handler(Looper.getMainLooper())

  // 우리가 직접 재시도·재개하므로 OkHttp 의 연결 실패 자동 재시도는 끈다.
  private val jsonClient: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(20, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .writeTimeout(30, TimeUnit.SECONDS)
    .retryOnConnectionFailure(false)
    .build()

  // 청크 PUT 한 번(8 MiB)이 느린 회선에서도 끝날 여유(PC CHUNK_TIMEOUT_MS = 5분).
  private val uploadClient: OkHttpClient = jsonClient.newBuilder()
    .writeTimeout(5, TimeUnit.MINUTES)
    .readTimeout(5, TimeUnit.MINUTES)
    .build()

  // 받는 도중 60초 동안 한 바이트도 오지 않으면 끊긴 것으로 본다(PC DOWNLOAD_IDLE_TIMEOUT_MS).
  private val downloadClient: OkHttpClient = jsonClient.newBuilder()
    .readTimeout(60, TimeUnit.SECONDS)
    .build()

  private val tokenLock = Any()
  @Volatile private var cachedToken: String? = null
  @Volatile private var tokenExpiresAt = 0L

  private val folderLock = Any()
  @Volatile private var rootFolder: FolderInfo? = null

  private val opLock = Any()
  private var uploadOp: Op? = null
  private var downloadOp: Op? = null

  @Volatile private var pendingConnect: PluginCall? = null
  private var authLauncher: ActivityResultLauncher<IntentSenderRequest>? = null

  override fun load() {
    // 동의 화면(PendingIntent)을 띄우고 결과를 받는 창구. 액티비티 onCreate 중(플러그인 로드 시점)에
    // 등록해야 한다(ActivityResult API 규칙).
    try {
      authLauncher = bridge.registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult()
      ) { result -> onAuthActivityResult(result) }
    } catch (e: Exception) {
      Log.w(TAG, "authorization launcher 등록 실패: ${e.javaClass.simpleName}")
    }
  }

  private fun prefs(): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun isConnectedPref(): Boolean = prefs().getBoolean(PREF_CONNECTED, false)

  private fun authClient(): AuthorizationClient = Identity.getAuthorizationClient(context)

  private fun scopes(): List<Scope> = listOf(Scope(SCOPE_DRIVE_FILE))

  private fun accountName(): String? {
    val p = prefs()
    val a = p.getString(PREF_ACCOUNT, null)
    if (!a.isNullOrBlank()) return a
    val e = p.getString(PREF_EMAIL, null)
    return if (e.isNullOrBlank()) null else e
  }

  private fun authRequest(account: String?): AuthorizationRequest {
    val b = AuthorizationRequest.builder().setRequestedScopes(scopes())
    if (!account.isNullOrBlank()) b.setAccount(Account(account, "com.google"))
    return b.build()
  }

  private fun nowIso(): String {
    val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    f.timeZone = TimeZone.getTimeZone("UTC")
    return f.format(Date())
  }

  // ─── 응답·요청 규칙 (driveApi.ts 와 동일) ───

  private fun reject(call: PluginCall, e: Throwable) {
    val err = if (e is DriveError) e else {
      Log.w(TAG, "예상 밖 오류: ${e.javaClass.simpleName}")
      DriveError("unknown")
    }
    if (err.code != "cancelled") Log.w(TAG, "실패 ${err.code} ${err.detail ?: ""}")
    val data = JSObject()
    err.detail?.let { data.put("detail", it.take(120)) }
    call.reject(err.code, err.code, data)
  }

  private fun driveErrorReason(body: JSONObject?): String? {
    val err = body?.optJSONObject("error") ?: return null
    val first = err.optJSONArray("errors")?.optJSONObject(0)
    val reason = first?.optString("reason", "") ?: ""
    if (reason.isNotEmpty()) return reason.take(60)
    val status = err.optString("status", "")
    return if (status.isNotEmpty()) status.take(60) else null
  }

  private fun classify(status: Int, body: JSONObject?, failCode: String): Cls {
    if (status in 200..299) return Cls.Ok
    if (status == 308) return Cls.Incomplete
    val reason = driveErrorReason(body)
    val detail = if (reason != null) "HTTP $status $reason" else "HTTP $status"
    if (status == 401) return Cls.Auth
    if (status == 429) return Cls.Backoff("rate-limited", detail)
    if (status == 403) {
      if (reason != null && QUOTA_REASONS.contains(reason)) return Cls.Fail("quota-exceeded", detail)
      if (reason != null && RATE_LIMIT_REASONS.contains(reason)) return Cls.Backoff("rate-limited", detail)
      return Cls.Fail(failCode, detail)
    }
    if (status >= 500) return Cls.Backoff("server", detail)
    return Cls.Fail(failCode, detail)
  }

  // 1s·2s·4s·8s·16s(+0~1s 무작위), 최대 32s. attempt 는 0부터.
  private fun backoffDelayMs(attempt: Int): Long {
    val base = minOf(1000L shl minOf(maxOf(0, attempt), 5), 32_000L)
    val jitter = (Math.random() * 1000).toLong()
    return minOf(base + jitter, 32_000L)
  }

  private fun escapeQueryValue(v: String): String = v.replace("\\", "\\\\").replace("'", "\\'")

  private fun rootFolderQuery(): String =
    "mimeType='$FOLDER_MIME' and trashed=false and " +
      "appProperties has { key='$PROP_KEY' and value='$PROP_ROOT' }"

  private fun rootFolderNameQuery(): String =
    "mimeType='$FOLDER_MIME' and trashed=false and " +
      "name='${escapeQueryValue(FOLDER_NAME)}' and 'root' in parents"

  private fun filesUrl(): HttpUrl.Builder = "$DRIVE_API/files".toHttpUrl().newBuilder()

  private fun filesListUrl(q: String): String = filesUrl()
    .addQueryParameter("q", q)
    .addQueryParameter("spaces", "drive")
    .addQueryParameter("pageSize", "10")
    .addQueryParameter("orderBy", "createdTime")
    .addQueryParameter("fields", "files(id,name,webViewLink)")
    .build().toString()

  private fun fileGetUrl(fileId: String, fields: String): String = filesUrl()
    .addPathSegment(fileId)
    .addQueryParameter("fields", fields)
    .build().toString()

  private fun backupListUrl(rootId: String, pageToken: String?): String {
    val q = "'${escapeQueryValue(rootId)}' in parents and trashed=false and mimeType != '$FOLDER_MIME'"
    val b = filesUrl()
      .addQueryParameter("q", q)
      .addQueryParameter("spaces", "drive")
      .addQueryParameter("pageSize", BACKUP_LIST_PAGE_SIZE.toString())
      .addQueryParameter("orderBy", "modifiedTime desc")
      .addQueryParameter("fields", BACKUP_LIST_FIELDS)
    if (!pageToken.isNullOrEmpty()) b.addQueryParameter("pageToken", pageToken)
    return b.build().toString()
  }

  private fun aboutUrl(): String = "$DRIVE_API/about".toHttpUrl().newBuilder()
    .addQueryParameter("fields", "user(emailAddress),storageQuota")
    .build().toString()

  private fun utf8Len(s: String): Int = s.toByteArray(Charsets.UTF_8).size

  // 키+값이 124바이트를 넘지 않게 값을 자른다(코드 포인트 중간에서 자르지 않음).
  private fun truncateAppPropertyValue(key: String, value: String): String {
    val budget = APP_PROPERTY_MAX_BYTES - utf8Len(key)
    if (budget <= 0) return ""
    if (utf8Len(value) <= budget) return value
    val sb = StringBuilder()
    var used = 0
    var i = 0
    while (i < value.length) {
      val cp = value.codePointAt(i)
      val ch = String(Character.toChars(cp))
      val b = utf8Len(ch)
      if (used + b > budget) break
      sb.append(ch)
      used += b
      i += Character.charCount(cp)
    }
    return sb.toString()
  }

  private fun buildAppProperties(props: List<Pair<String, String?>>): JSONObject {
    val out = JSONObject()
    var count = 0
    for ((key, raw) in props) {
      if (count >= APP_PROPERTY_MAX_COUNT) break
      if (raw == null) continue
      val value = truncateAppPropertyValue(key, raw.trim())
      if (value.isEmpty()) continue
      out.put(key, value)
      count++
    }
    return out
  }

  private fun uploadMimeType(fileName: String): String {
    val lower = fileName.lowercase(Locale.ROOT)
    return when {
      lower.endsWith(".tar") -> "application/x-tar"
      lower.endsWith(".json") -> "application/json"
      lower.endsWith(".zip") -> "application/zip"
      else -> "application/octet-stream"
    }
  }

  // 308 응답의 Range("bytes=0-524287") → 다음 위치. 없으면 0, 해석 불가면 null.
  private fun nextOffsetFromRange(range: String?): Long? {
    if (range == null || range.isBlank()) return 0L
    val m = Regex("^\\s*bytes\\s*=\\s*(\\d+)\\s*-\\s*(\\d+)\\s*$", RegexOption.IGNORE_CASE).find(range)
      ?: return null
    val start = m.groupValues[1].toLongOrNull() ?: return null
    val end = m.groupValues[2].toLongOrNull() ?: return null
    if (start != 0L || end < start) return null
    return end + 1
  }

  private fun isTokenName(name: String?): Boolean {
    if (name == null) return false
    val base = name.replace('\\', '/').substringAfterLast('/')
    return base.lowercase(Locale.ROOT).startsWith(TOKEN_FILE_PREFIX)
  }

  private fun isTokenExport(kind: String?, fileName: String?): Boolean =
    kind == "token" || isTokenName(fileName)

  private fun parseFolder(body: JSONObject?): FolderInfo? {
    val id = body?.optString("id", "") ?: ""
    if (id.isEmpty()) return null
    val link = body?.optString("webViewLink", "") ?: ""
    return FolderInfo(id, if (link.isEmpty()) null else link)
  }

  private fun parseUploadedFile(body: JSONObject?): JSObject? {
    val id = body?.optString("id", "") ?: ""
    if (id.isEmpty()) return null
    val out = JSObject()
    out.put("id", id)
    out.put("name", body!!.optString("name", ""))
    sizeOf(body.opt("size"))?.let { out.put("size", it) }
    val link = body.optString("webViewLink", "")
    if (link.isNotEmpty()) out.put("webViewLink", link)
    return out
  }

  private fun sizeOf(raw: Any?): Long? {
    val n = when (raw) {
      is Number -> raw.toLong()
      is String -> raw.trim().toLongOrNull()
      else -> null
    }
    return if (n != null && n >= 0) n else null
  }

  private fun optionalString(v: Any?, max: Int): String? {
    if (v !is String) return null
    val t = v.trim()
    return if (t.isEmpty()) null else t.take(max)
  }

  // files.list 항목 → DriveBackupItem 형태(PC parseBackupItem 과 같은 규칙). id 없으면 null.
  private fun parseBackupItem(f: JSONObject, kinds: Set<String>): JSObject? {
    val id = f.optString("id", "")
    if (id.isEmpty()) return null
    val props = f.optJSONObject("appProperties") ?: JSONObject()
    val out = JSObject()
    out.put("id", id)
    out.put("name", f.optString("name", ""))
    sizeOf(f.opt("size"))?.let { out.put("size", it) }
    val modified = f.optString("modifiedTime", "")
    if (Regex("^\\d{4}-\\d{2}-\\d{2}T").containsMatchIn(modified)) out.put("modifiedTime", modified)
    val kind = props.optString("kind", "")
    out.put("kind", if (kinds.contains(kind)) kind else "unknown")
    optionalString(props.opt("device"), 200)?.let { out.put("device", it) }
    optionalString(props.opt("appVersion"), 40)?.let { out.put("appVersion", it) }
    val link = f.optString("webViewLink", "")
    if (link.isNotEmpty()) out.put("webViewLink", link)
    return out
  }

  // 드라이브 파일 이름 → 로컬 파일 이름(PC sanitizeDownloadName 과 같은 규칙).
  private fun sanitizeDownloadName(name: String?, fallback: String): String {
    var s = (name ?: "").replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").trim()
    s = s.replace(Regex("[. ]+$"), "")
    if (s.isEmpty() || Regex("^_*$").matches(s.replace(".", ""))) return fallback
    if (WINDOWS_RESERVED.matches(s)) s = "_$s"
    if (s.length > MAX_LOCAL_NAME) {
      val dot = s.lastIndexOf('.')
      val ext = if (dot > 0) s.substring(dot) else ""
      val keepExt = if (ext.isNotEmpty() && ext.length <= 12) ext else ""
      s = s.substring(0, MAX_LOCAL_NAME - keepExt.length) + keepExt
    }
    return s
  }

  // renderer 가 넘긴 데이터 루트(Filesystem.getUri 의 file:// URI) → File.
  private fun appDirFrom(call: PluginCall): File {
    val raw = call.getString("appDir") ?: throw DriveError("invalid-path", "appDir")
    val path = (if (raw.startsWith("/")) raw else Uri.parse(raw).path)
      ?: throw DriveError("invalid-path", "appDir")
    return File(path)
  }

  // 'exports/…' 상대 경로 → 데이터 루트 안의 절대 파일(publish-export·PC resolveExportsSource 와 같은 규칙).
  private fun resolveExportsSource(appDir: File, arg: String?): File? {
    if (arg == null) return null
    val normalized = arg.replace('\\', '/').trimStart('/')
    if (!normalized.startsWith("exports/") || normalized.contains("../")) return null
    return try {
      val exportRoot = File(appDir, "exports").canonicalFile
      val source = File(appDir, normalized).canonicalFile
      if (source.path.startsWith(exportRoot.path + File.separator)) source else null
    } catch (e: IOException) {
      null
    }
  }

  private fun deviceName(): String {
    try {
      if (Build.VERSION.SDK_INT >= 25) {
        val n = Settings.Global.getString(context.contentResolver, "device_name")
        if (!n.isNullOrBlank()) return n
      }
    } catch (e: Exception) {
      /* 기기 이름을 못 읽으면 모델명 */
    }
    val parts = listOf(Build.MANUFACTURER, Build.MODEL).filter { !it.isNullOrBlank() }
    return if (parts.isEmpty()) "Android" else parts.joinToString(" ")
  }

  // ─── 인증 토큰 ───

  private fun <T> awaitTask(task: Task<T>, timeoutMs: Long): T {
    try {
      return Tasks.await(task, timeoutMs, TimeUnit.MILLISECONDS)
    } catch (e: ExecutionException) {
      val cause = e.cause
      if (cause is ApiException) throw apiError(cause)
      throw DriveError("exchange-failed", cause?.javaClass?.simpleName)
    } catch (e: TimeoutException) {
      throw DriveError("network", "auth timeout")
    } catch (e: InterruptedException) {
      throw DriveError("cancelled")
    }
  }

  private fun apiError(e: ApiException): DriveError = when (e.statusCode) {
    CommonStatusCodes.NETWORK_ERROR, CommonStatusCodes.TIMEOUT -> DriveError("network", "ApiException ${e.statusCode}")
    CommonStatusCodes.CANCELED -> DriveError("cancelled", "ApiException ${e.statusCode}")
    CommonStatusCodes.SIGN_IN_REQUIRED -> DriveError("expired", "ApiException ${e.statusCode}")
    else -> DriveError("exchange-failed", "ApiException ${e.statusCode}")
  }

  // Drive 호출용 access token(메모리만). 미연결 = not-connected, 다시 승인이 필요 = expired(연결 해제).
  // 백그라운드 스레드에서만 부른다(Tasks.await).
  private fun accessToken(): String {
    if (!isConnectedPref()) throw DriveError("not-connected")
    val now = System.currentTimeMillis()
    cachedToken?.let { if (now < tokenExpiresAt) return it }
    synchronized(tokenLock) {
      val again = cachedToken
      if (again != null && System.currentTimeMillis() < tokenExpiresAt) return again
      val result: AuthorizationResult = try {
        awaitTask(authClient().authorize(authRequest(accountName())), AUTH_TASK_TIMEOUT_MS)
      } catch (e: DriveError) {
        if (e.code == "expired") onAuthExpired()
        throw e
      }
      if (result.hasResolution()) {
        // 사용자가 Google 계정에서 권한을 해제했거나 계정이 기기에서 빠졌다 — PC 의 invalid_grant 와 같게 처리.
        onAuthExpired()
        throw DriveError("expired", "resolution required")
      }
      val token = result.accessToken ?: throw DriveError("exchange-failed", "no token")
      cachedToken = token
      tokenExpiresAt = System.currentTimeMillis() + TOKEN_TTL_MS
      return token
    }
  }

  // 401 을 받은 토큰을 버린다. Play 서비스 캐시에서도 지워야 다음 authorize 가 새 토큰을 준다.
  private fun invalidateToken(used: String) {
    synchronized(tokenLock) {
      if (cachedToken == used) {
        cachedToken = null
        tokenExpiresAt = 0L
      }
    }
    try {
      awaitTask(authClient().clearToken(ClearTokenRequest.builder().setToken(used).build()), AUTH_TASK_TIMEOUT_MS)
    } catch (e: Exception) {
      /* 지우기 실패는 무시 — 다음 authorize 결과로 판단 */
    }
  }

  private fun clearLocalSession() {
    prefs().edit().clear().apply()
    synchronized(tokenLock) {
      cachedToken = null
      tokenExpiresAt = 0L
    }
    rootFolder = null
  }

  private fun onAuthExpired() {
    Log.w(TAG, "Google 권한이 해제되어 연결을 해제합니다")
    clearLocalSession()
    val s = JSObject()
    s.put("connected", false)
    s.put("authError", "expired")
    notifyListeners("driveAuthChanged", s)
  }

  // ─── HTTP ───

  private fun jsonBody(o: JSONObject): RequestBody =
    o.toString().toRequestBody("application/json; charset=UTF-8".toMediaTypeOrNull())

  private fun execute(client: OkHttpClient, req: Request, op: Op): HttpResult {
    op.check()
    val call = client.newCall(req)
    op.attach(call)
    try {
      call.execute().use { resp ->
        val text = try {
          resp.body?.string() ?: ""
        } catch (e: IOException) {
          if (op.cancelled) throw DriveError("cancelled")
          throw DriveError("network", e.javaClass.simpleName)
        }
        return HttpResult(resp.code, text, resp.headers)
      }
    } catch (e: FileChangedException) {
      throw DriveError("file-missing", "size changed")
    } catch (e: IOException) {
      if (op.cancelled) throw DriveError("cancelled")
      throw DriveError("network", e.javaClass.simpleName)
    } finally {
      op.detach()
    }
  }

  // 인증·재시도를 붙인 요청(PC upload.ts driveRequest 와 같은 규칙).
  private fun driveRequest(
    url: String,
    method: String,
    body: RequestBody?,
    op: Op,
    headers: Map<String, String> = emptyMap(),
    failCode: String = "upload-failed",
    passStatuses: Set<Int> = emptySet(),
    networkRetries: Int = JSON_NETWORK_RETRIES,
    client: OkHttpClient = jsonClient,
  ): HttpResult {
    var attempt = 0
    var authRetried = false
    while (true) {
      op.check()
      val token = accessToken()
      val b = Request.Builder().url(url).header("Authorization", "Bearer $token")
      for ((k, v) in headers) b.header(k, v)
      b.method(method, body)
      val r = try {
        execute(client, b.build(), op)
      } catch (e: DriveError) {
        if (e.code == "network" && attempt < networkRetries) {
          op.sleep(backoffDelayMs(attempt++))
          continue
        }
        throw e
      }
      if (passStatuses.contains(r.status)) return r
      when (val c = classify(r.status, r.json(), failCode)) {
        is Cls.Ok, is Cls.Incomplete -> return r
        is Cls.Auth -> {
          if (!authRetried) {
            authRetried = true
            invalidateToken(token)
            continue
          }
          throw DriveError("expired", "HTTP 401")
        }
        is Cls.Backoff -> {
          if (attempt < MAX_BACKOFF_RETRIES) {
            op.sleep(backoffDelayMs(attempt++))
            continue
          }
          throw DriveError(c.code, c.detail)
        }
        is Cls.Fail -> throw DriveError(c.code, c.detail)
      }
    }
  }

  // ─── SDStudio 폴더 ───

  private fun findFolder(q: String, op: Op): FolderInfo? {
    val r = driveRequest(filesListUrl(q), "GET", null, op)
    val files = r.json()?.optJSONArray("files") ?: return null
    for (i in 0 until files.length()) {
      val info = parseFolder(files.optJSONObject(i))
      if (info != null) return info
    }
    return null
  }

  // 표식 → 이름 폴백 → (create 면) 표식 달아 생성. 메모리 캐시는 매번 files.get 으로 확인한다.
  private fun resolveRootFolder(op: Op, create: Boolean): FolderInfo? {
    synchronized(folderLock) {
      return resolveRootFolderLocked(op, create)
    }
  }

  private fun resolveRootFolderLocked(op: Op, create: Boolean): FolderInfo? {
    val cached = rootFolder
    if (cached != null) {
      val r = driveRequest(fileGetUrl(cached.id, ROOT_FOLDER_FIELDS), "GET", null, op, passStatuses = setOf(404))
      val j = r.json()
      if (r.status != 404 && j != null && j.optString("id", "").isNotEmpty() && !j.optBoolean("trashed", false)) {
        val link = j.optString("webViewLink", "").ifEmpty { cached.webViewLink ?: "" }
        val info = FolderInfo(cached.id, if (link.isEmpty()) null else link)
        rootFolder = info
        return info
      }
      rootFolder = null
    }
    var info = findFolder(rootFolderQuery(), op) ?: findFolder(rootFolderNameQuery(), op)
    if (info == null) {
      // 목록·휴지통은 폴더를 만들지 않는다.
      if (!create) return null
      val body = JSONObject()
        .put("name", FOLDER_NAME)
        .put("mimeType", FOLDER_MIME)
        .put("appProperties", JSONObject().put(PROP_KEY, PROP_ROOT))
      val url = filesUrl().addQueryParameter("fields", "id,name,webViewLink").build().toString()
      val r = driveRequest(url, "POST", jsonBody(body), op)
      info = parseFolder(r.json()) ?: throw DriveError("server", "folder id")
      Log.i(TAG, "SDStudio 폴더를 만들었습니다")
    }
    rootFolder = info
    return info
  }

  // ─── 인증 메서드 ───

  @PluginMethod
  fun isAvailable(call: PluginCall) {
    val ret = JSObject()
    val ok = try {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    } catch (e: Exception) {
      false
    }
    ret.put("available", ok)
    call.resolve(ret)
  }

  // 연결 여부만(네트워크 없음) — 내보내기 목적지·출처 결정용.
  @PluginMethod
  fun connected(call: PluginCall) {
    val ret = JSObject()
    ret.put("connected", isConnectedPref())
    call.resolve(ret)
  }

  private fun statusObject(quota: JSObject?, infoError: String?): JSObject {
    val p = prefs()
    val s = JSObject()
    val connected = p.getBoolean(PREF_CONNECTED, false)
    s.put("connected", connected)
    if (connected) {
      p.getString(PREF_EMAIL, null)?.let { if (it.isNotBlank()) s.put("email", it) }
      p.getString(PREF_CONNECTED_AT, null)?.let { if (it.isNotBlank()) s.put("connectedAt", it) }
      if (quota != null) s.put("quota", quota)
      if (infoError != null) s.put("infoError", infoError)
    }
    return s
  }

  // about.get 으로 이메일·용량. 이메일이 바뀌면 prefs 갱신. 실패는 DriveError.
  private fun parseAbout(body: JSONObject?): Pair<String?, JSObject?> {
    val email = body?.optJSONObject("user")?.optString("emailAddress", "")?.ifEmpty { null }
    val sq = body?.optJSONObject("storageQuota")
    var quota: JSObject? = null
    if (sq != null) {
      val limit = sizeOf(sq.opt("limit"))
      val usage = sizeOf(sq.opt("usage"))
      if (limit != null || usage != null) {
        val q = JSObject()
        if (limit != null) q.put("limit", limit)
        if (usage != null) q.put("usage", usage)
        quota = q
      }
    }
    return Pair(email, quota)
  }

  @PluginMethod
  fun status(call: PluginCall) {
    executor.execute {
      if (!isConnectedPref() || pendingConnect != null) {
        call.resolve(statusObject(null, null))
        return@execute
      }
      try {
        val r = driveRequest(aboutUrl(), "GET", null, Op(), failCode = "server")
        val (email, quota) = parseAbout(r.json())
        if (email != null && isConnectedPref()) prefs().edit().putString(PREF_EMAIL, email).apply()
        call.resolve(statusObject(quota, null))
      } catch (e: DriveError) {
        if (e.code == "expired" || e.code == "not-connected" || !isConnectedPref()) {
          val s = statusObject(null, null)
          if (e.code == "expired") s.put("authError", "expired")
          call.resolve(s)
        } else {
          call.resolve(statusObject(null, e.code))
        }
      } catch (e: Exception) {
        call.resolve(statusObject(null, "unknown"))
      }
    }
  }

  @PluginMethod
  fun connect(call: PluginCall) {
    if (pendingConnect != null) return reject(call, DriveError("busy"))
    if (isConnectedPref()) return reject(call, DriveError("already-connected"))
    pendingConnect = call
    mainHandler.post {
      try {
        // 계정을 지정하지 않는다 → 계정이 여럿이면 Google 이 선택 화면을 띄운다.
        authClient().authorize(authRequest(null))
          .addOnSuccessListener { result -> handleInteractiveResult(result) }
          .addOnFailureListener { e ->
            finishConnectError(if (e is ApiException) apiError(e) else DriveError("exchange-failed", e.javaClass.simpleName))
          }
      } catch (e: Exception) {
        finishConnectError(DriveError("unknown", e.javaClass.simpleName))
      }
    }
  }

  private fun handleInteractiveResult(result: AuthorizationResult) {
    if (pendingConnect == null) return
    if (result.hasResolution()) {
      val pi = result.pendingIntent ?: return finishConnectError(DriveError("exchange-failed", "no intent"))
      val launcher = authLauncher ?: return finishConnectError(DriveError("unknown", "launcher"))
      try {
        launcher.launch(IntentSenderRequest.Builder(pi.intentSender).build())
      } catch (e: Exception) {
        finishConnectError(DriveError("unknown", "launch"))
      }
      return
    }
    val token = result.accessToken ?: return finishConnectError(DriveError("exchange-failed", "no token"))
    completeConnect(token, accountFromResult(result))
  }

  @Suppress("DEPRECATION")
  private fun accountFromResult(result: AuthorizationResult): String? = try {
    result.toGoogleSignInAccount()?.email?.ifBlank { null }
  } catch (e: Exception) {
    null
  }

  private fun onAuthActivityResult(res: ActivityResult) {
    if (pendingConnect == null) return
    if (res.resultCode != Activity.RESULT_OK) {
      // 계정 선택·동의 화면에서 뒤로 가기·거부.
      finishConnectError(DriveError("cancelled"))
      return
    }
    try {
      val result = authClient().getAuthorizationResultFromIntent(res.data)
      val token = result.accessToken ?: throw DriveError("exchange-failed", "no token")
      completeConnect(token, accountFromResult(result))
    } catch (e: ApiException) {
      finishConnectError(apiError(e).let { if (it.code == "exchange-failed") DriveError("denied", it.detail) else it })
    } catch (e: DriveError) {
      finishConnectError(e)
    } catch (e: Exception) {
      finishConnectError(DriveError("unknown", e.javaClass.simpleName))
    }
  }

  private fun finishConnectError(err: DriveError) {
    val call = pendingConnect ?: return
    pendingConnect = null
    reject(call, err)
  }

  // 받은 토큰으로 이메일·용량을 조회(실패해도 연결은 유지 — PC 와 같음) → prefs 저장 → 상태.
  private fun completeConnect(token: String, account: String?) {
    executor.execute {
      val call = pendingConnect ?: return@execute
      var email: String? = null
      var quota: JSObject? = null
      var infoError: String? = null
      try {
        val req = Request.Builder().url(aboutUrl()).header("Authorization", "Bearer $token").get().build()
        val r = execute(jsonClient, req, Op())
        if (r.status in 200..299) {
          val parsed = parseAbout(r.json())
          email = parsed.first
          quota = parsed.second
        } else {
          infoError = "server"
        }
      } catch (e: DriveError) {
        infoError = e.code
      } catch (e: Exception) {
        infoError = "unknown"
      }
      val edit = prefs().edit().clear()
        .putBoolean(PREF_CONNECTED, true)
        .putString(PREF_CONNECTED_AT, nowIso())
      if (!email.isNullOrBlank()) edit.putString(PREF_EMAIL, email)
      val acc = account ?: email
      if (!acc.isNullOrBlank()) edit.putString(PREF_ACCOUNT, acc)
      edit.apply()
      synchronized(tokenLock) {
        cachedToken = token
        tokenExpiresAt = System.currentTimeMillis() + TOKEN_TTL_MS
      }
      rootFolder = null
      val s = statusObject(quota, infoError)
      pendingConnect = null
      call.resolve(s)
      notifyListeners("driveAuthChanged", s)
    }
  }

  // 연결 해제: 로컬(prefs·메모리)을 먼저 지우고 Google 권한 철회(실패해도 해제는 완료).
  @PluginMethod
  fun disconnect(call: PluginCall) {
    executor.execute {
      val account = accountName()
      val token = cachedToken
      clearLocalSession()
      val s = JSObject()
      s.put("connected", false)
      notifyListeners("driveAuthChanged", s)
      try {
        if (!account.isNullOrBlank()) {
          val req = RevokeAccessRequest.builder()
            .setAccount(Account(account, "com.google"))
            .setScopes(scopes())
            .build()
          awaitTask(authClient().revokeAccess(req), REVOKE_TIMEOUT_MS)
        } else if (token != null) {
          awaitTask(authClient().clearToken(ClearTokenRequest.builder().setToken(token).build()), REVOKE_TIMEOUT_MS)
        }
      } catch (e: Exception) {
        Log.w(TAG, "권한 철회 실패(로컬 해제는 완료): ${(e as? DriveError)?.code ?: e.javaClass.simpleName}")
      }
      call.resolve()
    }
  }

  // ─── 올리기 ───

  // 파일 구간 [start, start+length) 을 그대로 보내는 본문(메모리에 청크 전체를 올리지 않는다).
  private class FileSegmentBody(
    private val file: File,
    private val start: Long,
    private val length: Long,
    private val mediaType: MediaType?,
    private val onWritten: (Long) -> Unit,
  ) : RequestBody() {
    override fun contentType(): MediaType? = mediaType
    override fun contentLength(): Long = length
    override fun writeTo(sink: BufferedSink) {
      RandomAccessFile(file, "r").use { raf ->
        raf.seek(start)
        val buf = ByteArray(64 * 1024)
        var left = length
        var written = 0L
        while (left > 0) {
          val n = raf.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
          if (n < 0) throw FileChangedException()
          sink.write(buf, 0, n)
          left -= n
          written += n
          onWritten(written)
        }
      }
    }
  }

  private class ChunkPlan(val start: Long, val end: Long, val length: Long, val contentRange: String)

  private fun planChunk(offset: Long, total: Long): ChunkPlan {
    if (total <= 0) return ChunkPlan(0, -1, 0, "bytes */0")
    if (offset < 0 || offset >= total) throw DriveError("server", "offset")
    val length = minOf(UPLOAD_CHUNK_SIZE, total - offset)
    val end = offset + length - 1
    return ChunkPlan(offset, end, length, "bytes $offset-$end/$total")
  }

  private fun uploadChunks(
    sessionUri: String,
    file: File,
    total: Long,
    mime: String,
    op: Op,
    progress: (Long) -> Unit,
  ): JSObject {
    var offset = 0L
    var attempt = 0
    var needQuery = false
    progress(0L)

    fun waitOrThrow(err: DriveError) {
      if (attempt >= MAX_BACKOFF_RETRIES) throw err
      op.sleep(backoffDelayMs(attempt++))
      needQuery = true
    }

    while (true) {
      op.check()
      val plan = if (needQuery) null else planChunk(offset, total)
      val r: HttpResult = try {
        if (plan != null) {
          val body: RequestBody = if (plan.length > 0) {
            FileSegmentBody(file, plan.start, plan.length, mime.toMediaTypeOrNull()) { w -> progress(plan.start + w) }
          } else {
            ByteArray(0).toRequestBody(mime.toMediaTypeOrNull())
          }
          driveRequest(
            sessionUri, "PUT", body, op,
            headers = mapOf("Content-Range" to plan.contentRange),
            passStatuses = SESSION_PASS_STATUSES,
            networkRetries = 0,
            client = uploadClient,
          )
        } else {
          driveRequest(
            sessionUri, "PUT", ByteArray(0).toRequestBody(null), op,
            headers = mapOf("Content-Range" to "bytes */$total"),
            passStatuses = SESSION_PASS_STATUSES,
            networkRetries = 0,
          )
        }
      } catch (e: DriveError) {
        if (e.code == "network") {
          waitOrThrow(e)
          continue
        }
        throw e
      }

      when (r.status) {
        200, 201 -> {
          val f = parseUploadedFile(r.json()) ?: throw DriveError("server", "upload response")
          progress(total)
          return f
        }
        308 -> {
          val next = nextOffsetFromRange(r.header("Range")) ?: throw DriveError("server", "Range")
          if (next > total) throw DriveError("server", "Range")
          if (plan != null && next <= offset) {
            // 청크를 보냈는데 진전 없음 — 재시도 한도 안에서 위치를 다시 묻고 보낸다.
            waitOrThrow(DriveError("server", "no progress"))
            continue
          }
          if (next > offset) attempt = 0
          offset = next
          needQuery = false
          if (offset >= total && total > 0) {
            // 전부 받았다는데 완료 응답이 없었다 — 위치 질의로 완료 응답을 받는다.
            waitOrThrow(DriveError("server", "no completion"))
            continue
          }
          progress(offset)
        }
        404, 410 -> throw DriveError("upload-failed", "HTTP ${r.status} session expired")
        else -> {
          when (val c = classify(r.status, r.json(), "upload-failed")) {
            is Cls.Backoff -> {
              waitOrThrow(DriveError(c.code, c.detail))
              continue
            }
            is Cls.Fail -> throw DriveError(c.code, c.detail)
            else -> throw DriveError("server", "HTTP ${r.status}")
          }
        }
      }
    }
  }

  private fun doUpload(call: PluginCall, op: Op): JSObject {
    val kind = call.getString("kind")
    val exportsPath = call.getString("exportsPath")
    val requestedName = call.getString("name")
    // 토큰 방벽(네이티브 측) — 경로 해석보다 먼저.
    if (isTokenExport(kind, exportsPath) || isTokenName(requestedName)) throw DriveError("token-export-forbidden")
    if (kind.isNullOrEmpty()) throw DriveError("invalid-path", "kind")
    val appDir = appDirFrom(call)
    val source = resolveExportsSource(appDir, exportsPath) ?: throw DriveError("invalid-path")
    val cleanRequested = requestedName?.replace(Regex("[\\\\/]"), "_")?.trim()
    val name = if (!cleanRequested.isNullOrEmpty()) cleanRequested else source.name
    if (isTokenName(name)) throw DriveError("token-export-forbidden")
    if (!source.exists()) throw DriveError("file-missing")
    if (!source.isFile) throw DriveError("invalid-path", "not a file")
    val total = source.length()

    // 미연결이면 여기서 바로 not-connected.
    accessToken()
    op.check()
    val folder = resolveRootFolder(op, true) ?: throw DriveError("server", "folder id")
    val mime = uploadMimeType(name)
    val appVersion = call.getString("appVersion")?.ifBlank { null } ?: BuildConfig.VERSION_NAME
    val metadata = JSONObject()
      .put("name", name)
      .put("parents", JSONArray().put(folder.id))
      .put(
        "appProperties",
        buildAppProperties(
          listOf(
            PROP_KEY to PROP_BACKUP,
            "kind" to kind,
            "app" to "SDStudio",
            "appVersion" to appVersion,
            "device" to deviceName(),
          )
        )
      )

    val initUrl = DRIVE_UPLOAD.toHttpUrl().newBuilder()
      .addQueryParameter("uploadType", "resumable")
      .addQueryParameter("fields", UPLOADED_FILE_FIELDS)
      .build().toString()
    val init = driveRequest(
      initUrl, "POST", jsonBody(metadata), op,
      headers = mapOf(
        "X-Upload-Content-Type" to mime,
        "X-Upload-Content-Length" to total.toString(),
      ),
    )
    val sessionUri = init.header("Location")
    if (sessionUri == null || !sessionUri.startsWith("https://")) throw DriveError("server", "upload session")

    var lastReported = -1L
    return uploadChunks(sessionUri, source, total, mime, op) { sent ->
      if (lastReported < 0 || sent >= total || sent - lastReported >= PROGRESS_STEP || sent < lastReported) {
        lastReported = sent
        val p = JSObject()
        p.put("sent", sent)
        p.put("total", total)
        notifyListeners("driveUploadProgress", p)
      }
    }
  }

  @PluginMethod
  fun upload(call: PluginCall) {
    val op = Op()
    synchronized(opLock) {
      if (uploadOp != null) return reject(call, DriveError("busy"))
      uploadOp = op
    }
    executor.execute {
      try {
        val file = doUpload(call, op)
        val ret = JSObject()
        ret.put("file", file)
        call.resolve(ret)
      } catch (e: Throwable) {
        reject(call, if (op.cancelled && e is DriveError && e.code == "network") DriveError("cancelled") else e)
      } finally {
        synchronized(opLock) { if (uploadOp === op) uploadOp = null }
      }
    }
  }

  @PluginMethod
  fun uploadCancel(call: PluginCall) {
    synchronized(opLock) { uploadOp?.cancel() }
    call.resolve()
  }

  // ─── 목록·휴지통 ───

  @PluginMethod
  fun list(call: PluginCall) {
    val kinds: Set<String> = try {
      (call.getArray("kinds") ?: JSArray()).toList<Any>().filterIsInstance<String>().toSet()
    } catch (e: Exception) {
      emptySet()
    }
    executor.execute {
      try {
        val op = Op()
        accessToken()
        val root = resolveRootFolder(op, false)
        val ret = JSObject()
        if (root == null) {
          ret.put("items", JSArray())
          call.resolve(ret)
          return@execute
        }
        val items = ArrayList<JSObject>()
        var pageToken: String? = null
        for (page in 0 until MAX_LIST_PAGES) {
          val r = driveRequest(backupListUrl(root.id, pageToken), "GET", null, op, failCode = "request-failed")
          val body = r.json()
          val files = body?.optJSONArray("files")
          if (files != null) {
            for (i in 0 until files.length()) {
              val f = files.optJSONObject(i) ?: continue
              parseBackupItem(f, kinds)?.let { items.add(it) }
            }
          }
          pageToken = body?.optString("nextPageToken", "")?.ifEmpty { null }
          if (pageToken == null) break
        }
        // 수정 시각 내림차순(최신 먼저), 시각 없는 항목은 뒤, 같으면 이름순.
        items.sortWith(Comparator { a, b ->
          val ta = a.optString("modifiedTime", "")
          val tb = b.optString("modifiedTime", "")
          when {
            ta == tb -> a.optString("name", "").compareTo(b.optString("name", ""))
            ta.isEmpty() -> 1
            tb.isEmpty() -> -1
            else -> tb.compareTo(ta)
          }
        })
        val arr = JSArray()
        for (item in items) arr.put(item)
        ret.put("items", arr)
        root.webViewLink?.let { ret.put("folderLink", it) }
        call.resolve(ret)
      } catch (e: Throwable) {
        reject(call, toRequestError(e))
      }
    }
  }

  // 폴더 확보 과정의 실패 코드(upload-failed)는 목록·휴지통 문맥에 맞게 바꾼다.
  private fun toRequestError(e: Throwable): Throwable =
    if (e is DriveError && e.code == "upload-failed") DriveError("request-failed", e.detail) else e

  // 드라이브 휴지통으로 옮긴다(영구 삭제 아님). 이미 휴지통이면 그대로 성공.
  @PluginMethod
  fun trash(call: PluginCall) {
    val fileId = call.getString("fileId")
    if (fileId == null || !FILE_ID_RE.matches(fileId)) return reject(call, DriveError("not-backup", "file id"))
    executor.execute {
      try {
        val op = Op()
        accessToken()
        val root = resolveRootFolder(op, false) ?: throw DriveError("not-found", "folder")
        if (fileId == root.id) throw DriveError("not-backup", "folder")
        val meta = driveRequest(
          fileGetUrl(fileId, "id,parents,mimeType,trashed"), "GET", null, op,
          failCode = "request-failed", passStatuses = setOf(404),
        )
        if (meta.status == 404) throw DriveError("not-found", "HTTP 404")
        val j = meta.json()
        val parents = j?.optJSONArray("parents")
        var inFolder = false
        if (parents != null) for (i in 0 until parents.length()) if (parents.optString(i) == root.id) inFolder = true
        val isFile = j != null && j.optString("id", "").isNotEmpty() && j.optString("mimeType", "") != FOLDER_MIME
        if (!isFile || !inFolder) throw DriveError("not-backup")
        if (!j!!.optBoolean("trashed", false)) {
          val r = driveRequest(
            fileGetUrl(fileId, "id,trashed"), "PATCH", jsonBody(JSONObject().put("trashed", true)), op,
            failCode = "request-failed", passStatuses = setOf(404),
          )
          if (r.status == 404) throw DriveError("not-found", "HTTP 404")
        }
        call.resolve()
      } catch (e: Throwable) {
        reject(call, toRequestError(e))
      }
    }
  }

  // ─── 받기 ───

  private sealed class Attempt {
    object Done : Attempt()
    class Retry(val err: DriveError) : Attempt()
    class Reauth(val token: String) : Attempt()
  }

  private fun attemptDownload(fileId: String, part: File, expected: Long, op: Op, report: (Long, Long) -> Unit): Attempt {
    val token = accessToken()
    op.check()
    val url = filesUrl().addPathSegment(fileId).addQueryParameter("alt", "media").build().toString()
    val req = Request.Builder().url(url).header("Authorization", "Bearer $token").get().build()
    val call = downloadClient.newCall(req)
    op.attach(call)
    try {
      val resp = try {
        call.execute()
      } catch (e: IOException) {
        if (op.cancelled) throw DriveError("cancelled")
        return Attempt.Retry(DriveError("network", e.javaClass.simpleName))
      }
      resp.use {
        if (!resp.isSuccessful) {
          val text = try { resp.body?.string() ?: "" } catch (e: IOException) { "" }
          if (resp.code == 404) throw DriveError("not-found", "HTTP 404")
          return when (val c = classify(resp.code, parseJson(text), "download-failed")) {
            is Cls.Auth -> Attempt.Reauth(token)
            is Cls.Backoff -> Attempt.Retry(DriveError(c.code, c.detail))
            is Cls.Fail -> throw DriveError(c.code, c.detail)
            else -> throw DriveError("download-failed", "HTTP ${resp.code}")
          }
        }
        val body = resp.body ?: return Attempt.Retry(DriveError("network", "no body"))
        val contentLength = body.contentLength()
        val total = if (expected >= 0) expected else if (contentLength >= 0) contentLength else 0L
        report(0L, total)
        val input: InputStream = body.byteStream()
        val out = try {
          FileOutputStream(part)
        } catch (e: IOException) {
          throw DriveError("download-failed", "open")
        }
        var received = 0L
        var lastReported = 0L
        out.use {
          val buf = ByteArray(64 * 1024)
          while (true) {
            val n = try {
              input.read(buf)
            } catch (e: IOException) {
              if (op.cancelled) throw DriveError("cancelled")
              return Attempt.Retry(DriveError("network", e.javaClass.simpleName))
            }
            if (n < 0) break
            try {
              out.write(buf, 0, n)
            } catch (e: IOException) {
              // 디스크 쓰기 오류(공간 부족 등) — 다시 받아도 같다.
              throw DriveError("download-failed", "write")
            }
            received += n
            if (received - lastReported >= PROGRESS_STEP) {
              lastReported = received
              report(received, total)
            }
          }
        }
        op.check()
        if (total > 0 && received != total) return Attempt.Retry(DriveError("network", "size mismatch"))
        report(received, if (total > 0) total else received)
        return Attempt.Done
      }
    } finally {
      op.detach()
    }
  }

  private fun uniqueDestination(dir: File, fileName: String): File {
    val dot = fileName.lastIndexOf('.')
    val stem = if (dot > 0) fileName.substring(0, dot) else fileName
    val ext = if (dot > 0) fileName.substring(dot) else ""
    var dest = File(dir, fileName)
    var n = 1
    while (dest.exists()) dest = File(dir, "$stem (${n++})$ext")
    return dest
  }

  private fun doDownload(call: PluginCall, op: Op): String {
    val fileId = call.getString("fileId")
    if (fileId == null || !FILE_ID_RE.matches(fileId)) throw DriveError("not-backup", "file id")
    val appDir = appDirFrom(call)
    val dir = File(appDir, "tmp/drive-download/$fileId")
    val localName = sanitizeDownloadName(call.getString("name"), "drive-$fileId")
    val toDownloads = call.getBoolean("toDownloads", false) == true
    if (!toDownloads && isTokenName(localName)) throw DriveError("token-download-forbidden")
    val expected: Long = try {
      val v = call.data.opt("size")
      if (v is Number && v.toDouble() >= 0) v.toLong() else -1L
    } catch (e: Exception) {
      -1L
    }

    // 미연결이면 여기서 바로 not-connected.
    accessToken()
    op.check()

    dir.deleteRecursively()
    if (!dir.mkdirs() && !dir.isDirectory) throw DriveError("download-failed", "mkdir")
    val finalTmp = File(dir, localName)
    val part = File(dir, "$localName.part")
    try {
      var attempt = 0
      var reauthed = false
      while (true) {
        op.check()
        when (val o = attemptDownload(fileId, part, expected, op) { received, total ->
          val p = JSObject()
          p.put("received", received)
          p.put("total", total)
          notifyListeners("driveDownloadProgress", p)
        }) {
          is Attempt.Done -> break
          is Attempt.Reauth -> {
            if (reauthed) throw DriveError("expired", "HTTP 401")
            reauthed = true
            invalidateToken(o.token)
          }
          is Attempt.Retry -> {
            if (attempt >= DOWNLOAD_MAX_RETRIES) throw o.err
            op.sleep(backoffDelayMs(attempt++))
          }
        }
      }
      if (!part.renameTo(finalTmp)) throw DriveError("download-failed", "rename")
    } catch (e: Throwable) {
      dir.deleteRecursively()
      throw e
    }

    // ZipService.unzipFiles(Uri.parse)·Filesystem.readFile(path) 가 그대로 여는 file:// URI.
    if (!toDownloads) return Uri.fromFile(finalTmp).toString()
    try {
      val downloads = File(Environment.getExternalStorageDirectory(), "Download")
      downloads.mkdirs()
      val dest = uniqueDestination(downloads, localName)
      if (!finalTmp.renameTo(dest)) {
        finalTmp.copyTo(dest)
      }
      return dest.absolutePath
    } catch (e: Exception) {
      throw DriveError("download-failed", "move")
    } finally {
      dir.deleteRecursively()
    }
  }

  @PluginMethod
  fun download(call: PluginCall) {
    val op = Op()
    synchronized(opLock) {
      if (downloadOp != null) return reject(call, DriveError("busy"))
      downloadOp = op
    }
    executor.execute {
      try {
        val path = doDownload(call, op)
        val ret = JSObject()
        ret.put("path", path)
        call.resolve(ret)
      } catch (e: Throwable) {
        reject(call, if (op.cancelled && e is DriveError && e.code == "network") DriveError("cancelled") else e)
      } finally {
        synchronized(opLock) { if (downloadOp === op) downloadOp = null }
      }
    }
  }

  @PluginMethod
  fun downloadCancel(call: PluginCall) {
    synchronized(opLock) { downloadOp?.cancel() }
    call.resolve()
  }

  // 받은 임시 폴더(tmp/drive-download/<id>) 삭제. id 형식이 아니면 아무것도 하지 않는다.
  @PluginMethod
  fun cleanupDownload(call: PluginCall) {
    val fileId = call.getString("fileId")
    if (fileId == null || !FILE_ID_RE.matches(fileId)) return call.resolve()
    executor.execute {
      try {
        File(appDirFrom(call), "tmp/drive-download/$fileId").deleteRecursively()
      } catch (e: Exception) {
        /* 정리 실패는 무시 */
      }
      call.resolve()
    }
  }

  // 드라이브 웹 주소만 연다(임의 URL 실행 방지).
  @PluginMethod
  fun openFile(call: PluginCall) {
    val url = call.getString("url")
    if (url == null || !url.startsWith(DRIVE_WEB_PREFIX)) return call.resolve()
    try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      call.resolve()
    } catch (e: Exception) {
      reject(call, DriveError("request-failed", "open"))
    }
  }
}

private fun parseJson(text: String): JSONObject? = try {
  if (text.isBlank()) null else JSONObject(text)
} catch (e: Exception) {
  null
}
