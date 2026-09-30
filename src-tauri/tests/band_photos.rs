// My Day's band photos (brand slice): copied in, listed, served as data URLs.
use menabig_tracker_lib::appearance::{add_photo, list_photos, photo_data_url};

#[test]
fn band_photos_are_copied_listed_and_served() {
    let root = std::env::temp_dir().join(format!("menabig_band_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let src = root.join("Pictures");
    let dir = root.join("band-photos");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(src.join("Office.jpg"), [0xFF, 0xD8, 0xFF]).unwrap();
    std::fs::write(src.join("notes.txt"), "x").unwrap();
    assert_eq!(add_photo(&src.join("Office.jpg"), &dir).unwrap(), "Office.jpg");
    assert_eq!(add_photo(&src.join("Office.jpg"), &dir).unwrap(), "Office 2.jpg", "a second copy gets a free name");
    assert!(add_photo(&src.join("notes.txt"), &dir).is_err(), "not a photo");
    assert!(src.join("Office.jpg").exists(), "the original stays");
    assert_eq!(list_photos(&dir), vec!["Office 2.jpg".to_string(), "Office.jpg".to_string()]);
    assert!(photo_data_url(&dir, "Office.jpg").unwrap().starts_with("data:image/jpeg;base64,/9j/"));
    assert!(photo_data_url(&dir, "../Pictures/notes.txt").is_err(), "no way out of the folder");
    let _ = std::fs::remove_dir_all(&root);
}
