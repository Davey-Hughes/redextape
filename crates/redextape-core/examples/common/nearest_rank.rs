/// The value at rank `q` (0.0..=1.0) of an unsorted slice, nearest-rank: always one of `xs`'s actual
/// elements, never an interpolated value between two of them. `None` on an empty slice — a program
/// with no `Within` step has no width to report, which is a different fact from a width of zero.
pub(crate) fn percentile(xs: &[f64], q: f64) -> Option<f64> {
    if xs.is_empty() {
        return None;
    }
    let mut s = xs.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((q * s.len() as f64).ceil() as usize).clamp(1, s.len()) - 1;
    Some(s[rank])
}

/// Median of an unsorted slice, nearest-rank (see `percentile`) — for an EVEN-length slice this is
/// the lower of the two middle values, NOT their average. `None` on an empty slice — a program with
/// zero `Within` steps has no span width to report, and that is different from a width of zero.
pub(crate) fn median(xs: &[f64]) -> Option<f64> {
    percentile(xs, 0.5)
}
