//! Shared filesystem locations. Everything lives in `~/.tokendash/` so the
//! desktop app and the Node daemon read the same port/pid/credential files.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub fn home_dir() -> PathBuf {
    // Match Node's os.homedir(): Windows uses USERPROFILE even when a shell
    // has inherited a different HOME (for example Git Bash).
    #[cfg(windows)]
    let names = ["USERPROFILE", "HOME"];
    #[cfg(not(windows))]
    let names = ["HOME", "USERPROFILE"];
    names
        .into_iter()
        .filter_map(std::env::var_os)
        .find(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn data_dir() -> PathBuf {
    home_dir().join(".tokendash")
}

pub fn pid_path() -> PathBuf {
    data_dir().join("daemon.pid")
}

pub fn port_path() -> PathBuf {
    data_dir().join("daemon.port")
}

pub fn settings_path() -> PathBuf {
    data_dir().join("desktop-settings.json")
}

pub fn credentials_path() -> PathBuf {
    data_dir().join("credentials.json")
}

pub fn ensure_data_dir() -> io::Result<()> {
    fs::create_dir_all(data_dir())
}

/// Reads a port or pid file. Whitespace-only or malformed content reads as
/// `None`: a half-written file must never be mistaken for a live daemon.
pub fn read_number(path: &Path) -> Option<u32> {
    let raw = fs::read_to_string(path).ok()?;
    raw.trim().parse::<u32>().ok().filter(|value| *value > 0)
}

/// Writes a numeric file with the trailing newline the Node daemon tolerates,
/// then flushes so a concurrent reader cannot observe a partial write.
pub fn write_number(path: &Path, value: u32) -> io::Result<()> {
    ensure_data_dir()?;
    fs::write(path, format!("{value}\n"))
}

pub fn is_process_alive(pid: u32) -> bool {
    // Use /proc on Linux, process handles on Windows and kill(pid, 0) on
    // other Unix hosts. None of these checks sends a signal to the process.
    #[cfg(target_os = "linux")]
    {
        Path::new(&format!("/proc/{pid}")).exists()
    }
    #[cfg(windows)]
    {
        // Query directly instead of spawning PowerShell every health interval.
        // Handles are always closed, including exited process handles.
        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
            fn GetExitCodeProcess(handle: *mut std::ffi::c_void, code: *mut u32) -> i32;
            fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        }
        unsafe {
            let handle = OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
            if handle.is_null() {
                return false;
            }
            let mut code = 0;
            let queried = GetExitCodeProcess(handle, &mut code) != 0;
            CloseHandle(handle);
            queried && code == 259 // STILL_ACTIVE
        }
    }
    #[cfg(all(not(target_os = "linux"), not(windows)))]
    {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

/// Never flash a console window when the tray launches a helper or Node.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = &mut command;
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liveness_detects_current_process_and_rejects_invalid_pid() {
        assert!(is_process_alive(std::process::id()));
        assert!(!is_process_alive(u32::MAX));
    }
}
