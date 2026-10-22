//! TVBox spider sidecar lifecycle.
//!
//! Spawns the Java spider service (`host.SpiderService`) on 127.0.0.1:17890
//! when the app starts and kills it on exit. The service files ship as Tauri
//! resources under `spider-sidecar/` (classes/, lib/, spiders/); a JVM is
//! located at runtime so no JRE has to be baked into the installer:
//!
//!   1. bundled JRE at `<resources>/spider-sidecar/jre/bin/javaw.exe`
//!      (populated by a future jlink step — see windows-package README)
//!   2. `%JAVA_HOME%/bin/javaw.exe`
//!   3. `javaw.exe` / `java.exe` on PATH (needs JRE/JDK 17+)
//!
//! NOTE: `SpiderService` currently binds all interfaces
//! (`new InetSocketAddress(port)`); it should bind 127.0.0.1 only to avoid
//! the Windows Firewall prompt. One-line Java-side change:
//! `new InetSocketAddress("127.0.0.1", port)`.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Append a line to ~/Desktop/ynotv-sidecar.log for diagnostics.
fn diag_log(msg: &str) {
    use std::io::Write;
    if let Ok(home) = std::env::var("USERPROFILE") {
        let p = std::path::PathBuf::from(home).join("Desktop").join("ynotv-sidecar.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
            let _ = writeln!(f, "[{}] {}", chrono_now(), msg);
        }
    }
}


/// Strip the Windows verbatim-path prefix (\\?\) if present.
/// Java's classpath parser does not understand it, so all paths handed
/// to the JVM (classpath, spider dir arg) must be stripped.
fn strip_verbatim_prefix(p: &std::path::Path) -> String {
    let s = p.to_string_lossy();
    s.strip_prefix("\\\\?\\").unwrap_or(&s).to_string()
}

fn chrono_now() -> String {
    // Simple timestamp without external crates.
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => format!("{}", d.as_secs()),
        Err(_) => "?".into(),
    }
}


/// Port the TVBox UI expects the sidecar on (must match the frontend).
pub const SIDECAR_PORT: u16 = 17890;
/// Resource subdir carrying the Java service files.
const SIDECAR_DIR_NAME: &str = "spider-sidecar";

#[derive(Default)]
pub struct SpiderSidecarState {
    child: Mutex<Option<Child>>,
}

/// Scan PATH for an executable name.
fn find_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Locate a JVM: bundled JRE > JAVA_HOME > PATH. Prefers `javaw` (no console).
fn find_java(sidecar_dir: &Path) -> Option<PathBuf> {
    // 1. Bundled JRE shipped as a resource (populated by a future jlink step).
    for exe in ["javaw.exe", "java.exe", "javaw", "java"] {
        let p = sidecar_dir.join("jre").join("bin").join(exe);
        if p.is_file() {
            return Some(p);
        }
    }
    // 2. JAVA_HOME.
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        for exe in ["javaw.exe", "java.exe", "javaw", "java"] {
            let p = PathBuf::from(&java_home).join("bin").join(exe);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    // 3. PATH.
    for exe in ["javaw.exe", "java.exe", "javaw", "java"] {
        if let Some(p) = find_on_path(exe) {
            return Some(p);
        }
    }
    None
}

/// Start the spider service in the background. Never blocks the caller;
/// failures are logged and leave TVBox spiders unavailable (the UI shows
/// a "service not started" hint in that case).
pub fn start_spider_sidecar(app: &AppHandle) {
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let resource_dir = match app_handle.path().resource_dir() {
            Ok(d) => d,
            Err(e) => {
                log::warn!("[SpiderSidecar] cannot resolve resource dir: {e}");
                return;
            }
        };
        diag_log(&format!("resource_dir={}", resource_dir.display()));
        let sidecar_dir = resource_dir.join(SIDECAR_DIR_NAME);
        diag_log(&format!("sidecar_dir={}", sidecar_dir.display()));
        if !sidecar_dir.join("classes").is_dir() {
            log::warn!(
                "[SpiderSidecar] resources missing at {}",
                sidecar_dir.display()
            );
            return;
        }
        diag_log("searching for JVM...");
        let java = match find_java(&sidecar_dir) {
            Some(j) => j,
            None => {
                log::warn!(
                    "[SpiderSidecar] no JVM found (bundled jre/, JAVA_HOME, or PATH). \
                     Install a JRE 17+ or set JAVA_HOME. TVBox spiders unavailable."
                );
                return;
            }
        };

        diag_log(&format!("using java: {}", java.display()));
        // Classpath: <dir>/classes + every jar in <dir>/lib. The service
        // loads spider jars itself from <dir>/spiders (argv[1]).
        let sidecar_str = strip_verbatim_prefix(&sidecar_dir);
        #[cfg(target_os = "windows")]
        let cp = format!(
            "{}\\classes;{}\\lib\\*",
            sidecar_str,
            sidecar_str
        );
        #[cfg(not(target_os = "windows"))]
        let cp = format!(
            "{}/classes:{}/lib/*",
            sidecar_dir.display(),
            sidecar_dir.display()
        );

        diag_log(&format!("classpath={}", cp));
diag_log(&format!("sidecar_str={}", sidecar_str));
        let mut cmd = Command::new(&java);
        cmd.args([
            "-cp",
            &cp,
            "host.SpiderService",
            &SIDECAR_PORT.to_string(),
            &sidecar_str,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .current_dir(&sidecar_dir);
        #[cfg(target_os = "windows")]
        {
            // CREATE_NO_WINDOW: belt & braces — javaw.exe already has no console.
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        match cmd.spawn() {
            Ok(child) => {
                diag_log(&format!("spawn OK pid={:?}", child.id()));
                log::info!(
                    "[SpiderSidecar] started via {} (pid {:?}) on 127.0.0.1:{}",
                    java.display(),
                    child.id(),
                    SIDECAR_PORT
                );
                if let Some(state) = app_handle.try_state::<SpiderSidecarState>() {
                    *state.child.lock().unwrap() = Some(child);
                }
            }
            Err(e) => {
                diag_log(&format!("spawn FAILED: {e}"));
                log::warn!("[SpiderSidecar] spawn failed: {e}")
            }
        }
    });
}

/// Kill the sidecar if it is running. Called on app exit.
pub fn stop_spider_sidecar(app: &AppHandle) {
    if let Some(state) = app.try_state::<SpiderSidecarState>() {
        if let Some(mut child) = state.child.lock().unwrap().take() {
            log::info!("[SpiderSidecar] stopping (pid {:?})", child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
