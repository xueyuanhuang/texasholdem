# Use exact Cash Game settlement planning up to 12 non-zero balances

Cash Game Settlement Plans should be exact when the non-zero balance count is small enough for reliable mobile performance. We will generate a minimum-transfer Settlement Plan for Cash Games with up to 12 non-zero player balances; larger Cash Games fall back to an approximate greedy Settlement Plan and must be presented as approximate rather than optimal.
