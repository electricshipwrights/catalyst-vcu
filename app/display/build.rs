fn main() {
    // Glyphs and images are pre-rendered for the software renderer, which every
    // target uses (see Cargo.toml).
    slint_build::compile_with_config(
        "ui/display.slint",
        slint_build::CompilerConfiguration::new()
            .embed_resources(slint_build::EmbedResourcesKind::EmbedForSoftwareRenderer),
    )
    .unwrap();
}
