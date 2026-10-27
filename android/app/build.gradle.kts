plugins {
    id("com.android.application")
    kotlin("android")
}

fun readPackageVersion(): String {
    val pkg = rootProject.file("../package.json").readText()
    val match = Regex(""""version"\s*:\s*"(\d+\.\d+\.\d+)"""").find(pkg)
        ?: throw GradleException("package.json version must be X.Y.Z")
    return match.groupValues[1]
}

/** Same formula as scripts/apk-update.mjs versionCode. */
fun versionCodeOf(versionName: String): Int {
    val match = Regex("""^(\d+)\.(\d+)\.(\d+)$""").matchEntire(versionName)
        ?: throw GradleException("version must be X.Y.Z, got $versionName")
    val major = match.groupValues[1].toInt()
    val minor = match.groupValues[2].toInt()
    val patch = match.groupValues[3].toInt()
    if (major >= 2100 || minor >= 1000 || patch >= 1000) {
        throw GradleException("version $versionName does not fit Android versionCode")
    }
    val code = major * 1_000_000 + minor * 1_000 + patch
    if (code <= 0 || code > 2_100_000_000) throw GradleException("versionCode $code is out of range")
    return code
}

val packageVersion = readPackageVersion()
val resolvedName = providers.gradleProperty("versionName").orNull ?: packageVersion
if (resolvedName != packageVersion) {
    throw GradleException("versionName $resolvedName does not match package.json $packageVersion")
}
val resolvedCode = providers.gradleProperty("versionCode").orNull?.toInt() ?: versionCodeOf(resolvedName)
if (resolvedCode != versionCodeOf(resolvedName)) {
    throw GradleException("versionCode $resolvedCode does not match ${versionCodeOf(resolvedName)} for $resolvedName")
}

android {
    namespace = "com.openmausbot.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.openmausbot.companion"
        minSdk = 26
        targetSdk = 35
        versionName = resolvedName
        versionCode = resolvedCode
    }

    signingConfigs {
        create("release") {
            val store = System.getenv("ANDROID_KEYSTORE_PATH")
            if (!store.isNullOrBlank()) {
                storeFile = file(store)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                    ?: throw GradleException("ANDROID_KEYSTORE_PASSWORD is empty")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                    ?: throw GradleException("ANDROID_KEY_ALIAS is empty")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
                    ?: throw GradleException("ANDROID_KEY_PASSWORD is empty")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (!System.getenv("ANDROID_KEYSTORE_PATH").isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    // A release APK without the stable keystore would be unsigned, and Android
    // would refuse to install it over any existing copy. Debug builds stay available.
    tasks.configureEach {
        if (name == "assembleRelease" || name == "packageRelease") {
            doFirst {
                if (System.getenv("ANDROID_KEYSTORE_PATH").isNullOrBlank()) {
                    throw GradleException("Release builds need ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, and ANDROID_KEY_PASSWORD. Without them, assemble the debug APK instead.")
                }
            }
        }
    }

    lint {
        checkReleaseBuilds = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
