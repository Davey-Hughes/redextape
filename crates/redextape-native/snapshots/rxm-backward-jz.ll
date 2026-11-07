;; rxm-backward-jz
;; source:
;;       li	r0, #3
;;       li	r1, #1
;;       li	r2, #0
;;       li	rr, #0
;;   loop:
;;       add	rr, rr, r0
;;       sub	r0, r0, r1
;;       cmpeq	r3, r0, r2
;;       jz	r3, loop
;;       halt
;; ==== built: O0 O1 O2 O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64)

declare i64 @rt_head(ptr, i64)

declare i64 @rt_tail(ptr, i64)

declare i64 @rt_is_empty(ptr, i64)

declare i64 @rt_box(ptr, i64)

declare i64 @rt_box_get(ptr, i64)

declare void @rt_box_set(ptr, i64, i64)

declare i64 @rt_tick(ptr)

declare i64 @rt_enter(ptr)

declare void @rt_leave(ptr)

declare i64 @rt_faulted(ptr)

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare { i64, i1 } @llvm.umul.with.overflow.i64(i64, i64) #0

define i64 @"$main"(ptr %0) {
prologue:
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  store i64 3, ptr %r0, align 8
  br label %i1

i1:                                               ; preds = %i0
  store i64 1, ptr %r1, align 8
  br label %i2

i2:                                               ; preds = %i1
  store i64 0, ptr %r2, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 0, ptr %rr, align 8
  br label %i4

i4:                                               ; preds = %cont, %i3
  %rr.v = load i64, ptr %rr, align 8
  %r0.v = load i64, ptr %r0, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %rr.v, i64 %r0.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r0.v1 = load i64, ptr %r0, align 8
  %r1.v = load i64, ptr %r1, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r0.v1, i64 %r1.v)
  store i64 %ssub, ptr %r0, align 8
  br label %i6

i6:                                               ; preds = %i5
  %r0.v2 = load i64, ptr %r0, align 8
  %r2.v = load i64, ptr %r2, align 8
  %cmp = icmp eq i64 %r0.v2, %r2.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r3, align 8
  br label %i7

i7:                                               ; preds = %i6
  %guard = call i64 @rt_tick(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i8:                                               ; preds = %cont
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i7
  ret i64 0

cont:                                             ; preds = %i7
  %r3.v = load i64, ptr %r3, align 8
  %jz = icmp eq i64 %r3.v, 0
  br i1 %jz, label %i4, label %i8
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
;; ==== built: Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64)

declare i64 @rt_head(ptr, i64)

declare i64 @rt_tail(ptr, i64)

declare i64 @rt_is_empty(ptr, i64)

declare i64 @rt_box(ptr, i64)

declare i64 @rt_box_get(ptr, i64)

declare void @rt_box_set(ptr, i64, i64)

declare i64 @rt_tick(ptr)

declare i64 @rt_enter(ptr)

declare void @rt_leave(ptr)

declare i64 @rt_faulted(ptr)

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare { i64, i1 } @llvm.umul.with.overflow.i64(i64, i64) #0

; Function Attrs: optsize
define i64 @"$main"(ptr %0) #1 {
prologue:
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  store i64 3, ptr %r0, align 8
  br label %i1

i1:                                               ; preds = %i0
  store i64 1, ptr %r1, align 8
  br label %i2

i2:                                               ; preds = %i1
  store i64 0, ptr %r2, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 0, ptr %rr, align 8
  br label %i4

i4:                                               ; preds = %cont, %i3
  %rr.v = load i64, ptr %rr, align 8
  %r0.v = load i64, ptr %r0, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %rr.v, i64 %r0.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r0.v1 = load i64, ptr %r0, align 8
  %r1.v = load i64, ptr %r1, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r0.v1, i64 %r1.v)
  store i64 %ssub, ptr %r0, align 8
  br label %i6

i6:                                               ; preds = %i5
  %r0.v2 = load i64, ptr %r0, align 8
  %r2.v = load i64, ptr %r2, align 8
  %cmp = icmp eq i64 %r0.v2, %r2.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r3, align 8
  br label %i7

i7:                                               ; preds = %i6
  %guard = call i64 @rt_tick(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i8:                                               ; preds = %cont
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i7
  ret i64 0

cont:                                             ; preds = %i7
  %r3.v = load i64, ptr %r3, align 8
  %jz = icmp eq i64 %r3.v, 0
  br i1 %jz, label %i4, label %i8
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { optsize }
;; ==== built: Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64)

declare i64 @rt_head(ptr, i64)

declare i64 @rt_tail(ptr, i64)

declare i64 @rt_is_empty(ptr, i64)

declare i64 @rt_box(ptr, i64)

declare i64 @rt_box_get(ptr, i64)

declare void @rt_box_set(ptr, i64, i64)

declare i64 @rt_tick(ptr)

declare i64 @rt_enter(ptr)

declare void @rt_leave(ptr)

declare i64 @rt_faulted(ptr)

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare { i64, i1 } @llvm.umul.with.overflow.i64(i64, i64) #0

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) #1 {
prologue:
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  store i64 3, ptr %r0, align 8
  br label %i1

i1:                                               ; preds = %i0
  store i64 1, ptr %r1, align 8
  br label %i2

i2:                                               ; preds = %i1
  store i64 0, ptr %r2, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 0, ptr %rr, align 8
  br label %i4

i4:                                               ; preds = %cont, %i3
  %rr.v = load i64, ptr %rr, align 8
  %r0.v = load i64, ptr %r0, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %rr.v, i64 %r0.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r0.v1 = load i64, ptr %r0, align 8
  %r1.v = load i64, ptr %r1, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r0.v1, i64 %r1.v)
  store i64 %ssub, ptr %r0, align 8
  br label %i6

i6:                                               ; preds = %i5
  %r0.v2 = load i64, ptr %r0, align 8
  %r2.v = load i64, ptr %r2, align 8
  %cmp = icmp eq i64 %r0.v2, %r2.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r3, align 8
  br label %i7

i7:                                               ; preds = %i6
  %guard = call i64 @rt_tick(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i8:                                               ; preds = %cont
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i7
  ret i64 0

cont:                                             ; preds = %i7
  %r3.v = load i64, ptr %r3, align 8
  %jz = icmp eq i64 %r3.v, 0
  br i1 %jz, label %i4, label %i8
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
