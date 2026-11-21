"""The US pack's impact rules, added to the built-in tracks for a US institution only.

Written like app/tracks.py (one mechanism a line, the same helpers). Metric keys and segment values are
the Metrics Spec's (server/app/spec/metrics_spec_v1.json): large_depositor_net_flow and balance for
deposits, facility_utilization for working-capital lines (by sector or segment), and the segments
domestic_business and non_bank_financial (private-credit lenders).

A rule has one direction, and a fallback metric inherits it: every metric a rule lists must move the same way
(both of sector_burn's fall). sector_burn reads business current accounts only, not staff savings.
"""

from app.tracks import Mechanism, T

M = Mechanism
MECHANISMS: list[Mechanism] = [
    # ------------------------------------------------------------ savings
    M("savings.flows.sector_burn", (T("sector:shock"),), "businesses in the hit sector burn cash and draw down deposits",
      ("large_depositor_net_flow", "balance"), "fall", "weeks", segment_value="domestic_business",
      only_spec_types=("current_account",)),
    # ------------------------------------------------------- business_loan
    M("business_loan.utilization.sector", (T("sector:shock"),),
      "contractors in the hit sector draw harder on credit lines as projects stall",
      ("facility_utilization",), "rise", "weeks", segment_dim="sector"),
    M("business_loan.utilization.nbfi_stress", (T("trust:rival"), T("macro:worse")),
      "private-credit lenders draw their bank lines when their own funding tightens",
      ("facility_utilization",), "rise", "weeks", segment_value="non_bank_financial"),
]  # fmt: skip
