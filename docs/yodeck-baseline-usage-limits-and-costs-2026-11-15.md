# TINNOX: Yodeck baseline, customer usage limits, and revised hosting costs

**Date:** November 15, 2026. **Scope:** Cost and product-policy analysis; no implementation changes.  
**Currency:** AUD estimates use US$1 = A$1.50, excluding GST. This is a planning conversion, not a live FX quote.  
**Related report:** [Deployment options and rate ledger](deployment-cost-comparison-2026-11-15.md).

## 1. What the earlier estimate did—and did not—establish

The earlier estimate included file storage, media delivery, and control communication. However, **5 GiB of media downloads per player per month was a planning assumption, not a measured TINNOX workload or a published Yodeck customer average**. Its estimated control egress was about 52.7 MiB/player/month for a proposed 60-second check-in. Library size and worker runtime were also assumptions.

It did not establish customer entitlements or a maximum cost per customer. In particular, a per-file upload limit cannot bound total storage, repeated uploads, processing, or delivery to many players.

This revision uses verified Yodeck behavior as a reference, makes the remaining assumptions visible, and models proposed customer allowances. It updates the workload assumptions, not the provider rates or deployment options in the earlier report.

## 2. The verified Yodeck baseline

| Published fact | Evidence | Meaning for TINNOX |
|---|---|---|
| Individual uploads up to **5 GB** | Yodeck file-size documentation, updated July 31, 2025 [Y1] | A product-capability reference, not a monthly allowance or typical file size |
| Control communication up to **300 MB/player/month** | Bandwidth guidance, updated October 29, 2026 [Y2] | A useful conservative traffic reference; it does not reveal request counts or direction split |
| Static content is downloaded locally; its example is a **2 GB** media set | Same bandwidth guidance [Y2] | Replaying cached content does not require repeated full downloads |
| Cloud storage and bandwidth marketed as unlimited, subject to fair use | Feature list and bandwidth FAQ [Y3, Y4] | No numeric typical usage or contractual finite budget can be derived from these pages |
| Video re-encoding is part of its delivery workflow, with an as-is option for suitable files | Re-encoding documentation [Y5] | Full feature parity would require an encoding workload and cost model |

**Do not interpret 5 GB/file as 5 GB/player/month, or 300 MB as a limit on media delivery.** We also cannot infer Yodeck's private polling interval, AWS bill, negotiated discounts, or average customer utilization from these sources.

## 3. Four separate quantities must be controlled

| Quantity | Example | Main cost or risk |
|---|---|---|
| Maximum individual upload | One 200 MiB video | Upload reliability, validation resources, decoding and playback compatibility |
| Stored library per customer | 55 GiB shared by a 100-player customer | Object storage, retained versions, backup policy |
| Media delivered to players | One 200 MiB file sent to 100 players | About 19.5 GiB of download traffic, even though only one source object is stored |
| Processing work | Repeated video uploads or new output renditions | Worker CPU/GPU time, temporary storage, queues |

Control traffic is a fifth, operator-managed budget. Customers should not have to buy extra heartbeat allowance to keep their players healthy.

A **200 MiB** file distributed to 100 players once produces about **US$2.23 / A$3.34** in AWS internet egress at the first Sydney rate. Replacing it daily for 30 days is about **US$66.80 / A$100.20**, before other costs. Thus a modest file-size limit alone still permits substantial transfer spending.

The relevant media-delivery formula is:

```text
Monthly media delivery = sum over each player of newly needed asset bytes
                        + repeated/range/retry transfer bytes
```

Publishing the same unchanged, already cached assets need not redownload them. Publishing new bytes to 100 independent players usually creates 100 downloads. Sharing content within an account saves storage; it does not automatically deduplicate network delivery across devices.

## 4. Proposed initial customer allowances

These are **TINNOX proposals for a controlled MVP**, not Yodeck limits, approved sales terms, or features already implemented. They intentionally offer a narrower upload capability than Yodeck while hardware and processing are being validated.

