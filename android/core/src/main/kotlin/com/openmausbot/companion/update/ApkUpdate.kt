package com.openmausbot.companion.update

import java.security.MessageDigest

/** This repository. The app queries it with the unauthenticated GitHub API. */
const val UPDATE_REPOSITORY = "xxspokiixx/cloudmaus"
const val LATEST_RELEASE_URL = "https://api.github.com/repos/$UPDATE_REPOSITORY/releases/latest"

private val STABLE = Regex("""^(\d+)\.(\d+)\.(\d+)$""")
private val TAG = Regex("""^v(\d+)\.(\d+)\.(\d+)$""")
private val SHA256_HEX = Regex("""\b([0-9a-fA-F]{64})\b""")
private val APK_NAME = Regex("""^[A-Za-z0-9._-]{1,80}\.apk$""")

/** Same formula as scripts/apk-update.mjs versionCode. */
fun versionCode(versionName: String): Int {
    val parts = parseStable(versionName) ?: throw IllegalArgumentException("version must be X.Y.Z, got $versionName")
    val (major, minor, patch) = parts
    if (major >= 2100 || minor >= 1000 || patch >= 1000) {
        throw IllegalArgumentException("version $versionName does not fit Android versionCode")
    }
    val code = major * 1_000_000 + minor * 1_000 + patch
    if (code <= 0 || code > 2_100_000_000) throw IllegalArgumentException("versionCode $code is out of range")
    return code
}

fun versionNameFromTag(tag: String): String {
    val match = TAG.matchEntire(tag.trim()) ?: throw IllegalArgumentException("release tag must be vX.Y.Z, got $tag")
    return "${match.groupValues[1]}.${match.groupValues[2]}.${match.groupValues[3]}"
}

private fun parseStable(value: String?): IntArray? {
    val match = STABLE.matchEntire(value?.trim()?.removePrefix("v") ?: "") ?: return null
    return intArrayOf(match.groupValues[1].toInt(), match.groupValues[2].toInt(), match.groupValues[3].toInt())
}

/** True when latest is a newer stable X.Y.Z than current. Anything else is not an update. */
fun isNewerVersion(latest: String, current: String): Boolean {
    val a = parseStable(latest) ?: return false
    val b = parseStable(current) ?: return false
    for (i in 0..2) if (a[i] != b[i]) return a[i] > b[i]
    return false
}

fun parseChecksum(text: String?): String? = SHA256_HEX.find(text ?: "")?.groupValues?.get(1)?.lowercase()

fun apkFileName(name: String): String? = if (APK_NAME.matches(name) && !name.contains("..")) name else null

enum class CheckFailure {
    RATE_LIMIT,
    NO_RELEASE,
    HTTP,
    BAD_RELEASE,
    BAD_TAG,
    NOT_STABLE,
    NO_APK,
    NO_CHECKSUM,
    AMBIGUOUS_APK,
    BAD_INSTALLED,
}

fun classifyStatus(status: Int, body: String, rateLimitRemaining: String?): CheckFailure? {
    if (status == 200) return null
    if (status == 404) return CheckFailure.NO_RELEASE
    val limited = rateLimitRemaining?.trim() == "0" || body.contains("rate limit", ignoreCase = true)
    if (status == 429 || (status == 403 && limited)) return CheckFailure.RATE_LIMIT
    return CheckFailure.HTTP
}

data class ReleaseAsset(val name: String, val size: Long, val url: String)

data class ParsedRelease(
    val tag: String,
    val version: String?,
    val notes: String,
    val draft: Boolean,
    val prerelease: Boolean,
    val assets: List<ReleaseAsset>,
)

sealed class ParseOutcome {
    data class Ok(val release: ParsedRelease) : ParseOutcome()
    data class Failed(val failure: CheckFailure) : ParseOutcome()
}

