# Release and operational verification

Use a dedicated, disposable PostgreSQL database and non-production attachment storage. Never run destructive/concurrency cases against production or your only local database.

## Before release

- [ ] Review `git diff` and commit feature changes in small, named commits. Exclude `.env`, database dumps, uploaded files, `node_modules`, and runtime data.
- [ ] Run backend typecheck/build/tests and frontend lint/build from their package directories.
- [ ] Confirm Prisma migration status against the intended host/database. Take a fresh PostgreSQL backup and separately back up persistent attachment storage.
- [ ] Restore both backups into a disposable environment; verify representative users, stock balances, movements, returns, settlements, and attachment links. A successful backup command alone is not a restore test.
- [ ] Apply migrations only after verifying the database target; run health check and login smoke test after migration.

## Roles and warehouse access

- [ ] For all five roles, verify menu and read/create/update/approve/export actions against database permissions.
- [ ] Verify warehouse-scoped users cannot read, mutate, export, or infer another warehouse's records by changing IDs or query parameters.
- [ ] Verify self-approval is rejected where policy requires a different approver and denied operations leave no partial stock, document, or audit writes.

## Inventory and concurrency

- [ ] Submit concurrent receipts for one PO line; received quantity, stock, WAC, batch, and movement totals must reconcile without over-receipt.
- [ ] Ship concurrently against the same available balance; stock must never become negative and only valid operations may post.
- [ ] Race transfers, adjustments, opname approvals, and relocations; confirm losing transactions roll back documents, allocations, balances, and audit writes together.
- [ ] Retry idempotent requests with the same key/payload (one effect), then changed payload (conflict).
- [ ] Test quarantine review, expiry restrictions, damaged receipt, and full/partial purchase and sales returns.

## Finance and evidence

- [ ] Reconcile WAC after receipts, shipment, returns, and opening-cost cutover. Unknown legacy cost stays unknown until evidence-backed initialization.
- [ ] Verify refunds against actual transfers/recoveries; concurrent or repeated settlement requests cannot exceed entitlement or cash paid.
- [ ] Verify unused credit may be reversed once, applied credit cannot be reversed, and compensating entries appear in audit and net balances.
- [ ] Test allowed/disallowed MIME types, oversize attachments, unauthorized access, and cross-warehouse document IDs.
- [ ] Restore PostgreSQL and attachment storage together and verify links still resolve.

Record date, build commit, environment, role, tester, and result. Do not include production secrets or customer data in test reports. This checklist is not a security certification.
