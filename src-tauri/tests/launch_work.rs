// How long the work the app does at launch takes on a real-sized database: opening it (the migration check),
// reading every record and handing it to the page as JSON, and rebuilding the search index. A measure for
// comparing build profiles; it asserts nothing. Opt-in, on a COPY of the database:
//   MENA_DB_COPY=<copy.sqlite3> MENA_OUT=<scratch dir> cargo test --release --test launch_work -- --ignored --nocapture
use std::time::Instant;

mod common;

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

#[test]
#[ignore]
fn times_the_launch_work_on_a_database_copy() {
    let (Ok(db), Ok(out)) = (std::env::var("MENA_DB_COPY"), std::env::var("MENA_OUT")) else { return };
    let (dir, copy) = common::own_scratch(&db, &out, "launch-work");
    let ms = |t: Instant| t.elapsed().as_secs_f64() * 1000.0;
    let mut open = Vec::new();
    for _ in 0..7 {
        let t = Instant::now();
        let conn = menabig_tracker_lib::db::init_connection(&copy).unwrap();
        open.push(ms(t));
        drop(conn);
    }
    let conn = menabig_tracker_lib::db::init_connection(&copy).unwrap();
    let (mut read, mut json, mut index) = (Vec::new(), Vec::new(), Vec::new());
    let mut bytes = 0;
    for _ in 0..15 {
        let t = Instant::now();
        let data = menabig_tracker_lib::commands::read_all_data(&conn).unwrap();
        read.push(ms(t));
        let t = Instant::now();
        bytes = serde_json::to_string(&data).unwrap().len();
        json.push(ms(t));
    }
    for _ in 0..7 {
        let t = Instant::now();
        menabig_tracker_lib::v2_search::rebuild_all(&conn).unwrap();
        index.push(ms(t));
    }
    drop(conn);
    common::drop_scratch(&dir, &copy);
    let (o, r, j, i) = (median(open), median(read), median(json), median(index));
    println!("launch work (medians): open {o:.1} ms · read all data {r:.1} ms · to JSON {j:.1} ms ({} KB) · search index rebuild {i:.1} ms · together {:.1} ms", bytes / 1024, o + r + j + i);
}
