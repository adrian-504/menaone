// A search feed is what gives Watch its regulatory coverage: the ministries
// publish no usable RSS of their own. This checks the real shape of one of
// those feeds (a saved response, so the test needs no network) parses, and
// that a labour-law story out of it is filed against the right services.
use menabig_tracker_lib::intel::assess_for_test;
use rusqlite::Connection;

#[test]
fn a_news_search_feed_parses_and_its_stories_are_classified() {
    let xml = include_bytes!("fixtures/news_search_feed.xml");
    let feed = feed_rs::parser::parse(&xml[..]).expect("a news search feed is ordinary RSS");
    assert!(!feed.entries.is_empty(), "the fixture carries real stories");

    let headlines: Vec<String> = feed.entries.iter().filter_map(|e| e.title.as_ref().map(|t| t.content.clone())).collect();
    assert!(headlines.iter().all(|h| !h.trim().is_empty()));

    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT);").unwrap();

    // Every story in a labour-law search should reach the Watch list, and at
    // least one should be filed against the services labour law touches.
    let mut kept = 0;
    let mut mapped = 0;
    for h in &headlines {
        let a = assess_for_test(&conn, h, None, 4);
        if a.0 { kept += 1; }
        if a.2.iter().any(|s| s == "Administration and PRO" || s == "Recruitment" || s == "Saudization") { mapped += 1; }
    }
    assert!(kept > 0, "a labour-law search must produce something: {headlines:?}");
    assert!(mapped > 0, "and at least one must map to a service: {headlines:?}");
}