| Control | Proposed starting policy | Basis and qualification |
|---|---|---|
| File size | Keep **200 MiB per file** initially | Matches the current default; increasing it needs upload, parser, cache, and hardware tests |
| Video compatibility | Publish an explicit supported codec/container/resolution profile for the tested player; retain the current 10-minute duration ceiling initially | The current size limit and duration limit both apply; 200 MiB is only about 3.5 minutes at 8 Mb/s |
| Shared customer storage | **5 GiB per account + 0.5 GiB per licensed player** | Proposed entitlement, pooled within that account; 100 players receive 55 GiB |
| Media downloads | **10 GiB per licensed player/month**, pooled within the customer account | Proposed commercial allowance, providing room above the 8.8 GiB scenario below; 100 players receive 1,000 GiB/month |
| Active content on each player | Initially plan for **2 GiB** of assigned assets | A sizing scenario, not a universal hardware guarantee. Reserve room for both old and new content during updates, plus system/runtime space |
| Control traffic | Included in subscription; internal reserve **300 MiB/player/month** | Rounded conservatively from Yodeck's published reference, not a customer-facing traffic cap |
| Processing | Initially validate already-supported media; no promise to convert arbitrary video formats | Limits exposure while a separate encoding benchmark is developed |

The shared storage allowance is separate from downloads and local player capacity. A 100-player customer storing 55 GiB does not mean every player downloads all 55 GiB. The account could share a small playlist or assign different content by location.

For the monthly media allowance, define the counted bytes precisely: asset bytes delivered from TINNOX to players, including partial downloads and range requests. Track all provider-billed retries internally; do not charge customers twice for retries caused by TINNOX faults. Such excluded retries need a separate internal reserve. Control traffic is excluded from the commercial media quota. Initial installation must be included in an onboarding allowance or clearly stated as consuming the monthly allowance; it is not free to TINNOX.

Show usage and forecasts in the portal. Notify customers before exhaustion and offer an agreed upgrade or overage arrangement. Preserve cached playback if a limit is reached; do not blank a screen. If there is no paid-overage agreement, defer new large deliveries after the included allowance is exhausted, with explicit customer-visible status. Do not silently bill an uncapped amount.

A long-term Yodeck-like fair-use offering may be commercially attractive, but first measure tenant usage distributions and margins. “Unlimited” is not a bounded costing input. If 5 GB uploads are a sales requirement, treat that as a separate engineering milestone with multipart/resumable uploads, validation isolation, concurrency limits, and an encoding budget.

## 5. Revised workload scenarios

Use a **2 GiB active media set** as a rounded planning interpretation of Yodeck's 2 GB example. Yodeck does not say that this is an average customer. Update frequency is our scenario choice, not a Yodeck statistic.

| Scenario | Assumed new media per player | Delivery allowance including 10% transfer overhead |
|---|---|---:|
| Low-change signage | Replace 10% of the 2 GiB set once per month | **0.22 GiB/month** |
| Regular campaign changes | Replace the entire set four times per month | **8.8 GiB/month** |
| Proposed plan fully used | Counted delivery reaches the proposed entitlement | **10 GiB/month**, already inclusive of counted delivery bytes |
| Frequent replacement stress test | Replace the entire set daily for 30 days | **66 GiB/month** |

The 10% overhead is an assumption for retries/partial transfers, not a measured provider figure or a guaranteed bound. The full-allowance case does not add another 10% on top. Fault-related usage excluded from customer billing can exceed the allowance and must be monitored separately.

At first installation, add **2.2 GiB/player** for the initial 2 GiB cache fill plus overhead, if this is additional to the modeled replacements. At 1,000 players, adding this to the regular scenario increases AWS egress by approximately **A$349** that month, after applying transfer tiers. It may push a customer beyond the proposed monthly media allowance; agree on onboarding treatment before selling the plan.

For control traffic, reserve **300 MiB/player/month** and conservatively price the entire reserve as outbound cloud traffic. Yodeck's 300 MB reference does not specify how much is inbound versus outbound, and MB/MiB differ. This intentionally overbudgets that reference rather than claiming it is a measured AWS egress value.

Keep the proposed 60-second combined check-in for request-count calculations. **A monthly byte reference does not determine request volume.** WAF, API CPU, database work, and logging still depend on TINNOX's actual protocol. No change to that protocol was made for this analysis.

## 6. Revised monthly infrastructure estimates

The following uses the regular **8.8 GiB/player/month** scenario, **300 MiB/player/month** of control egress reserve, and assumes all proposed customer storage entitlements are used, plus 20% for retained versions/renditions. Customer counts remain 5 / 10 / 10 / 10 across the four fleet sizes.

