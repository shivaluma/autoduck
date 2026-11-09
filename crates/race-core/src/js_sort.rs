//! `Array.prototype.sort(comparator)` as V8 runs it, for short arrays.
//!
//! With a consistent comparator any stable sort gives the same order as V8, so
//! most call sites can use `sort_by`. A comparator that is *not* a total order
//! (a NaN key: `NaN - x` is NaN, which V8 treats as `0`) makes the result
//! depend on the algorithm. For arrays shorter than 64 V8's TimSort
//! (`third_party/v8/builtins/array-sort.tq`) never merges: the minimum run is
//! the whole array, so it is one `CountAndMakeRun` followed by
//! `BinaryInsertionSort`. [`v8_sort_by`] ports exactly that, comparator call
//! for comparator call, so it reproduces V8 even for inconsistent
//! comparators. Longer arrays fall back to the standard stable sort, which
//! matches V8 only for consistent comparators.
//!
//! The comparator returns an [`Ordering`]; only `Less` is ever tested, as in
//! V8 (`order < 0`). Map a JS comparator result `r` to `Less` iff `r < 0`
//! (NaN is not `Less`), for example with `math::cmp_f64_js`.

use core::cmp::Ordering;

/// Arrays shorter than this are sorted by one binary insertion sort in V8.
pub const V8_MIN_MERGE: usize = 64;

/// Sorts `items` in place exactly like V8's `Array.prototype.sort(cmp)` for
/// `items.len() < 64` (see the module docs); a stable `sort_by` otherwise.
pub fn v8_sort_by<T>(items: &mut [T], mut compare: impl FnMut(&T, &T) -> Ordering) {
    let length = items.len();
    if length < 2 {
        return;
    }
    if length >= V8_MIN_MERGE {
        items.sort_by(compare);
        return;
    }
    let run = count_and_make_run(items, &mut compare);
    if run < length {
        binary_insertion_sort(items, run, &mut compare);
    }
}

/// `CountAndMakeRun(0, length)`: the length of the leading run, reversing it
/// in place when it is strictly descending.
fn count_and_make_run<T>(items: &mut [T], compare: &mut impl FnMut(&T, &T) -> Ordering) -> usize {
    let length = items.len();
    if length == 1 {
        return 1;
    }
    let mut run = 2;
    let descending = compare(&items[1], &items[0]) == Ordering::Less;
    let mut previous = 1;
    for index in 2..length {
        let less = compare(&items[index], &items[previous]) == Ordering::Less;
        if descending != less {
            break;
        }
        previous = index;
        run += 1;
    }
    if descending {
        items[..run].reverse();
    }
    run
}

/// `BinaryInsertionSort(0, start, length)`: `items[..start]` is sorted.
fn binary_insertion_sort<T>(
    items: &mut [T],
    start: usize,
    compare: &mut impl FnMut(&T, &T) -> Ordering,
) {
    for current in start..items.len() {
        let mut left = 0;
        let mut right = current;
        while left < right {
            let mid = left + ((right - left) >> 1);
            if compare(&items[current], &items[mid]) == Ordering::Less {
                right = mid;
            } else {
                left = mid + 1;
            }
        }
        items[left..=current].rotate_right(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec::Vec;

    #[test]
    fn sorts_and_is_stable() {
        let mut items: Vec<(u32, u32)> = [(3, 0), (1, 1), (3, 2), (2, 3), (1, 4), (0, 5)].into();
        v8_sort_by(&mut items, |a, b| a.0.cmp(&b.0));
        assert_eq!(items, [(0, 5), (1, 1), (1, 4), (2, 3), (3, 0), (3, 2)]);
    }

    #[test]
    fn descending_prefix_is_reversed() {
        let mut items: Vec<u32> = [5, 4, 3, 9, 1].into();
        v8_sort_by(&mut items, Ord::cmp);
        assert_eq!(items, [1, 3, 4, 5, 9]);
    }

    #[test]
    fn matches_std_for_every_permutation_of_six() {
        let mut base: Vec<u32> = (0..6).map(|v| v % 4).collect();
        for _ in 0..720 {
            let mut ours: Vec<(u32, usize)> = base.iter().copied().zip(0..).collect();
            let mut std_sorted = ours.clone();
            v8_sort_by(&mut ours, |a, b| a.0.cmp(&b.0));
            std_sorted.sort_by_key(|a| a.0);
            assert_eq!(ours, std_sorted);
            next_permutation(&mut base);
        }
    }

    /// Node 24 (V8 13.6) output of `[...input].sort((a, b) => a - b)` with NaN
    /// keys, where the comparator is not a total order.
    #[test]
    fn matches_v8_with_nan_keys() {
        const N: f64 = f64::NAN;
        let cases: [(&[f64], &[f64]); 5] = [
            (&[3.0, N, 1.0, 2.0, N, 0.0], &[3.0, N, 1.0, 2.0, N, 0.0]),
            (
                &[5.0, 4.0, N, 3.0, 2.0, 1.0, 0.0],
                &[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, N],
            ),
            (
                &[N, 2.0, 1.0, N, 0.0, 7.0, 3.0, 3.0, 1.0],
                &[N, 0.0, 1.0, 2.0, N, 1.0, 3.0, 3.0, 7.0],
            ),
            (
                &[1.0, 2.0, 3.0, N, 0.0, -1.0, 9.0, 8.0],
                &[-1.0, 1.0, 2.0, 3.0, N, 0.0, 8.0, 9.0],
            ),
            (
                &[
                    0.0, 7.0, 14.0, 21.0, 5.0, 12.0, 19.0, 3.0, 10.0, N, 1.0, 8.0, 15.0, 22.0, 6.0,
                    13.0, 20.0, 4.0, 11.0, 18.0, N, 9.0, 16.0, 0.0, 7.0, 14.0, 21.0, 5.0, 12.0,
                    19.0, 3.0, N, 17.0, 1.0, 8.0, 15.0, 22.0, 6.0, 13.0, 20.0,
                ],
                &[
                    0.0, 0.0, 1.0, 1.0, 3.0, 3.0, 4.0, 5.0, 5.0, 6.0, 6.0, 7.0, 7.0, 8.0, 8.0, 9.0,
                    10.0, 11.0, 12.0, 12.0, 13.0, 13.0, 14.0, 14.0, 15.0, 15.0, 16.0, 17.0, 18.0,
                    19.0, 21.0, N, 19.0, 20.0, 20.0, 22.0, N, 21.0, N, 22.0,
                ],
            ),
        ];
        for (input, expected) in cases {
            let mut items: Vec<f64> = input.to_vec();
            v8_sort_by(&mut items, |a, b| crate::math::cmp_f64_js(*a, *b));
            let same = items
                .iter()
                .zip(expected)
                .all(|(a, b)| a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan()));
            assert!(
                same && items.len() == expected.len(),
                "{input:?} -> {items:?}"
            );
        }
    }

    fn next_permutation(items: &mut [u32]) {
        let Some(i) = (1..items.len()).rev().find(|&i| items[i - 1] < items[i]) else {
            items.reverse();
            return;
        };
        let j = (i..items.len())
            .rev()
            .find(|&j| items[j] > items[i - 1])
            .unwrap_or(i);
        items.swap(i - 1, j);
        items[i..].reverse();
    }
}
