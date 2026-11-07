;; saturation-01
;; source:
;;   let n = 18446744073709551615; n + 1
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: mustprogress nofree norecurse nosync nounwind willreturn memory(none)
define noundef i64 @"$main"(ptr nofree readnone captures(none) %0) local_unnamed_addr #0 {
prologue:
  ret i64 -1
}

attributes #0 = { mustprogress nofree norecurse nosync nounwind willreturn memory(none) }
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: mustprogress nofree norecurse nosync nounwind willreturn memory(none)
define noundef i64 @"$main"(ptr nofree readnone captures(none) %0) local_unnamed_addr #0 {
prologue:
  ret i64 -1
}

attributes #0 = { mustprogress nofree norecurse nosync nounwind willreturn memory(none) }
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: mustprogress nofree norecurse nosync nounwind willreturn memory(none)
define noundef i64 @"$main"(ptr nofree readnone captures(none) %0) local_unnamed_addr #0 {
prologue:
  ret i64 -1
}

attributes #0 = { mustprogress nofree norecurse nosync nounwind willreturn memory(none) }
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: mustprogress nofree norecurse nosync nounwind optsize willreturn memory(none)
define noundef i64 @"$main"(ptr nofree readnone captures(none) %0) local_unnamed_addr #0 {
prologue:
  ret i64 -1
}

attributes #0 = { mustprogress nofree norecurse nosync nounwind optsize willreturn memory(none) }
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; Function Attrs: minsize mustprogress nofree norecurse nosync nounwind optsize willreturn memory(none)
define noundef i64 @"$main"(ptr nofree readnone captures(none) %0) local_unnamed_addr #0 {
prologue:
  ret i64 -1
}

attributes #0 = { minsize mustprogress nofree norecurse nosync nounwind optsize willreturn memory(none) }
