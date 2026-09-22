import org.jetbrains.kotlin.gradle.dsl.JsModuleKind

plugins { kotlin("multiplatform") version "2.4.20" }

group = "play.ott"
version = "0.1.0-dev"

kotlin {
    jvm { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
    js {
        outputModuleName = "OttPlayCore"
        nodejs()
        binaries.executable()
        generateTypeScriptDefinitions()
        compilerOptions {
            target = "es5"
            moduleKind.set(JsModuleKind.MODULE_UMD)
        }
    }
    // Native toolchains are optional for JVM/web work, never silently assumed tested.
    if (providers.gradleProperty("apple").orNull == "true") {
        listOf(iosArm64(), iosSimulatorArm64(), macosArm64()).forEach { target ->
            target.binaries.framework { baseName = "OttPlayCore" }
        }
    }
    sourceSets { commonTest.dependencies { implementation(kotlin("test")) } }
}

tasks.withType<Test>().configureEach { testLogging { events("failed", "skipped") } }
tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
