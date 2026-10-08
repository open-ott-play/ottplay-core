import org.jetbrains.kotlin.gradle.dsl.JsModuleKind
import org.jetbrains.kotlin.gradle.targets.js.nodejs.NodeJsRootPlugin
import org.jetbrains.kotlin.gradle.targets.js.npm.NpmExtension

plugins { kotlin("multiplatform") version "2.4.20" }

group = "play.ott"
version = "0.1.0-dev"

rootProject.plugins.withType<NodeJsRootPlugin> {
    // Mocha's transitive range still selects a vulnerable serializer.
    rootProject.extensions.configure<NpmExtension> {
        override("serialize-javascript", "7.0.5")
        override("diff", "8.0.3")
    }
}

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
