# Security review — 30 October 2026

This is a targeted source review, not a penetration test or proof that every endpoint is secure. Automated/runtime tests were not run. Backend/frontend TypeScript, changed frontend-file lint, and production builds were run successfully. The additive migration was deployed to the verified local database after backup; migration status reports all 21 migrations up to date.

## Reviewed and changed

- Costing: aggregate balance row locks serialize incoming WAC and outgoing snapshots. Only new verified cost snapshots carry `costMethod=WAC`; unknown legacy costs remain nullable and are not silently converted to zero. Historical COGS is not fabricated or backfilled. Opening-cost initialization requires adjustment approval permission and monetary policy, a quantity snapshot, and an audited reason.
- Sale: generic completion and legacy reservation-consumption code removed. Shipment is the sole operational Sale stock-issue path. Partial fulfillment preserves progress, and completion requires all quantities shipped and all shipments completed. Expiry-release processing locks the Sale and checks for active shipments before release.
- Receiving: zero accepted / positive damaged quantity is valid. Accepted and damaged receipt rows, allocations, costs and aggregate quantities are committed together; damaged goods enter a quarantine location, not available stock.
- Quarantine: warehouse scope, permission, positive quantity, unreserved balance, active destination, expiry and batch status are rechecked on review. Requests require a different reviewer. Scrap and supplier returns reduce physical stock atomically; releases move location balances without changing warehouse quantity. Supplier returns require RETURN monetary authority and documented receipt quantities; resulting posted returns are linked to their decision and audit log.
- Settlements: serialize on source invoice and return. Return value, paid overage, cash refund ceiling, remaining credit and target outstanding balance are checked using Decimal. Credit applications lock both source/target in sorted order and require the same supplier or non-anonymous customer, domain read permission and warehouse access. Settlements are immutable, use global request idempotency when supplied, and record audit events.
- Payments/cancellation: invoice reads required for payment mutations, exact one relation, paid limits after posted returns and credits, no void through ordinary edit, no void of cash funding an existing refund, and no invoice cancellation that discards recorded stock or financial entries. Editing a paid payment's metadata does not incorrectly revalidate it as a fresh payment after a return.
- Concurrency cleanup: transfer completion and adjustment status changes recheck status under a row lock; cancellation uses compare-and-set. Dead creation-time posting blocks and duplicate finance endpoints removed. Transaction conflicts and constraint failures receive a non-sensitive conflict response.
- Modularization: inventory reporting/relocation, valuation, settlement and quarantine have dedicated route modules mounted behind the same authentication, origin, CSRF and idempotency middleware. No database role-permission presets were overwritten.

- Attachment list, upload, download, and deletion: check the document-specific permission and warehouse scope, and require a real source document.
- Operations options: limit supplier, customer, purchase, sale and expense references by their respective read permissions and warehouse scope.
- Dashboard transaction aggregates and supplier analytics: restrict data by domain permission; supplier analytics also uses scoped queries.
- Inventory analytics: require inventory and report permissions; report-authorized users can view recorded inventory cost. Purchase-incoming data additionally requires purchase permission, with warehouse scope on both.
- Sale reservation release: require `sales.write`, warehouse scope, an audit reason, a sale row lock and no active shipment; recorded sales in fulfillment must use fulfillment actions rather than generic status edits.
- Return inspection: require the return type's write permission and warehouse scope, lock the return, record actor and audit event, and avoid changing stock directly.
- Attention notifications: query only authorized document types and warehouses, and deduplicate by user, document, status and update timestamp.
- Stock-opname count updates, submission, and approval now lock the session row; approval checks whether physical stock has changed since the snapshot and rejects stale counts. Approval runs at serializable isolation. This guards against applying a variance to a changed balance, but operational testing is still required.
- Purchase status updates now recheck status under a document lock and require the receiving action for `RECEIVED`, so a generic status edit cannot bypass goods receipt creation.

## Remaining review and verification

- Independent end-to-end security certification remains out of scope. Runtime verification must cover concurrent receiving/shipments/transfers/opnames, unknown-cost initialization, rejected/self-approved quarantine decisions, return/refund/credit races, idempotent retries and changed role/warehouse assignments with isolated data.
- Verify multi-user permissions, attachment isolation, CSRF, idempotency, rate limits, migration rollback/recovery, and transactional behavior against an isolated PostgreSQL database before production.
- Audit log coverage is not complete for every historical mutation. Existing records and historical notifications may predate current safeguards.
- Review operational controls: rotate secrets, restrict origins, TLS, backup and restore of both PostgreSQL and attachment storage, log retention, monitoring, and dependency vulnerabilities.
- Local backup: `backend/backups/inventorywarehouse-20261030142234.dump` (custom pg_dump archive; listing verified). Migration `20261030120000_costing_settlement_quarantine` deployed successfully after the three inspection/due-date migrations. These archives are ignored by Git and were not uploaded. Do not run migration on another target without a fresh backup and restore plan.
- New migration `20261104120000_return_settlement_reversals` adds linked compensating settlement records. It is authored but not applied to a database in this change; apply only after a fresh backup and test on a restored disposable copy.
- Master-data list screens use database-side `page`, `pageSize`, `search`, and, where exposed, `isActive`. Unpaged API responses remain available for legacy callers.
- Historical valuation requires an exact daily snapshot; dates without a snapshot report no historical value. Snapshots only exist when the service runs during the closing window.
- Location capacity enforcement is opt-in for item-unit capacity and is serialized using a location row lock. Pallet and volume capacity remain informational because product dimensions and packaging are unavailable.

## Accounting and operational limits

- Valuation uses current physical quantity, not a reconstructed historical closing inventory. Known-cost value excludes unknown-cost units; unknown issue costs prevent complete gross profit. Profit excludes invoice tax, includes proportional sale discount and posted sales returns, and does not represent net income or a full general ledger.
- Refunds are records of an externally executed transfer, not an instruction to a bank. Reversal entries compensate original settlement records but do not initiate or verify external money movement; evidence must be independently checked. This is not general-ledger integration.
- Quarantine balances, decisions, source purchase choices and credit targets provide paginated search; Dashboard attention items can be paged by document type.
- Opening-cost entry initializes only a nullable balance cost. It cannot amend historical stock movements or retroactively correct seeded/legacy COGS. Validate evidence and choose an appropriate operational cut-over date.
