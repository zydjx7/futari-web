fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let source = "src/platform/appkit.m";
        println!("cargo:rerun-if-changed={source}");
        cc::Build::new()
            .file(source)
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("futari_appkit");
        for framework in [
            "AppKit",
            "Carbon",
            "WebKit",
            "CoreGraphics",
            "ApplicationServices",
            "CoreImage",
            "QuartzCore",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    let commands = &[
        "desktop_view",
        "update_status",
        "check_update",
        "apply_ui_update",

        "ui_bundle_info",
        "ui_bundle_rollback",

        "focused_shortcut",
        "capture_desktop",
        "update_hit",
        "furniture_contact",
        "close_notebook",
        "report_scene",
        "scene_list",
        "scene_layer",
        "set_option",
        "finish_fence",
        "tend",
        "stage_act",
        "exit_stage_mode",
        "open_card",
        "food_drag",
        "set_atmosphere",
        "start_camera",
        "album_list",
        "album_image",
        "album_upload",
        "album_title",
        "album_delete",
        "save_print",
        "home",
        "rename",
        "mail",
        "account_mode",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("desktop capabilities");
}
