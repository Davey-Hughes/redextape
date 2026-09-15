//! The unbounded natural numbers a counter holds, and the few operations a counter program's accelerated
//! run and its readback need of them.
//!
//! **WHY THIS IS IN THE TREE AND NOT A DEPENDENCY.** A compiled program's counters reach thousands of bits,
//! and an accelerated run divides them by a divisor that never changes within the program. When every head
//! move divided a counter by the base with `num-bigint`, that division was 55% of the profile of
//! `let x = 40; x + 2`'s stage 1 run and `sum(5)` took 146.9 s, because `num-bigint` spends a hardware `div`
//! on every limb. This module divides through a precomputed reciprocal instead — [`Divisor`] — which is a
//! multiplication and a few compares per limb, and it works in place on the limbs.
//!
//! **THE REPRESENTATION.** A [`Nat`] is its base-2^64 digits, least significant first, with no zero limb
//! at the top, so zero is the empty vector and two equal numbers have equal limbs. 64-bit limbs halve the
//! passes 32-bit limbs would take, and `u128` holds every product and every two-limb numerator exactly.

/// An unbounded natural number: its 64-bit limbs, least significant first, with no zero limb at the top.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Nat {
    limbs: Vec<u64>,
}

/// The high and low halves of `x`.
#[expect(clippy::cast_possible_truncation, reason = "the two halves of a u128 are each exactly 64 bits")]
fn halves(x: u128) -> (u64, u64) {
    ((x >> 64) as u64, x as u64)
}

/// A base to divide by, with its reciprocal: dividing by it takes no hardware division per limb.
///
/// The method is Möller and Granlund's 2-by-1 division by an invariant integer ("Improved division by
/// invariant integers", IEEE Transactions on Computers, 2011, Algorithm 4). The divisor is normalized —
/// shifted left until its top bit is set — and `reciprocal` is `⌊(2^128 − 1) / normalized⌋ − 2^64`. Each
/// limb's quotient digit is then estimated by one 128-bit multiplication by the reciprocal and corrected by
/// at most two compares.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Divisor {
    base: u64,
    shift: u32,
    normalized: u64,
    reciprocal: u64,
}

impl Divisor {
    /// The divisor for `base`, or `None` for a base of zero.
    #[must_use]
    pub fn new(base: u64) -> Option<Divisor> {
        if base == 0 {
            return None;
        }
        let shift = base.leading_zeros();
        let normalized = base << shift;
        let (high, reciprocal) =
            halves(((u128::from(!normalized) << 64) | u128::from(u64::MAX)) / u128::from(normalized));
        (high == 0).then_some(Divisor { base, shift, normalized, reciprocal })
    }

    /// The base this divides by.
    #[must_use]
    pub fn base(&self) -> u64 {
        self.base
    }

    /// `(⌊(high·2^64 + low) / normalized⌋, remainder)`, for `high < normalized`.
    #[inline]
    fn divide_two_limbs(&self, high: u64, low: u64) -> (u64, u64) {
        let d = self.normalized;
        let estimate =
            (u128::from(self.reciprocal) * u128::from(high)).wrapping_add((u128::from(high) << 64) | u128::from(low));
        let (q1, q0) = halves(estimate);
        let mut quotient = q1.wrapping_add(1);
        let mut remainder = low.wrapping_sub(quotient.wrapping_mul(d));
        let overshot = u64::from(remainder > q0).wrapping_neg();
        quotient = quotient.wrapping_add(overshot);
        remainder = remainder.wrapping_add(overshot & d);
        if remainder >= d {
            quotient = quotient.wrapping_add(1);
            remainder -= d;
        }
        (quotient, remainder)
    }
}

impl Nat {
    /// Zero.
    #[must_use]
    pub const fn zero() -> Nat {
        Nat { limbs: Vec::new() }
    }

    /// Whether this is zero.
    #[must_use]
    pub fn is_zero(&self) -> bool {
        self.limbs.is_empty()
    }