That produces billed media storage of **45 / 120 / 360 / 660 GiB** respectively. The entitlement formula is a proposed product policy; the previous library-size guesses are no longer used in these tables.

| Deployment, AUD/month | 25 players | 100 players | 500 players | 1,000 players |
|---|---:|---:|---:|---:|
| AWS pilot | A$272 | A$419 | A$1,333 | A$2,255 |
| AWS EC2 with failover | A$641 | A$795 | A$1,939 | A$2,910 |
| AWS Fargate with failover | A$639 | A$792 | A$1,926 | A$2,918 |
| DigitalOcean, conditional | A$561 | A$586 | A$854 | A$1,023 |

These are hosting estimates, not subscription prices. They retain the earlier CPU/RAM, database, worker-hour, administrative-egress, monitoring, and networking assumptions. EC2/Fargate failover options remain the production comparison; the single-server option is a pilot. DigitalOcean retains the earlier report's unresolved Advanced Edition preview, availability, and residency qualifications.

For AWS Fargate with failover, the regular scenario suggests budgets including 20% contingency of approximately **A$951/month for 100 players** and **A$3,501/month for 1,000 players**.

The changes from the prior estimate are traceable:

| Change from previous AWS Fargate estimate, USD/month | 100 players | 1,000 players |
|---|---:|---:|
| Previous total | 482.26 | 1,482.87 |
| Media: 5 → 8.8 GiB/player | 43.32 | 433.20 |
| Control: previous allowance → 300 MiB/player | 2.75 | 27.53 |
| Storage: fully used proposed account quotas | 0.00 | 1.50 |
| More media GETs at assumed 50 MiB mean size | 0.00 | 0.04 |
| **Revised total** | **528.33** | **1,945.13** |

The increase comes mainly from more downloaded media, not the larger control reserve. The revised regular scenario costs about **A$792/month at 100 players** and **A$2,918/month at 1,000 players**, versus the previous A$723 and A$2,224.

### Sensitivity and the proposed allowance ceiling

| Media use per player/month | 100-player AWS production | 1,000-player AWS production | 1,000-player budget with 20% contingency |
|---|---:|---:|---:|
| Low change: 0.22 GiB | A$646 | A$1,450 | A$1,740 |
| Four full refreshes: 8.8 GiB | A$792 | A$2,918 | A$3,501 |
| Full proposed allowance: 10 GiB | A$813 | A$3,119 | A$3,743 |
| Daily refresh stress case: 66 GiB | A$1,771 | A$11,261 | A$13,513 |

The 1,000-player full-allowance case gives a useful **media-and-storage planning envelope: approximately A$3,119/month, or A$3,743 with 20% contingency**. It is not an absolute cloud bill cap: additional processing, logs, API traffic, provider incidents, and non-chargeable retries remain variable.

The daily-refresh row is a **transfer stress test with the other resources held constant**, not a fully sized high-volume processing service. It would exceed the proposed standard media allowance and need a separately priced plan. Its worker/database requirements may increase the actual total further.

If TINNOX keeps the current two 15-second loops, the regular AWS Fargate scenario becomes at least approximately **A$824/month for 100 players** or **A$3,237/month for 1,000 players**, with the same hardware. This uses the greater of the 300 MiB reserve and the earlier request-based egress estimate, and updates WAF requests. It still does not prove that the same hardware/log budget can handle the higher traffic.

## 7. Important gap: transcoding and repeated uploads

The current worker uses image inspection and `ffprobe` validation; it is not a general-purpose video transcoding pipeline. The retained worker budget therefore cannot be presented as the cost of matching Yodeck's media conversion service.

Upload size is especially poor as the only predictor of encoding cost. Duration, resolution, codec, output renditions, and required completion time all matter. A customer could repeatedly upload and delete files while staying below its storage quota, generating substantial processing work.

Before offering conversion, benchmark representative files and calculate:

```text
Processing cost = sum(job runtime × worker rate)
                  + temporary storage + output rendition storage
                  + output delivery + retry work
```

Then set an explicit processing entitlement or upload-ingestion allowance, concurrent-job limit, queue limit, and timeout. Do not guess a competitive “unlimited transcoding” promise from the 5 GB upload limit. The current report preserves **40 / 80 / 200 / 400 worker hours/month** only for the earlier inspection-oriented scope; those hours are not validated against Yodeck usage.

