fn main() {
    tauri_build::build();

    // Tauri links its Windows resource only into application binaries. Integration
    // tests that construct a real runtime also need Common Controls v6; otherwise
    // TaskDialogIndirect is imported from the legacy comctl32 before tests start.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let resource =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR is set by Cargo"))
                .join("resource.lib");
        assert!(
            resource.is_file(),
            "Tauri Windows resource library was not generated: {}",
            resource.display()
        );
        println!("cargo:rustc-link-arg-tests={}", resource.display());
    }
}