    /// The limbs, least significant first, with no zero limb at the top.
    #[must_use]
    pub fn limbs(&self) -> &[u64] {
        &self.limbs
    }

    /// `self = other`, reusing `self`'s allocation.
    pub fn set(&mut self, other: &Nat) {
        self.limbs.clone_from(&other.limbs);
    }

    /// The number whose limbs, least significant first, are `limbs`. Zero limbs at the top are dropped.
    #[must_use]
    pub fn from_limbs(mut limbs: Vec<u64>) -> Nat {
        while limbs.last() == Some(&0) {
            limbs.pop();
        }
        Nat { limbs }
    }

    /// The number of bits up to and including the highest set bit; zero has none.
    #[must_use]
    pub fn bits(&self) -> u64 {
        match self.limbs.last() {
            None => 0,
            Some(top) => {
                u64::try_from(self.limbs.len()).unwrap_or(u64::MAX).saturating_mul(64) - u64::from(top.leading_zeros())
            }
        }
    }

    /// `self = self·multiplier + addend`, in place.
    pub fn mul_add(&mut self, multiplier: u64, addend: u64) {
        let mut carry = addend;
        for limb in &mut self.limbs {
            let (high, low) = halves(u128::from(*limb) * u128::from(multiplier) + u128::from(carry));
            *limb = low;
            carry = high;
        }
        if carry != 0 {
            self.limbs.push(carry);
        }
        if multiplier == 0 {
            let keep = self.limbs.iter().rposition(|l| *l != 0).map_or(0, |top| top + 1);
            self.limbs.truncate(keep);
        }
    }

    /// `self = self + other`, in place.
    pub fn add(&mut self, other: &Nat) {
        if self.limbs.len() < other.limbs.len() {
            self.limbs.resize(other.limbs.len(), 0);
        }
        let mut carry = false;
        let (low, high) = self.limbs.split_at_mut(other.limbs.len());
        for (limb, addend) in low.iter_mut().zip(&other.limbs) {
            let (sum, first) = limb.overflowing_add(*addend);
            let (sum, second) = sum.overflowing_add(u64::from(carry));
            *limb = sum;
            carry = first || second;
        }
        for limb in high {
            if !carry {
                break;
            }
            (*limb, carry) = limb.overflowing_add(1);
        }
        if carry {
            self.limbs.push(1);
        }
    }

    /// `self = ⌊self / divisor⌋`, in place, returning `self mod divisor`.
    pub fn div_rem(&mut self, divisor: &Divisor) -> u64 {
        let shift = divisor.shift;
        if shift != 0 {
            // Divide `self · 2^shift` by the normalized divisor instead: the quotient is the same, and the
            // remainder comes out multiplied by `2^shift`.
            let mut carry = 0u64;
            for limb in &mut self.limbs {
                let spilled = *limb >> (64 - shift);
                *limb = (*limb << shift) | carry;
                carry = spilled;
            }
            if carry != 0 {
                self.limbs.push(carry);
            }
        }
        let mut remainder = 0u64;
        for limb in self.limbs.iter_mut().rev() {
            (*limb, remainder) = divisor.divide_two_limbs(remainder, *limb);
        }
        while self.limbs.last() == Some(&0) {
            self.limbs.pop();
        }
        remainder >> shift
    }
}

impl From<u64> for Nat {
    fn from(v: u64) -> Nat {
        Nat::from_limbs(vec![v])
    }
}

impl From<u128> for Nat {
    fn from(v: u128) -> Nat {
        let (high, low) = halves(v);
        Nat::from_limbs(vec![low, high])
    }
}

impl TryFrom<&Nat> for u64 {
    type Error = ();

    fn try_from(n: &Nat) -> Result<u64, ()> {
        match n.limbs[..] {
            [] => Ok(0),
            [only] => Ok(only),
            _ => Err(()),
        }
    }
}

impl TryFrom<&Nat> for u128 {
    type Error = ();

