// The app's log (foundations O1): appends lines, rolls over when the file is
// full, keeps five files at most.
use menabig_tracker_lib::logfile::append;

#[test]
fn the_log_rolls_over_and_keeps_five_files() {
    let dir = std::env::temp_dir().join(format!("menabig_logs_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for i in 0..40 {
        append(&dir, &format!("line {i:02} ........................................\n"), 200, 5).unwrap();
    }
    let mut names: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
    names.sort();
    assert_eq!(names, vec!["menaone.1.log", "menaone.2.log", "menaone.3.log", "menaone.4.log", "menaone.log"]);
    let current = std::fs::read_to_string(dir.join("menaone.log")).unwrap();
    assert!(current.contains("line 39"), "the newest line is in menaone.log");
    assert!(std::fs::metadata(dir.join("menaone.log")).unwrap().len() <= 200);
    let everything: String = names.iter().map(|n| std::fs::read_to_string(dir.join(n)).unwrap()).collect();
    assert!(!everything.contains("line 00"), "the oldest lines are gone");
    let _ = std::fs::remove_dir_all(&dir);
}