fun parseRelease(json: String): ParseOutcome {
    val value = try {
        parseJson(json)
    } catch (_: JsonParseException) {
        return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
    }
    val obj = value as? JsonValue.Obj ?: return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
    val tag = (obj.fields["tag_name"] as? JsonValue.Str)?.text ?: return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
    val draft = (obj.fields["draft"] as? JsonValue.Bool)?.value ?: return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
    val prerelease = (obj.fields["prerelease"] as? JsonValue.Bool)?.value ?: return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
    val notesValue = obj.fields["body"]
    val notes = when (notesValue) {
        null, JsonValue.Null -> ""
        is JsonValue.Str -> notesValue.text
        else -> return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
    }
    val rawAssets = obj.fields["assets"] as? JsonValue.Arr ?: return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
    val assets = mutableListOf<ReleaseAsset>()
    for (item in rawAssets.items) {
        val asset = item as? JsonValue.Obj ?: return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
        val name = (asset.fields["name"] as? JsonValue.Str)?.text ?: return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
        val url = (asset.fields["browser_download_url"] as? JsonValue.Str)?.text ?: return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
        val size = (asset.fields["size"] as? JsonValue.IntNum)?.value ?: return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
        if (size < 0 || !url.startsWith("https://")) return ParseOutcome.Failed(CheckFailure.BAD_RELEASE)
        assets.add(ReleaseAsset(name, size, url))
    }
    val version = if (!draft && !prerelease) {
        try {
            versionNameFromTag(tag)
        } catch (_: IllegalArgumentException) {
            return ParseOutcome.Failed(CheckFailure.BAD_TAG)
        }
    } else {
        null
    }
    return ParseOutcome.Ok(ParsedRelease(tag, version, notes, draft, prerelease, assets))
}

data class AvailableUpdate(
    val tag: String,
    val version: String,
    val notes: String,
    val apkName: String,
    val apkUrl: String,
    val apkSize: Long,
    val checksumUrl: String,
    val checksumSize: Long,
    val debugSigned: Boolean,
)

sealed class UpdateDecision {
    data class Available(val update: AvailableUpdate) : UpdateDecision()
    data class UpToDate(val version: String) : UpdateDecision()
    data class Failed(val failure: CheckFailure, val httpStatus: Int? = null) : UpdateDecision()
}

fun decideUpdate(parsed: ParseOutcome, installed: String): UpdateDecision {
    val release = when (parsed) {
        is ParseOutcome.Failed -> return UpdateDecision.Failed(parsed.failure)
        is ParseOutcome.Ok -> parsed.release
    }
    if (release.draft || release.prerelease) return UpdateDecision.Failed(CheckFailure.NOT_STABLE)
    val version = release.version ?: return UpdateDecision.Failed(CheckFailure.BAD_TAG)
    if (parseStable(installed) == null) return UpdateDecision.Failed(CheckFailure.BAD_INSTALLED)
    if (!isNewerVersion(version, installed)) return UpdateDecision.UpToDate(installed)
    val apks = release.assets.filter { apkFileName(it.name) != null }
    if (apks.isEmpty()) return UpdateDecision.Failed(CheckFailure.NO_APK)
    val signed = apks.filter { !it.name.contains("debug", ignoreCase = true) }
    val chosen = when {
        signed.size == 1 -> signed[0]
        signed.isEmpty() && apks.size == 1 -> apks[0]
        else -> return UpdateDecision.Failed(CheckFailure.AMBIGUOUS_APK)
    }
    if (chosen.size <= 0) return UpdateDecision.Failed(CheckFailure.NO_APK)
    val checksum = release.assets.find { it.name == "${chosen.name}.sha256" }
        ?: return UpdateDecision.Failed(CheckFailure.NO_CHECKSUM)
    if (checksum.size <= 0) return UpdateDecision.Failed(CheckFailure.NO_CHECKSUM)
    return UpdateDecision.Available(
        AvailableUpdate(
            tag = release.tag,
            version = version,
            notes = release.notes,
            apkName = chosen.name,
            apkUrl = chosen.url,
            apkSize = chosen.size,
            checksumUrl = checksum.url,
            checksumSize = checksum.size,
            debugSigned = chosen.name.contains("debug", ignoreCase = true),
        ),
    )
}

fun interpretRelease(status: Int, body: String, rateLimitRemaining: String?, installed: String): UpdateDecision {
    val failure = classifyStatus(status, body, rateLimitRemaining)
    if (failure != null) return UpdateDecision.Failed(failure, status)
    return decideUpdate(parseRelease(body), installed)
}

sealed class VerifyResult {
    data object Ok : VerifyResult()
    data class SizeMismatch(val actualSize: Int, val expectedSize: Long) : VerifyResult()
    data object ChecksumUnreadable : VerifyResult()
    data class ChecksumMismatch(val actual: String, val expected: String) : VerifyResult()
}

fun sha256Hex(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return digest.joinToString("") { "%02x".format(it) }
}

fun verifyDownload(bytes: ByteArray, expectedSize: Long, checksumText: String): VerifyResult {
    if (bytes.size.toLong() != expectedSize) return VerifyResult.SizeMismatch(bytes.size, expectedSize)
    val expected = parseChecksum(checksumText) ?: return VerifyResult.ChecksumUnreadable
    val actual = sha256Hex(bytes)
    if (actual != expected) return VerifyResult.ChecksumMismatch(actual, expected)
    return VerifyResult.Ok
}
