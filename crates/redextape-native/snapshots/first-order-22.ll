;; first-order-22
;; source:
;;   tail([1, 2, 3])
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
  %r4 = alloca i64, align 8
  store i64 0, ptr %r4, align 8
  %r5 = alloca i64, align 8
  store i64 0, ptr %r5, align 8
  %r6 = alloca i64, align 8
  store i64 0, ptr %r6, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  store i64 1, ptr %r1, align 8
  br label %i1

i1:                                               ; preds = %i0
  store i64 2, ptr %r3, align 8
  br label %i2

i2:                                               ; preds = %i1
  store i64 3, ptr %r5, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 0, ptr %r6, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r5.v = load i64, ptr %r5, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r5.v, i64 %r6.v)
  store i64 %cons, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i5:                                               ; preds = %cont
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cons1 = call i64 @rt_cons(ptr %0, i64 %r3.v, i64 %r4.v)
  store i64 %cons1, ptr %r2, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i6:                                               ; preds = %cont4
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %cons5 = call i64 @rt_cons(ptr %0, i64 %r1.v, i64 %r2.v)
  store i64 %cons5, ptr %r0, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i7:                                               ; preds = %cont8
  %r0.v = load i64, ptr %r0, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r0.v)
  store i64 %tail, ptr %rr, align 8
  %guard9 = call i64 @rt_faulted(ptr %0)
  %trip10 = icmp ne i64 %guard9, 0
  br i1 %trip10, label %exit, label %cont11

i8:                                               ; preds = %cont11
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i7, %i6, %i5, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i5
  br label %i6

cont8:                                            ; preds = %i6
  br label %i7

cont11:                                           ; preds = %i7
  br label %i8
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
  %r4 = alloca i64, align 8
  store i64 0, ptr %r4, align 8
  %r5 = alloca i64, align 8
  store i64 0, ptr %r5, align 8
  %r6 = alloca i64, align 8
  store i64 0, ptr %r6, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  store i64 1, ptr %r1, align 8
  br label %i1

i1:                                               ; preds = %i0
  store i64 2, ptr %r3, align 8
  br label %i2

i2:                                               ; preds = %i1
  store i64 3, ptr %r5, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 0, ptr %r6, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r5.v = load i64, ptr %r5, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r5.v, i64 %r6.v)
  store i64 %cons, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i5:                                               ; preds = %cont
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cons1 = call i64 @rt_cons(ptr %0, i64 %r3.v, i64 %r4.v)
  store i64 %cons1, ptr %r2, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i6:                                               ; preds = %cont4
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %cons5 = call i64 @rt_cons(ptr %0, i64 %r1.v, i64 %r2.v)
  store i64 %cons5, ptr %r0, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i7:                                               ; preds = %cont8
  %r0.v = load i64, ptr %r0, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r0.v)
  store i64 %tail, ptr %rr, align 8
  %guard9 = call i64 @rt_faulted(ptr %0)
  %trip10 = icmp ne i64 %guard9, 0
  br i1 %trip10, label %exit, label %cont11

i8:                                               ; preds = %cont11
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i7, %i6, %i5, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i5
  br label %i6

cont8:                                            ; preds = %i6
  br label %i7

cont11:                                           ; preds = %i7
  br label %i8
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
  %r4 = alloca i64, align 8
  store i64 0, ptr %r4, align 8
  %r5 = alloca i64, align 8
  store i64 0, ptr %r5, align 8
  %r6 = alloca i64, align 8
  store i64 0, ptr %r6, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  store i64 1, ptr %r1, align 8
  br label %i1

i1:                                               ; preds = %i0
  store i64 2, ptr %r3, align 8
  br label %i2

i2:                                               ; preds = %i1
  store i64 3, ptr %r5, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 0, ptr %r6, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r5.v = load i64, ptr %r5, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r5.v, i64 %r6.v)
  store i64 %cons, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i5:                                               ; preds = %cont
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cons1 = call i64 @rt_cons(ptr %0, i64 %r3.v, i64 %r4.v)
  store i64 %cons1, ptr %r2, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i6:                                               ; preds = %cont4
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %cons5 = call i64 @rt_cons(ptr %0, i64 %r1.v, i64 %r2.v)
  store i64 %cons5, ptr %r0, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i7:                                               ; preds = %cont8
  %r0.v = load i64, ptr %r0, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r0.v)
  store i64 %tail, ptr %rr, align 8
  %guard9 = call i64 @rt_faulted(ptr %0)
  %trip10 = icmp ne i64 %guard9, 0
  br i1 %trip10, label %exit, label %cont11

i8:                                               ; preds = %cont11
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i7, %i6, %i5, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i5
  br label %i6

cont8:                                            ; preds = %i6
  br label %i7

cont11:                                           ; preds = %i7
  br label %i8
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
