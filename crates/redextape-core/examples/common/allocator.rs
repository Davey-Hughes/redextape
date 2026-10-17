#[cfg(not(target_arch = "wasm32"))]
#[global_allocator]
pub(crate) static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;
