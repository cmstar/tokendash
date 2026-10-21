//! System tray icon and menu.
//!
//! libayatana-appindicator (the Linux tray backend) shows the menu on left
//! click and does not deliver icon click events, so the panel is opened from
//! the menu instead of by clicking the icon. The menu also carries what the
//! macOS build shows in the icon itself: today's usage summary.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::badge;
use crate::popover;
use crate::settings;
use crate::usage::TodayTotals;

const TRAY_ID: &str = "tokendash-tray";

/// Menu items that need their text or check state updated later on.
pub struct TrayHandles {
    summary: MenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

pub fn install(app: &AppHandle) -> Result<(), String> {
    let summary = MenuItem::with_id(
        app,
        "summary",
        badge::summary_label(None, None),
        false,
        None::<&str>,
    )
    .map_err(|error| format!("无法创建托盘菜单：{error}"))?;
    let toggle = MenuItem::with_id(app, "toggle", "打开面板", true, None::<&str>)
        .map_err(|error| format!("无法创建托盘菜单：{error}"))?;
    let dashboard = MenuItem::with_id(app, "dashboard", "打开仪表盘", true, None::<&str>)
        .map_err(|error| format!("无法创建托盘菜单：{error}"))?;
    let refresh = MenuItem::with_id(app, "refresh", "立即刷新", true, None::<&str>)
        .map_err(|error| format!("无法创建托盘菜单：{error}"))?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "开机自启",
        true,
        settings::is_autostart_enabled(),
        None::<&str>,
    )
    .map_err(|error| format!("无法创建托盘菜单：{error}"))?;
    let separator =
        PredefinedMenuItem::separator(app).map_err(|error| format!("无法创建托盘菜单：{error}"))?;
    let quit = MenuItem::with_id(app, "quit", "退出 TokenDash", true, None::<&str>)
        .map_err(|error| format!("无法创建托盘菜单：{error}"))?;

    let menu = Menu::with_items(
        app,
        &[
            &summary, &toggle, &dashboard, &refresh, &autostart, &separator, &quit,
        ],
    )
    .map_err(|error| format!("无法创建托盘菜单：{error}"))?;

    app.manage(TrayHandles {
        summary: summary.clone(),
        autostart: autostart.clone(),
    });

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("TokenDash")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => popover::toggle(app),
            "dashboard" => open_dashboard(app),
            "refresh" => refresh_now(app),
            "autostart" => toggle_autostart(app),
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(image) = badge::render_badge(None) {
        builder = builder.icon(tauri::image::Image::new_owned(
            image.rgba,
            image.width,
            image.height,
        ));
    }
    builder
        .build(app)
        .map_err(|error| format!("无法创建托盘图标：{error}"))?;
    Ok(())
}

/// Replaces the tray bitmap and the summary line in one step so the two never
/// disagree about what today's usage is.
pub fn update_usage(app: &AppHandle, totals: Option<TodayTotals>) {
    let (tokens, cost) = match totals {
        Some(totals) => (Some(totals.tokens), Some(totals.cost)),
        None => (None, None),
    };
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Some(image) = badge::render_badge(tokens) {
            let icon = tauri::image::Image::new_owned(image.rgba, image.width, image.height);
            if let Err(error) = tray.set_icon(Some(icon)) {
                eprintln!("[tokendash] 无法更新托盘图标：{error}");
            }
        }
    }
    let label = badge::summary_label(tokens, cost);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(format!("TokenDash · {label}")));
    }
    if let Some(handles) = app.try_state::<TrayHandles>() {
        if let Err(error) = handles.summary.set_text(label) {
            eprintln!("[tokendash] 无法更新托盘摘要：{error}");
        }
    }
}

pub fn sync_autostart(app: &AppHandle, enabled: bool) {
    if let Some(handles) = app.try_state::<TrayHandles>() {
        if let Err(error) = handles.autostart.set_checked(enabled) {
            eprintln!("[tokendash] 无法更新自启状态：{error}");
        }
    }
}

fn toggle_autostart(app: &AppHandle) {
    let mut settings = settings::load();
    settings.launch_at_login = !settings::is_autostart_enabled();
    match settings::save(&settings)
        .and_then(|saved| settings::apply_autostart(saved.launch_at_login).map(|()| saved))
    {
        Ok(saved) => sync_autostart(app, saved.launch_at_login),
        Err(error) => eprintln!("[tokendash] 无法切换开机自启：{error}"),
    }
}

/// Forces the same fetches the background loops make, and tells an open panel
/// to reload its details too.
fn refresh_now(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(port) = handle.state::<crate::daemon::DaemonState>().port() else {
            return;
        };
        match crate::usage::fetch_today(port).await {
            Ok(totals) => update_usage(&handle, Some(totals)),
            Err(error) => eprintln!("[tokendash] 无法读取今日用量：{error}"),
        }
        let _ = crate::usage::warm_detail(port).await;
        popover::request_refresh(&handle);
    });
}

fn open_dashboard(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = crate::daemon::ensure_started(&handle).await;
        match result {
            Ok(port) => {
                if let Err(error) = open::that(format!("http://127.0.0.1:{port}/")) {
                    eprintln!("[tokendash] 无法打开仪表盘：{error}");
                }
            }
            Err(error) => eprintln!("[tokendash] 仪表盘不可用：{error}"),
        }
    });
}
