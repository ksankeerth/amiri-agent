"""The small amount of statistics the validator needs, in plain Python.

No SciPy: Student's t CDF comes from the regularized incomplete beta function
(continued fraction, Numerical Recipes §6.4), which is exact to ~1e-10 here.
"""

import math
from statistics import fmean, median, stdev

Z95 = 1.959963984540054


def mad(values: list[float]) -> float:
    m = median(values)
    return median(abs(v - m) for v in values)


def normal_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _betacf(a: float, b: float, x: float) -> float:
    tiny, eps = 1e-300, 3e-16
    qab, qap, qam = a + b, a + 1, a - 1
    c, d = 1.0, 1 - qab * x / qap
    d = 1 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1 + aa * d
        d = 1 / (d if abs(d) > tiny else tiny)
        c = 1 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1 + aa * d
        d = 1 / (d if abs(d) > tiny else tiny)
        c = 1 + aa / c
        c = c if abs(c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1) < eps:
            break
    return h


def _betainc(a: float, b: float, x: float) -> float:
    """Regularized incomplete beta I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    ln = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    front = math.exp(ln + a * math.log(x) + b * math.log(1 - x))
    if x < (a + 1) / (a + b + 2):
        return front * _betacf(a, b, x) / a
    return 1 - front * _betacf(b, a, 1 - x) / b


def t_cdf(t: float, df: float) -> float:
    x = df / (df + t * t)
    tail = 0.5 * _betainc(df / 2, 0.5, x)
    return 1 - tail if t > 0 else tail


def empirical_percentile(value: float, sample: list[float]) -> float:
    """Where value sits in sample, 0-100 (mid-rank for ties)."""
    below = sum(1 for s in sample if s < value)
    equal = sum(1 for s in sample if s == value)
    return 100 * (below + 0.5 * equal) / len(sample)


def t_prediction_percentile(value: float, sample: list[float]) -> float | None:
    """Percentile of a new value under a t prediction interval from sample.

    x_new ~ mean + t(n-1) * s * sqrt(1 + 1/n). None if the sample has no spread.
    """
    n = len(sample)
    if n < 3:
        return None
    s = stdev(sample)
    if s == 0:
        return None
    t = (value - fmean(sample)) / (s * math.sqrt(1 + 1 / n))
    return 100 * t_cdf(t, n - 1)


def wilson(successes: float, trials: float, z: float = Z95) -> tuple[float, float]:
    """95% Wilson interval for a proportion (0-1)."""
    if trials <= 0:
        return 0.0, 1.0
    p = successes / trials
    denom = 1 + z * z / trials
    centre = (p + z * z / (2 * trials)) / denom
    half = z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def newcombe_difference(
    x1: float, n1: float, x2: float, n2: float
) -> tuple[float, float]:
    """95% interval for p2 - p1 (Newcombe's hybrid score method), as proportions."""
    p1, p2 = x1 / n1, x2 / n2
    l1, u1 = wilson(x1, n1)
    l2, u2 = wilson(x2, n2)
    d = p2 - p1
    return d - math.sqrt((p2 - l2) ** 2 + (u1 - p1) ** 2), d + math.sqrt(
        (u2 - p2) ** 2 + (p1 - l1) ** 2
    )


def line_fit(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """Least squares y = a + b x. Returns (a, b, residual standard deviation)."""
    n = len(xs)
    mx, my = fmean(xs), fmean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    b = (
        sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / sxx
        if sxx
        else 0.0
    )
    a = my - b * mx
    res = [y - (a + b * x) for x, y in zip(xs, ys, strict=True)]
    sd = math.sqrt(sum(r * r for r in res) / (n - 2)) if n > 2 else 0.0
    return a, b, sd
