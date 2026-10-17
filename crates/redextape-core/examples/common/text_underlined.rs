use std::io::Write;

pub(crate) fn line(s: &str) {
    println!("{s}");
    let _ = std::io::stdout().flush();
}

pub(crate) fn head(s: &str) {
    line("");
    line(s);
    line(&"-".repeat(s.len()));
}
