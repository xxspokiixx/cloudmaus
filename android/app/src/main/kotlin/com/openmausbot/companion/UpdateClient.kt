package com.openmausbot.companion

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/** Unauthenticated GET. No Authorization header is ever set. */
class UpdateClient {
    class Cancelled : Exception()

    data class Response(val status: Int, val body: ByteArray, val rateLimitRemaining: String?)

    fun get(
        url: String,
        accept: String,
        limit: Long,
        cancelled: AtomicBoolean,
        onProgress: ((read: Long, total: Long) -> Unit)? = null,
    ): Response {
        if (!url.startsWith("https://")) throw IOException("refusing a non-https URL")
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 20_000
            readTimeout = 120_000
            setRequestProperty("User-Agent", "cloudmaus-android-update")
            setRequestProperty("Accept", accept)
        }
        try {
            val status = connection.responseCode
            val rateRemaining = connection.getHeaderField("X-RateLimit-Remaining")
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = ByteArrayOutputStream()
            val chunk = ByteArray(8192)
            var readTotal = 0L
            stream?.use { input ->
                while (true) {
                    if (cancelled.get()) throw Cancelled()
                    val n = input.read(chunk)
                    if (n < 0) break
                    readTotal += n
                    if (readTotal > limit) throw IOException("response is larger than $limit bytes")
                    body.write(chunk, 0, n)
                    onProgress?.invoke(readTotal, limit)
                }
            }
            if (cancelled.get()) throw Cancelled()
            return Response(status, body.toByteArray(), rateRemaining)
        } finally {
            connection.disconnect()
        }
    }
}