## 8. Existing implementation and required future work

Read-only observations from `packages/contracts/src/limits.ts`:

- Default maximum upload: **200 MiB**.
- Default organization storage: **5 GiB**, not the proposed account-plus-player formula.
- Default video duration ceiling: **10 minutes**.
- Default dimension ceiling: **3840 × 2160**, which is not a guarantee that every target player can decode every accepted file smoothly.
- Absolute asset-size ceiling in shared contracts: **2 GiB**. Supporting Yodeck's 5 GB uploads is not just increasing the default environment setting.
- Default heartbeat: **15 seconds**, with a separate 15-second manifest polling loop.

`apps/api/src/routes/media.ts` contains checks against the configured upload and organization-storage limits. This review did not audit all concurrency, deletion, or retained-version accounting paths. There is no monthly-delivery entitlement in the inspected limits schema; the proposed policy is not established as implemented.

Future billing/usage work should record tenant attribution for storage, object delivery, and processing. Issuing a signed URL is not proof of how many bytes were downloaded. Use storage access/delivery records and reconciliation against provider billing; account for retries, partial responses, and delayed logs. Hard delivery enforcement may require shorter-lived authorizations and admission checks before large publications, since already issued download URLs remain usable until expiry. Avoid storing credentials or signed query strings in usage logs.

The next decision is therefore **which limits TINNOX wants to sell**, followed by a real-player trial measuring bytes/player/day, unique uploaded media, cache misses, retry rates, and processing minutes. Use measured percentiles across tenants to refine the plan, rather than assuming all customers behave like the same example.

## Appendix: reproducible changes and sources

All provider rates and architecture exclusions are inherited from the [November 15 deployment report](deployment-cost-comparison-2026-11-15.md). AWS internet transfer uses the first 10,240 GiB at US$0.114, the next 40,960 at US$0.098, and the next 102,400 at US$0.094. The third tier matters for the 66 GiB × 1,000-player stress case. No shared AWS free egress is deducted. S3 storage is US$0.025/GiB-month at these sizes.

```text
N = players; T = customer accounts; M = monthly delivered media GiB/player
Account storage entitlement summed across fleet = 5 × T + 0.5 × N
Billed media storage = entitlement × 1.20
Control reserve = N × 300 / 1,024 GiB
Total AWS outbound = N × M + control reserve + existing administrative egress
Media GETs = N × ceil(M × 1,024 / 50) + 10,000
            [50 MiB mean requested object; assumption, not Yodeck data]
Baseline check-ins = N × 43,200/month, plus existing 10% WAF request allowance
Revised total = original total - original media storage/GET/egress charges
                + revised media storage/GET/egress charges
AUD = USD × 1.50; contingency budget = AUD × 1.20
```

The existing PUT budgets remain unchanged; they represent separate upload assumptions, not one new source upload per player download. The full-allowance comparison keeps hardware fixed. Report totals use unrounded values, so rounded components may differ slightly.

For DigitalOcean, substitute the revised storage entitlement plus the existing database-backup reserve into the Spaces allowance, and use the revised media download total for Spaces overage. Control/admin traffic remains within the modeled Droplet transfer allowance. This does not resolve its production-selection gates.

Official Yodeck sources checked November 15, 2026:

- **Y1:** [File-size limit](https://www.yodeck.com/docs/user-manual/file-size-limitation-on-the-yodeck-portal-2/) — 5 GB individual upload capability.
- **Y2:** [Bandwidth usage](https://www.yodeck.com/docs/user-manual/how-much-bandwidth-does-yodeck-use/) — control-traffic reference and local-download example.
- **Y3:** [Feature comparison](https://www.yodeck.com/features-list/) — advertised storage/bandwidth and fair-use qualification.
- **Y4:** [Bandwidth-limit FAQ](https://www.yodeck.com/docs/user-manual/is-there-a-bandwidth-limit-for-media-uploaded-or-downloaded-on-yodeck/) — usage policy, without a numeric ordinary-customer threshold.
- **Y5:** [Video re-encoding and as-is uploads](https://www.yodeck.com/docs/user-manual/bypassing-video-re-encoding-as-is-upload/) — conversion capability and exceptions.

These sources inform product behavior; none publishes the workload distribution needed to claim an average Yodeck customer's cost. No customer terms were published and no implementation was modified.
