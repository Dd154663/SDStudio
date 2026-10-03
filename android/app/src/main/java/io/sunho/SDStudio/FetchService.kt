package io.sunho.SDStudio

import android.util.Base64
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

// NovelAI 요청 전용 OkHttp 래퍼.
// - 호출별 타임아웃: JS 가 timeoutMs 를 넘기면 read·write·call 타임아웃에 적용(connect 30초 고정),
//   생략하면 120초. 단일 출처는 src/renderer/models/requestTiming.ts(120초 시작·+60초·상한 300초).
// - 취소: requestId 로 cancel 을 부르면 진행 중 call 을 끊는다(큐 바깥 타임아웃·시도 폐기).
// - 거부 코드: 시간 초과 = "TIMEOUT", cancel 로 끊김 = "CANCELED", 그 외 네트워크 오류 = 코드 없음.
@CapacitorPlugin(name = "FetchService")
class FetchService : Plugin() {
  companion object {
    private const val CONNECT_TIMEOUT_SEC = 30L
    private const val DEFAULT_TIMEOUT_MS = 120_000L
    // JS 상한(300초)보다 넉넉한 안전 상한 — 잘못된 값이 무한 대기가 되지 않게.
    private const val MAX_TIMEOUT_MS = 600_000L
  }

  // 공용 클라이언트(커넥션 풀 공유). 호출마다 newBuilder() 로 타임아웃만 바꿔 파생한다.
  private val client = OkHttpClient.
    Builder()
    .connectTimeout(CONNECT_TIMEOUT_SEC, TimeUnit.SECONDS)
    .readTimeout(DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .writeTimeout(DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .callTimeout(DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .build()

  private val inFlight = ConcurrentHashMap<String, Call>()
  private val canceledByJs = ConcurrentHashMap.newKeySet<String>()

  @PluginMethod
  fun fetchData(call: PluginCall) {
    val url = call.getString("url") ?: return call.reject("Must provide URL")
    val jsonBody = call.getString("body") ?: "{}"
    val headers = call.getString("headers") ?: "{}"
    val requestId = call.getString("requestId")
    val requested = call.getInt("timeoutMs")?.toLong()
    val timeoutMs =
      if (requested != null && requested > 0) minOf(requested, MAX_TIMEOUT_MS) else DEFAULT_TIMEOUT_MS

    val mediaType = "application/json; charset=utf-8".toMediaType()
    val body = RequestBody.create(mediaType, jsonBody)

    val requestBuilder = Request.Builder().url(url).post(body)

    // Add headers to the request
    val headersMap = JSONObject(headers)
    headersMap.keys().forEach {
      requestBuilder.addHeader(it, headersMap.getString(it))
    }

    val request = requestBuilder.build()

    val perCallClient = client.newBuilder()
      .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
      .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
      .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
      .build()
    val httpCall = perCallClient.newCall(request)
    if (requestId != null) inFlight[requestId] = httpCall

    httpCall.enqueue(object : Callback {
      override fun onFailure(httpcall: Call, e: IOException) {
        rejectFailure(call, requestId, e)
      }

      override fun onResponse(httpcall: Call, response: Response) {
        response.use {
          // 본문 읽기 중 시간 초과·취소도 JS 로 알린다(놓치면 JS 가 응답을 영영 기다린다).
          val responseData = try {
            response.body?.bytes()
          } catch (e: IOException) {
            rejectFailure(call, requestId, e)
            return
          }
          if (requestId != null) {
            inFlight.remove(requestId)
            canceledByJs.remove(requestId)
          }
          val blobData = responseData?.let { Base64.encodeToString(it, Base64.DEFAULT) }
          val result = JSObject()
          result.put("data", blobData)
          result.put("status", response.code)
          val correlationId = response.header("x-correlation-id")
            ?: response.header("x-request-id")
            ?: response.header("cf-ray")
          if (correlationId != null) result.put("correlationId", correlationId)
          call.resolve(result)
        }
      }
    })
  }

  private fun rejectFailure(call: PluginCall, requestId: String?, e: IOException) {
    if (requestId != null) inFlight.remove(requestId)
    when {
      requestId != null && canceledByJs.remove(requestId) ->
        call.reject("Request canceled", "CANCELED")
      // SocketTimeoutException 과 callTimeout 의 "timeout" 모두 InterruptedIOException 이다.
      e is InterruptedIOException ->
        call.reject("Request timed out: ${e.message}", "TIMEOUT")
      else ->
        call.reject("Network request failed: ${e.message}")
    }
  }

  @PluginMethod
  fun cancel(call: PluginCall) {
    val requestId = call.getString("requestId") ?: return call.reject("Must provide requestId")
    val httpCall = inFlight.remove(requestId)
    if (httpCall != null) {
      canceledByJs.add(requestId)
      httpCall.cancel()
    }
    call.resolve()
  }
}
