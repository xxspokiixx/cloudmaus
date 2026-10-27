package com.openmausbot.companion.update

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ApkUpdateTest {
    private fun apk(name: String, size: Long = 12) =
        """{"name":"$name","size":$size,"browser_download_url":"https://github.com/xxspokiixx/cloudmaus/releases/download/v1.2.3/$name"}"""

    private fun release(assets: String = "${apk("OpenMausBot.apk", 20)},${apk("OpenMausBot.apk.sha256", 71)}", extra: String = ""): String =
        """{"tag_name":"v1.2.3","body":"Fixes the pairing screen.\n","draft":false,"prerelease":false$extra,"assets":[$assets]}"""

    @Test
    fun versionCodeMatchesTheSharedFormula() {
        assertEquals(1129, versionCode("0.1.129"))
        assertEquals(1_002_003, versionCode("1.2.3"))
        assertEquals(1, versionCode("0.0.1"))
        assertEquals(2_099_999_999, versionCode("2099.999.999"))
        assertFailsWith<IllegalArgumentException> { versionCode("2100.0.0") }
        assertFailsWith<IllegalArgumentException> { versionCode("0.1000.0") }
        assertFailsWith<IllegalArgumentException> { versionCode("1.2.3-rc.1") }
        assertEquals("0.1.129", versionNameFromTag("v0.1.129"))
        assertFailsWith<IllegalArgumentException> { versionNameFromTag("0.1.129") }
    }

    @Test
    fun comparesStableVersionsOnly() {
        assertTrue(isNewerVersion("v1.2.3", "1.2.2"))
        assertTrue(isNewerVersion("1.2.0", "1.1.9"))
        assertTrue(isNewerVersion("2.0.0", "1.9.9"))
        assertEquals(false, isNewerVersion("1.2.3", "1.2.3"))
        assertEquals(false, isNewerVersion("1.2.2", "1.2.3"))
        assertEquals(false, isNewerVersion("1.2.3-rc.1", "1.2.2"))
        assertEquals(false, isNewerVersion("nightly", "1.2.2"))
        assertEquals(false, isNewerVersion("v1.2.3", ""))
    }

    @Test
    fun parsesANewerReleaseAndItsChecksum() {
        val decision = decideUpdate(parseRelease(release()), "1.2.2")
        val update = assertIs<UpdateDecision.Available>(decision).update
        assertEquals("v1.2.3", update.tag)
        assertEquals("1.2.3", update.version)
        assertEquals("Fixes the pairing screen.\n", update.notes)
        assertEquals("OpenMausBot.apk", update.apkName)
        assertEquals(20L, update.apkSize)
        assertEquals(false, update.debugSigned)
        assertTrue(update.checksumUrl.endsWith("OpenMausBot.apk.sha256"))
        assertEquals(UPDATE_REPOSITORY, "xxspokiixx/cloudmaus")
        assertEquals("https://api.github.com/repos/xxspokiixx/cloudmaus/releases/latest", LATEST_RELEASE_URL)
    }

    @Test
    fun prefersTheReleaseApkAndMarksALoneDebugApk() {
        val both = release(
            "${apk("app-debug.apk")},${apk("app-debug.apk.sha256", 8)},${apk("OpenMausBot.apk")},${apk("OpenMausBot.apk.sha256", 8)}",
        )
        assertEquals("OpenMausBot.apk", assertIs<UpdateDecision.Available>(decideUpdate(parseRelease(both), "1.2.0")).update.apkName)
        val debug = release("${apk("app-debug.apk")},${apk("app-debug.apk.sha256", 8)}")
        val chosen = assertIs<UpdateDecision.Available>(decideUpdate(parseRelease(debug), "1.0.0")).update
        assertEquals("app-debug.apk", chosen.apkName)
        assertEquals(true, chosen.debugSigned)
    }

    @Test
    fun reportsUpToDateAndRejections() {
        assertIs<UpdateDecision.UpToDate>(decideUpdate(parseRelease(release()), "1.2.3"))
        assertEquals("1.2.4", assertIs<UpdateDecision.UpToDate>(decideUpdate(parseRelease(release()), "1.2.4")).version)
        assertEquals(CheckFailure.NO_APK, assertIs<UpdateDecision.Failed>(decideUpdate(parseRelease(release(assets = "")), "1.0.0")).failure)
        assertEquals(CheckFailure.NO_CHECKSUM, assertIs<UpdateDecision.Failed>(decideUpdate(parseRelease(release(assets = apk("OpenMausBot.apk"))), "1.0.0")).failure)
        assertEquals(CheckFailure.NOT_STABLE, assertIs<UpdateDecision.Failed>(decideUpdate(parseRelease(release(extra = ""","draft":true""").replace("\"draft\":false,", "")), "1.0.0")).failure)
        assertEquals(CheckFailure.BAD_TAG, assertIs<UpdateDecision.Failed>(decideUpdate(parseRelease(release().replace("v1.2.3", "nightly")), "1.0.0")).failure)
        assertEquals(CheckFailure.BAD_RELEASE, assertIs<ParseOutcome.Failed>(parseRelease("{")).failure)
        assertEquals(CheckFailure.BAD_INSTALLED, assertIs<UpdateDecision.Failed>(decideUpdate(parseRelease(release()), "beta")).failure)
        assertNull(apkFileName("../evil.apk"))
        assertNull(apkFileName("a/b.apk"))
        assertEquals("OpenMausBot.apk", apkFileName("OpenMausBot.apk"))
    }

    @Test
    fun classifiesHttpAndKeepsNotesWithEscapes() {
        assertNull(classifyStatus(200, "{}", null))
        assertEquals(CheckFailure.NO_RELEASE, classifyStatus(404, "missing", null))
        assertEquals(CheckFailure.RATE_LIMIT, classifyStatus(403, "API rate limit exceeded", "0"))
        assertEquals(CheckFailure.RATE_LIMIT, classifyStatus(429, "slow down", "1"))
        assertEquals(CheckFailure.HTTP, classifyStatus(403, "Resource not accessible", "50"))
        assertEquals(CheckFailure.HTTP, classifyStatus(500, "nope", null))
        val interpreted = interpretRelease(404, "", null, "1.0.0")
        assertEquals(404, assertIs<UpdateDecision.Failed>(interpreted).httpStatus)
        val noted = """{"tag_name":"v1.2.3","body":"line\n\"quoted\" \u0041","draft":false,"prerelease":false,"assets":[${apk("OpenMausBot.apk", 4)},${apk("OpenMausBot.apk.sha256", 4)}]}"""
        val update = assertIs<UpdateDecision.Available>(interpretRelease(200, noted, "50", "1.0.0")).update
        assertEquals("line\n\"quoted\" A", update.notes)
    }

    @Test
    fun checksSizeAndSha256() {
        val bytes = "cloudmaus-apk".toByteArray()
        val hash = sha256Hex(bytes)
        assertEquals(64, hash.length)
        assertEquals(hash, parseChecksum("$hash  OpenMausBot.apk\n"))
        assertNull(parseChecksum("nope"))
        assertIs<VerifyResult.Ok>(verifyDownload(bytes, bytes.size.toLong(), "$hash  OpenMausBot.apk"))
        assertIs<VerifyResult.SizeMismatch>(verifyDownload(bytes, bytes.size.toLong() + 1, hash))
        assertIs<VerifyResult.ChecksumMismatch>(verifyDownload(bytes, bytes.size.toLong(), "a".repeat(64)))
        assertIs<VerifyResult.ChecksumUnreadable>(verifyDownload(bytes, bytes.size.toLong(), "zz"))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", sha256Hex("abc".toByteArray()))
    }
}
