use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    if target_os == "windows" {
        println!("cargo:rerun-if-env-changed=YNOTV_NATIVE_DASH_LIBMPV_DIR");
        let libmpv = std::env::var_os("YNOTV_NATIVE_DASH_LIBMPV_DIR")
            .map(PathBuf::from)
            .filter(|dir| dir.join("mpv.lib").is_file())
            .unwrap_or_else(|| manifest.join("libmpv"));
        if libmpv.join("mpv.lib").exists() {
            println!("cargo:rustc-link-search=native={}", libmpv.display());
            println!(
                "cargo:rerun-if-changed={}",
                libmpv.join("mpv.lib").display()
            );
        }
    }

    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");

    if target_os == "macos" {
        // Native DASH development may explicitly point at a patched libmpv.
        // This is a build-time search path only: embedding the developer's
        // absolute directory as an rpath makes the resulting app non-portable.
        println!("cargo:rerun-if-env-changed=YNOTV_NATIVE_DASH_LIBMPV_DIR");
        let native_dash_libmpv = std::env::var_os("YNOTV_NATIVE_DASH_LIBMPV_DIR")
            .map(PathBuf::from)
            .filter(|dir| dir.join("libmpv.2.dylib").is_file());
        if let Some(dir) = &native_dash_libmpv {
            println!("cargo:rustc-link-search=native={}", dir.display());
        }

        let mut prefixes: Vec<String> = Vec::new();
        if let Ok(p) = std::env::var("HOMEBREW_PREFIX") {
            if !p.is_empty() {
                prefixes.push(p);
            }
        }
        for p in ["/opt/homebrew", "/usr/local", "/opt/local"] {
            prefixes.push(p.to_string());
        }
        for prefix in &prefixes {
            for sub in ["lib", "opt/mpv/lib", "opt/libmpv/lib"] {
                let dir = std::path::Path::new(prefix).join(sub);
                if dir.exists() {
                    println!("cargo:rustc-link-search=native={}", dir.display());
                }
            }
        }
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path/../Frameworks");
    }

    tauri_build::build()

    // --- Spider sidecar: ensure a JRE is bundled (Windows) ---
    // Downloads Temurin 17 JRE once per fresh build so the TVBox spider
    // sidecar is truly self-contained (no system Java required).
    if target_os == "windows" {
        let jre_dir = manifest.join("spider-sidecar").join("jre");
        let javaw = jre_dir.join("bin").join("javaw.exe");
        println!("cargo:rerun-if-changed=spider-sidecar/jre");
        if !javaw.is_file() {
            println!("cargo:warning=Spider sidecar JRE missing, downloading Temurin 17 JRE...");
            let jre_target = jre_dir.to_string_lossy().replace("/", "\\");
            let ps_template = r#"
$ErrorActionPreference = 'Stop'
$zip = "$env:TEMP\ynotv-jre.zip"
$dst = "$env:TEMP\ynotv-jre-extract"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
Invoke-WebRequest -Uri "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dst -Force
$src = Get-ChildItem $dst -Directory | Select-Object -First 1
$target = "JRE_TARGET_PLACEHOLDER"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path "$($src.FullName)\*" -Destination $target -Recurse -Force
if (-not (Test-Path "$target\bin\javaw.exe")) { throw "JRE download/extract failed" }
"#;
            let ps = ps_template.replace("JRE_TARGET_PLACEHOLDER", &jre_target);
            let out = std::process::Command::new("powershell")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps])
                .output();
            match out {
                Ok(o) if o.status.success() => {
                    println!("cargo:warning=Temurin JRE 17 bundled for spider sidecar.");
                }
                Ok(o) => {
                    println!(
                        "cargo:warning=JRE download failed ({}), sidecar will need system Java: {}",
                        o.status,
                        String::from_utf8_lossy(&o.stderr).chars().take(300).collect::<String>()
                    );
                }
                Err(e) => {
                    println!("cargo:warning=JRE download spawn failed: {e}");
                }
            }
        }
    }
}
