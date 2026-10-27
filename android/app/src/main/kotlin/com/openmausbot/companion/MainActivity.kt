package com.openmausbot.companion

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import com.openmausbot.companion.update.AvailableUpdate
import com.openmausbot.companion.update.CheckFailure
import com.openmausbot.companion.update.LATEST_RELEASE_URL
import com.openmausbot.companion.update.UpdateDecision
import com.openmausbot.companion.update.VerifyResult
import com.openmausbot.companion.update.interpretRelease
import com.openmausbot.companion.update.verifyDownload
import java.io.File
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : ComponentActivity() {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val client = UpdateClient()
    private val cancelled = AtomicBoolean(false)
    private var busy = false
    private var dialog: AlertDialog? = null
    private var pending: AvailableUpdate? = null
    private var awaitingPermission = false
    private lateinit var statusView: TextView
    private lateinit var checkButton: Button

    private val installLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_CANCELED) showStatus(R.string.update_install_cancelled)
        else showStatus(R.string.update_install_handed_off)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_about)
        val versionName = packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        findViewById<TextView>(R.id.version).text = getString(R.string.version_label, versionName)
        statusView = findViewById(R.id.status)
        checkButton = findViewById(R.id.check_for_update)
        checkButton.setOnClickListener { checkForUpdate(versionName) }
    }

    override fun onResume() {
        super.onResume()
        if (!awaitingPermission) return
        awaitingPermission = false
        val update = pending ?: return
        if (packageManager.canRequestPackageInstalls()) downloadAndInstall(update)
        else {
            pending = null
            showStatus(R.string.unknown_sources_still_off)
        }
    }

    override fun onDestroy() {
        cancelled.set(true)
        dialog?.dismiss()
        io.shutdownNow()
        super.onDestroy()
    }

    private fun checkForUpdate(installed: String) {
        if (busy) return
        busy = true
        cancelled.set(false)
        checkButton.isEnabled = false
        showStatus(R.string.checking)
        io.execute {
            val decision = try {
                val response = client.get(
                    LATEST_RELEASE_URL,
                    "application/vnd.github+json",
                    API_LIMIT,
                    cancelled,
                )
                interpretRelease(response.status, response.body.toString(Charsets.UTF_8), response.rateLimitRemaining, installed)
            } catch (_: UpdateClient.Cancelled) {
                null
            } catch (error: IOException) {
                if (error.isOffline()) Offline else DownloadFailed
            }
            onMain {
                busy = false
                checkButton.isEnabled = true
                when (decision) {
                    null -> showStatus(R.string.download_cancelled)
                    Offline -> showStatus(R.string.update_offline)
                    DownloadFailed -> showStatus(R.string.update_failed)
                    is UpdateDecision.UpToDate -> statusView.text = getString(R.string.up_to_date, decision.version)
                    is UpdateDecision.Failed -> statusView.text = failureText(decision)
                    is UpdateDecision.Available -> offer(decision.update)
                    else -> showStatus(R.string.update_failed)
                }
            }
        }
    }

    private fun offer(update: AvailableUpdate) {
        val notes = update.notes.trim().ifEmpty { getString(R.string.update_no_notes) }
        val shown = if (notes.length > 4_000) notes.take(4_000) + "…" else notes
        val debug = if (update.debugSigned) "\n\n" + getString(R.string.update_debug_warning) else ""
        val message = "$shown\n\n${getString(R.string.update_confirm_body)}$debug"
        showDialog(
            AlertDialog.Builder(this)
                .setTitle(getString(R.string.update_available_title, update.version))
                .setMessage(message)
                .setPositiveButton(R.string.install) { _, _ -> beginInstall(update) }
                .setNegativeButton(R.string.not_now) { _, _ -> showStatus(R.string.update_declined) }
                .setOnCancelListener { showStatus(R.string.update_declined) },
        )
    }

    private fun beginInstall(update: AvailableUpdate) {
        pending = update
        if (!packageManager.canRequestPackageInstalls()) {
            showDialog(
                AlertDialog.Builder(this)
                    .setTitle(R.string.unknown_sources_title)
                    .setMessage(R.string.unknown_sources_body)
                    .setPositiveButton(R.string.open_settings) { _, _ ->
                        awaitingPermission = true
                        startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                    }
                    .setNegativeButton(R.string.not_now) { _, _ ->
                        pending = null
                        showStatus(R.string.update_declined)
                    },
            )
            return
        }
        downloadAndInstall(update)
    }

    private fun downloadAndInstall(update: AvailableUpdate) {
        if (update.apkSize <= 0 || update.apkSize > MAX_APK || update.checksumSize <= 0 || update.checksumSize > MAX_CHECKSUM) {
            showStatus(R.string.update_failed)
            return
        }
        busy = true
        cancelled.set(false)
        checkButton.isEnabled = false
        val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 100
        }
        val pad = (24 * resources.displayMetrics.density).toInt()
        bar.setPadding(pad, pad, pad, 0)
        showDialog(
            AlertDialog.Builder(this)
                .setTitle(R.string.downloading_title)
                .setMessage(getString(R.string.downloading_progress, 0))
                .setView(bar)
                .setCancelable(false)
                .setNegativeButton(R.string.not_now) { _, _ -> cancelled.set(true) },
        )
        io.execute {
            val outcome: Any = try {
                val apk = client.get(update.apkUrl, "application/octet-stream", update.apkSize, cancelled) { read, total ->
                    val percent = if (total <= 0) 0 else ((read * 100) / total).toInt().coerceIn(0, 100)
                    onMain {
                        bar.progress = percent
                        dialog?.setMessage(getString(R.string.downloading_progress, percent))
                    }
                }
                if (apk.status !in 200..299) throw IOException("download HTTP ${apk.status}")
                onMain { dialog?.setMessage(getString(R.string.verifying)) }
                val checksum = client.get(update.checksumUrl, "text/plain", update.checksumSize, cancelled)
                if (checksum.status !in 200..299) throw IOException("checksum HTTP ${checksum.status}")
                val verified = verifyDownload(apk.body, update.apkSize, checksum.body.toString(Charsets.UTF_8))
                if (verified != VerifyResult.Ok) verified
                else writeApk(update.apkName, apk.body)
            } catch (_: UpdateClient.Cancelled) {
                CancelledDownload
            } catch (error: IOException) {
                if (error.isOffline()) Offline else error
            }
            onMain {
                dialog?.dismiss()
                busy = false
                checkButton.isEnabled = true
                when (outcome) {
                    CancelledDownload -> showStatus(R.string.download_cancelled)
                    Offline -> showStatus(R.string.update_offline)
                    is VerifyResult.SizeMismatch -> showStatus(R.string.update_size_mismatch)
                    is VerifyResult.ChecksumMismatch, VerifyResult.ChecksumUnreadable -> showStatus(R.string.update_checksum_mismatch)
                    is File -> handOff(outcome)
                    else -> showStatus(R.string.update_failed)
                }
            }
        }
    }

    private fun writeApk(name: String, bytes: ByteArray): File {
        val safe = name.substringAfterLast('/').substringAfterLast('\\')
        if (safe != name || !safe.endsWith(".apk")) throw IOException("unexpected apk name")
        val dir = File(cacheDir, "updates")
        dir.mkdirs()
        val file = File(dir, safe)
        file.writeBytes(bytes)
        return file
    }

    private fun handOff(file: File) {
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            clipData = android.content.ClipData.newRawUri("", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        if (intent.resolveActivity(packageManager) == null) {
            showStatus(R.string.update_install_unavailable)
            return
        }
        installLauncher.launch(intent)
    }

    private fun failureText(failure: UpdateDecision.Failed): String = when (failure.failure) {
        CheckFailure.RATE_LIMIT -> getString(R.string.update_rate_limit)
        CheckFailure.NO_RELEASE -> getString(R.string.update_no_release)
        CheckFailure.HTTP -> getString(R.string.update_http, failure.httpStatus ?: 0)
        CheckFailure.BAD_RELEASE, CheckFailure.BAD_TAG -> getString(R.string.update_bad_release)
        CheckFailure.NOT_STABLE -> getString(R.string.update_not_stable)
        CheckFailure.NO_APK -> getString(R.string.update_no_apk)
        CheckFailure.NO_CHECKSUM -> getString(R.string.update_no_checksum)
        CheckFailure.AMBIGUOUS_APK -> getString(R.string.update_ambiguous)
        CheckFailure.BAD_INSTALLED -> getString(R.string.update_bad_installed)
    }

    private fun showStatus(resId: Int) {
        statusView.text = getString(resId)
    }

    private fun showDialog(builder: AlertDialog.Builder) {
        dialog?.dismiss()
        dialog = builder.show()
    }

    private fun onMain(block: () -> Unit) {
        main.post {
            if (!isDestroyed) block()
        }
    }

    private fun IOException.isOffline(): Boolean =
        this is UnknownHostException || this is ConnectException || this is SocketTimeoutException || cause is UnknownHostException

    private object Offline
    private object DownloadFailed
    private object CancelledDownload

    companion object {
        private const val API_LIMIT = 2L * 1024 * 1024
        private const val MAX_APK = 512L * 1024 * 1024
        private const val MAX_CHECKSUM = 8_192L
    }
}
