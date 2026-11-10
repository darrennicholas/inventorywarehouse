-- Match common warehouse-scoped and paid/unpaid expense report filters.
CREATE INDEX IF NOT EXISTS "Expense_warehouseId_expenseDate_idx"
  ON "Expense" ("warehouseId", "expenseDate");

CREATE INDEX IF NOT EXISTS "Expense_isPaid_expenseDate_idx"
  ON "Expense" ("isPaid", "expenseDate");