    fn try_from(n: &Nat) -> Result<u128, ()> {
        match n.limbs[..] {
            [] => Ok(0),
            [low] => Ok(u128::from(low)),
            [low, high] => Ok((u128::from(high) << 64) | u128::from(low)),
            _ => Err(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// Bases worth dividing by: small ones a compiled program uses, powers of two (a shift of 63 down to 0),
    /// and the largest a `u64` holds.
    fn base() -> impl Strategy<Value = u64> {
        prop_oneof![1u64..40, (0u32..64).prop_map(|k| 1u64 << k), any::<u64>().prop_map(|b| b.max(1)), Just(u64::MAX)]
    }

    proptest! {
        /// Every operation agrees with `u128` arithmetic wherever the result fits one.
        #[test]
        fn operations_agree_with_u128(x in any::<u128>(), y in any::<u128>(), b in base(), small in any::<u32>(), s in any::<u64>()) {
            let n = Nat::from(x);
            prop_assert_eq!(u128::try_from(&n), Ok(x));
            prop_assert_eq!(n.bits(), u64::from(128 - x.leading_zeros()));

            let (half_x, half_y) = (x >> 1, y >> 1);
            let mut sum = Nat::from(half_x);
            sum.add(&Nat::from(half_y));
            prop_assert_eq!(u128::try_from(&sum), Ok(half_x + half_y));

            let d = Divisor::new(b).unwrap();
            let mut q = Nat::from(x);
            let r = q.div_rem(&d);
            prop_assert_eq!((u128::try_from(&q), r), (Ok(x / u128::from(b)), u64::try_from(x % u128::from(b)).unwrap()));

            let narrow = x >> 96;
            let mut grown = Nat::from(narrow);
            grown.mul_add(u64::from(small), s);
            prop_assert_eq!(u128::try_from(&grown), Ok(narrow * u128::from(small) + u128::from(s)));
        }

        /// On numbers of up to 40 limbs: dividing by `b` gives `q` and `r < b` with `q·b + r` the number, and
        /// pushing a digit `s < b` then dividing gives the number back with remainder `s`.
        #[test]
        fn division_inverts_multiplication_on_large_numbers(limbs in prop::collection::vec(any::<u64>(), 0..40), b in base(), digit in any::<u64>()) {
            let n = Nat::from_limbs(limbs);
            let d = Divisor::new(b).unwrap();

            let mut q = n.clone();
            let r = q.div_rem(&d);
            prop_assert!(r < b);
            let mut back = q;
            back.mul_add(b, r);
            prop_assert_eq!(&back, &n);

            let s = digit % b;
            let mut pushed = n.clone();
            pushed.mul_add(b, s);
            let popped = pushed.div_rem(&d);
            prop_assert_eq!((pushed, popped), (n, s));
        }

        /// Adding in either order gives the same number, and adding zero changes nothing.
        #[test]
        fn addition_commutes_on_large_numbers(a in prop::collection::vec(any::<u64>(), 0..40), b in prop::collection::vec(any::<u64>(), 0..40)) {
            let (a, b) = (Nat::from_limbs(a), Nat::from_limbs(b));
            let mut ab = a.clone();
            ab.add(&b);
            let mut ba = b.clone();
            ba.add(&a);
            prop_assert_eq!(&ab, &ba);
            let mut same = a.clone();
            same.add(&Nat::zero());
            prop_assert_eq!(same, a);
        }
    }

    /// A carry that runs off the top adds a limb, and multiplying by zero leaves no zero limb behind.
    #[test]
    fn carries_and_zero_keep_the_representation_normalized() {
        let mut all_ones = Nat::from_limbs(vec![u64::MAX, u64::MAX]);
        all_ones.add(&Nat::from(1u64));
        assert_eq!(all_ones.limbs(), &[0, 0, 1]);
        all_ones.mul_add(0, 0);
        assert!(all_ones.is_zero());
        assert_eq!(Divisor::new(0), None);
    }
}
