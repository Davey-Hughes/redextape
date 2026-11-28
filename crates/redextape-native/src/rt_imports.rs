//! The runtime functions compiled code imports from `redextape_native_rt`, listed once. Both
//! backends declare every import from this table and bind it to the same address, so a name, an
//! arity or a return kind cannot differ between the Cranelift and the LLVM code.

use std::ops::Index;

/// Declares `RtFn`, `RtFn::ALL`, `RtFn::symbol` and `RtFn::address` from one list of
/// `Variant => native-rt function`. The symbol is the function's identifier, the name native-rt's
/// staticlib exports it under (its `link-names` feature), and `address` names that identifier, so a
/// misspelt or stale name does not compile and no variant can be missing from `ALL`.
macro_rules! rt_imports {
    ($($variant:ident => $func:ident,)*) => {
        /// One runtime import. The order is the order both backends declare them in, which numbers
        /// Cranelift's imports `u0:0`-`u0:10` and orders LLVM's declarations: the snapshots record it.
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum RtFn {
            $($variant,)*
        }

        impl RtFn {
            /// Every import, in declaration order.
            pub const ALL: [RtFn; [$(stringify!($variant)),*].len()] = [$(Self::$variant,)*];

            /// The symbol it is declared under, by which `redextape-mc` names a runtime call. Wherever
            /// `address` is compiled too, it checks the name against native-rt.
            #[must_use]
            pub fn symbol(self) -> &'static str {
                match self {
                    $(Self::$variant => stringify!($func),)*
                }
            }

            /// The function's address in this process, which a JIT binds the import to.
            #[cfg(any(feature = "cranelift", feature = "llvm"))]
            pub(crate) fn address(self) -> *const u8 {
                match self {
                    $(Self::$variant => redextape_native_rt::$func as *const u8,)*
                }
            }
        }
    };
}

rt_imports! {
    Cons => rt_cons,
    Head => rt_head,
    Tail => rt_tail,
    IsEmpty => rt_is_empty,
    Box => rt_box,
    BoxGet => rt_box_get,
    BoxSet => rt_box_set,
    Tick => rt_tick,
    Enter => rt_enter,
    Leave => rt_leave,
    Faulted => rt_faulted,
}

impl RtFn {
    /// How many word (`i64`) parameters follow the leading `*mut Runtime`.
    #[must_use]
    pub fn word_params(self) -> usize {
        match self {
            Self::Cons | Self::BoxSet => 2,
            Self::Head | Self::Tail | Self::IsEmpty | Self::Box | Self::BoxGet => 1,
            Self::Tick | Self::Enter | Self::Leave | Self::Faulted => 0,
        }
    }

    /// Whether it returns a word: all but `rt_box_set` and `rt_leave`, which return nothing.
    #[must_use]
    pub fn returns_word(self) -> bool {
        !matches!(self, Self::BoxSet | Self::Leave)
    }
}

// `PerRtFn` indexes by discriminant, so `ALL` must list the variants in declaration order.
const _: () = {
    let mut i = 0;
    while i < RtFn::ALL.len() {
        assert!(RtFn::ALL[i] as usize == i, "RtFn::ALL is not in the enum's order");
        i += 1;
    }
};

/// One value per runtime import, indexed by `RtFn`.
pub(crate) struct PerRtFn<T>([T; RtFn::ALL.len()]);

impl<T> PerRtFn<T> {
    /// Calls `f` once per import, in `RtFn::ALL`'s order, which is the declaration order.
    pub(crate) fn from_fn(f: impl FnMut(RtFn) -> T) -> Self {
        Self(RtFn::ALL.map(f))
    }
}

impl<T> Index<RtFn> for PerRtFn<T> {
    type Output = T;

    fn index(&self, f: RtFn) -> &T {
        &self.0[f as usize]
    }
}
