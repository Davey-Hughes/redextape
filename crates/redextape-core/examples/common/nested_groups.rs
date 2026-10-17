/// `m+1` nested groups of two mutually recursive functions. Each level's pair is declared INSIDE the
/// previous level's `f`, which is what makes the nesting compose: `lower_group` clones `group` once
/// per member, and `group` contains every member's lowered value.
pub(crate) fn nested_groups_src(m: u32) -> String {
    let mut body = format!("n + g{m}(n)");
    for k in (0..m).rev() {
        let j = k + 1;
        body = format!("fn f{j}(n) {{ {body} }} fn g{j}(n) {{ f{j}(n) }} g{j}(n) + g{k}(n)");
    }
    format!("fn f0(n) {{ {body} }} fn g0(n) {{ f0(n) }} g0(1)")
}
