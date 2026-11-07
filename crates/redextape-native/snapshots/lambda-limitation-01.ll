;; lambda-limitation-01
;; source:
;;   let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc
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
  %a0 = alloca i64, align 8
  store i64 0, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  store i64 0, ptr %r0, align 8
  br label %i1

i1:                                               ; preds = %i0
  br label %i7

i7:                                               ; preds = %i1
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i8

i8:                                               ; preds = %i7
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i9

i9:                                               ; preds = %i8
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i10:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r0, align 8
  br label %i11

i11:                                              ; preds = %i10
  store i64 0, ptr %r1, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r4, align 8
  br label %i13

i13:                                              ; preds = %i12
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a0, align 8
  br label %i14

i14:                                              ; preds = %i13
  %guard2 = call i64 @rt_enter(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i15:                                              ; preds = %cont4
  %rr.v7 = load i64, ptr %rr, align 8
  store i64 %rr.v7, ptr %r0, align 8
  br label %i16

i16:                                              ; preds = %i15
  store i64 0, ptr %r3, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r0.v8 = load i64, ptr %r0, align 8
  store i64 %r0.v8, ptr %rr, align 8
  br label %i18

i18:                                              ; preds = %i17
  %rr.v9 = load i64, ptr %rr, align 8
  ret i64 %rr.v9

exit:                                             ; preds = %i14, %i9
  ret i64 0

cont:                                             ; preds = %i9
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @bump.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i10

cont4:                                            ; preds = %i14
  %a0.v5 = load i64, ptr %a0, align 8
  %call6 = call i64 @bump.0(ptr %0, i64 %a0.v5)
  store i64 %call6, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i15
}

define private i64 @bump.0(ptr %0, i64 %1) {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i2

i2:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i3

i3:                                               ; preds = %i2
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r1, align 8
  br label %i4

i4:                                               ; preds = %i3
  store i64 1, ptr %r2, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r2.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i6

i6:                                               ; preds = %i5
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; No predecessors!
  ret i64 0
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
  %a0 = alloca i64, align 8
  store i64 0, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  store i64 0, ptr %r0, align 8
  br label %i1

i1:                                               ; preds = %i0
  br label %i7

i7:                                               ; preds = %i1
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i8

i8:                                               ; preds = %i7
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i9

i9:                                               ; preds = %i8
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i10:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r0, align 8
  br label %i11

i11:                                              ; preds = %i10
  store i64 0, ptr %r1, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r4, align 8
  br label %i13

i13:                                              ; preds = %i12
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a0, align 8
  br label %i14

i14:                                              ; preds = %i13
  %guard2 = call i64 @rt_enter(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i15:                                              ; preds = %cont4
  %rr.v7 = load i64, ptr %rr, align 8
  store i64 %rr.v7, ptr %r0, align 8
  br label %i16

i16:                                              ; preds = %i15
  store i64 0, ptr %r3, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r0.v8 = load i64, ptr %r0, align 8
  store i64 %r0.v8, ptr %rr, align 8
  br label %i18

i18:                                              ; preds = %i17
  %rr.v9 = load i64, ptr %rr, align 8
  ret i64 %rr.v9

exit:                                             ; preds = %i14, %i9
  ret i64 0

cont:                                             ; preds = %i9
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @bump.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i10

cont4:                                            ; preds = %i14
  %a0.v5 = load i64, ptr %a0, align 8
  %call6 = call i64 @bump.0(ptr %0, i64 %a0.v5)
  store i64 %call6, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i15
}

; Function Attrs: optsize
define private i64 @bump.0(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i2

i2:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i3

i3:                                               ; preds = %i2
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r1, align 8
  br label %i4

i4:                                               ; preds = %i3
  store i64 1, ptr %r2, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r2.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i6

i6:                                               ; preds = %i5
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; No predecessors!
  ret i64 0
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
  %a0 = alloca i64, align 8
  store i64 0, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  store i64 0, ptr %r0, align 8
  br label %i1

i1:                                               ; preds = %i0
  br label %i7

i7:                                               ; preds = %i1
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i8

i8:                                               ; preds = %i7
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i9

i9:                                               ; preds = %i8
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i10:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r0, align 8
  br label %i11

i11:                                              ; preds = %i10
  store i64 0, ptr %r1, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r4, align 8
  br label %i13

i13:                                              ; preds = %i12
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a0, align 8
  br label %i14

i14:                                              ; preds = %i13
  %guard2 = call i64 @rt_enter(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i15:                                              ; preds = %cont4
  %rr.v7 = load i64, ptr %rr, align 8
  store i64 %rr.v7, ptr %r0, align 8
  br label %i16

i16:                                              ; preds = %i15
  store i64 0, ptr %r3, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r0.v8 = load i64, ptr %r0, align 8
  store i64 %r0.v8, ptr %rr, align 8
  br label %i18

i18:                                              ; preds = %i17
  %rr.v9 = load i64, ptr %rr, align 8
  ret i64 %rr.v9

exit:                                             ; preds = %i14, %i9
  ret i64 0

cont:                                             ; preds = %i9
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @bump.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i10

cont4:                                            ; preds = %i14
  %a0.v5 = load i64, ptr %a0, align 8
  %call6 = call i64 @bump.0(ptr %0, i64 %a0.v5)
  store i64 %call6, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i15
}

; Function Attrs: minsize optsize
define private i64 @bump.0(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i2

i2:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i3

i3:                                               ; preds = %i2
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r1, align 8
  br label %i4

i4:                                               ; preds = %i3
  store i64 1, ptr %r2, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r2.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i6

i6:                                               ; preds = %i5
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; No predecessors!
  ret i64 0
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
