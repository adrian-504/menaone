// Files dropped from Finder (foundations F2): copied in (never moved), names
// kept free, apps and scripts refused.
use menabig_tracker_lib::localfiles::copy_into;

#[test]
fn a_drop_copies_files_and_refuses_apps_and_scripts() {
    let root = std::env::temp_dir().join(format!("menabig_drop_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let src = root.join("Downloads");
    let client = root.join("Proposals").join("Contoso Test");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::create_dir_all(root.join("Proposals")).unwrap();
    for (name, body) in [("Deck.pptx", "a"), ("install.sh", "b"), ("Notes.pdf", "c")] {
        std::fs::write(src.join(name), body).unwrap();
    }
    std::fs::create_dir_all(src.join("A folder")).unwrap();
    let paths: Vec<String> = ["Deck.pptx", "install.sh", "Notes.pdf", "A folder"].iter().map(|n| src.join(n).to_string_lossy().to_string()).collect();
    let r = copy_into(&paths, &client).unwrap();
    assert_eq!(r.copied.len(), 2, "the client folder is made and two files copied");
    assert_eq!(r.refused, vec!["install.sh".to_string(), "A folder".to_string()]);
    assert!(src.join("Deck.pptx").exists(), "the original stays");
    // Dropped again: a free name, nothing overwritten.
    let again = copy_into(&paths[..1].to_vec(), &client).unwrap();
    assert!(again.copied[0].ends_with("Deck 2.pptx"));
    let _ = std::fs::remove_dir_all(&root);
}
